import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import db from '../db.js';
import { IMAGES_DIR, BACKGROUNDS_DIR } from '../paths.js';
import { log, logError } from '../logger.js';
import broadcast from '../broadcast.js';
import { getScenarioCharacterState } from './character-state.js';
import { resolveEffectiveConfig } from './config-resolver.js';
import { buildPrompt, buildCharacterPrompt, loraTagsFromConfig, composeEnhancedScenePrompt } from './prompt-builder.js';
import { resolveScenarioClothingMap, getScenarioClothing } from './clothing.js';
import { applyResolvedClothing, resolvePrimaryCharacterForReference } from './prompt-resolution.js';
import { resolveIpAdapterModule, ipAdapterTuningForMode, validateIpAdapterAgainstCatalog } from './ipadapter-resolution.js';
import { audit } from './audit.js';
import * as a1111 from './a1111.js';
import { pickBestMoment, resolvePickerContextTurns } from './scene-picker.js';
import {
  loadVisualBriefFromCard,
  extractVisualBrief,
  visualBriefToLegacyMoment,
  composeSceneDescriptionFromBrief,
  resolveCharacterBriefFromTurns,
  composeCharacterActionFromBrief,
  composeGenericCharacterAction,
} from './visual-brief.js';
import { buildSdxlPrompt } from './story-enhancer.js';
import { extractImagePrompt } from './prompt-extractor.js';
import { userOwnsTags } from './exemplar-promotion.js';

const _getTurn                = db.prepare('SELECT * FROM turns WHERE id = ?');
const _getLocation            = db.prepare('SELECT * FROM locations WHERE id = ?');
const _getScenario            = db.prepare('SELECT * FROM scenarios WHERE id = ?');
const _getLatestTurnByRole    = db.prepare('SELECT * FROM turns WHERE scenario_id = ? AND role = ? ORDER BY turn_number DESC LIMIT 1');
const _getCharacters          = db.prepare('SELECT c.* FROM characters c JOIN scenario_characters sc ON c.id = sc.character_id WHERE sc.scenario_id = ? ORDER BY c.name');
const _getRecentNarratorTurns = db.prepare('SELECT id, content_text, scene_card_json, role, turn_number FROM turns WHERE scenario_id = ? AND role = ? ORDER BY turn_number DESC LIMIT 12');
const _getRecentImageCards    = db.prepare('SELECT scene_card_json FROM scene_images WHERE scenario_id = ? ORDER BY id DESC LIMIT 4');
const _insertSceneImage       = db.prepare(`
  INSERT INTO scene_images (
    scenario_id, turn_id, filename, mode, generation_method,
    background_used, prompt_used, negative_used, profile_id,
    seed, steps, cfg, width, height, model_name, model_hash, generation_time_ms,
    scene_card_json, summary_plain_snapshot, summary_tags_snapshot, style_context_snapshot
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const _getLocationBackgrounds = db.prepare('SELECT filename, is_default FROM location_backgrounds WHERE location_id = ?');

function _locationSlug(name) {
  return (name || 'location').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const IMAGE_EXT = /\.(png|jpg|jpeg)$/i;

export function buildA1111Payload(config, prompt, negative, referenceImageBase64 = null, mode = 'scene') {
  const payload = {
    prompt,
    negative_prompt:  negative,
    steps:            Math.round(config.a1111_steps)  || 30,
    cfg_scale:        config.a1111_cfg                || 7,
    width:            Math.round(config.a1111_width)  || 832,
    height:           Math.round(config.a1111_height) || 1216,
    sampler_name:     config.a1111_sampler            || 'DPM++ 2M SDE',
    scheduler:        config.a1111_scheduler          || 'Karras',
    seed:             -1,
    override_settings: {
      CLIP_stop_at_last_layers: Math.round(config.a1111_clip_skip) || 2,
      sd_vae: (config.a1111_vae || '').trim() || 'Automatic',
    },
  };

  if (config.hr_enabled) {
    Object.assign(payload, {
      enable_hr:              true,
      hr_scale:               config.hr_scale           || 1.5,
      hr_second_pass_steps:   Math.round(config.hr_steps) || 20,
      denoising_strength:     config.hr_denoising       || 0.4,
      hr_upscaler:            config.hr_upscaler        || 'R-ESRGAN 4x+',
    });
  }

  if (config.refiner_enabled && config.refiner_checkpoint) {
    payload.refiner_checkpoint = config.refiner_checkpoint;
    payload.refiner_switch_at  = config.refiner_switch_at ?? 0.8;
  }

  if (config.ad_enabled) {
    payload.alwayson_scripts = {
      ADetailer: {
        args: [{
          ad_model:               config.ad_model    || 'face_yolov8n.pt',
          ad_denoising_strength:  config.ad_strength || 0.4,
        }],
      },
    };
  }

  // Gated on config._controlnet_ready — set by generate()'s preflight, which confirms
  // (via /controlnet/model_list + /controlnet/module_list) that the resolved model AND
  // module actually exist in this A1111 instance. A missing/unconfigured model is never
  // papered over with a guessed default here — see resolveIpAdapterModule/getControlNetCatalog.
  if (referenceImageBase64 && config.ipadapter_enabled && config._controlnet_ready) {
    if (!payload.alwayson_scripts) payload.alwayson_scripts = {};
    const module = resolveIpAdapterModule({ configModule: config.ipadapter_module, checkpointModel: config.a1111_model });
    const tuning = ipAdapterTuningForMode(mode, {
      weight: parseFloat(config.ipadapter_weight),
      guidanceEnd: parseFloat(config.ipadapter_end),
    });
    payload.alwayson_scripts['controlnet'] = {
      args: [{
        enabled:        true,
        module,
        model:          config.ipadapter_model,
        weight:         tuning.weight,
        image:          referenceImageBase64,
        guidance_start: tuning.guidance_start,
        guidance_end:   tuning.guidance_end,
        control_mode:   tuning.control_mode,
        pixel_perfect:  true,
      }],
    };
  }

  return payload;
}

const CONTROLNET_CACHE_TTL_MS = 5 * 60 * 1000; // re-check periodically — a bad/offline
                                                // first result must not stick forever (CF-11)
let _controlNetCatalogCache = null; // { available, models: string[], modules: string[], checkedAt }

/**
 * Fetches (and TTL-caches) A1111's ControlNet model + module catalog. Exported for
 * direct testing of the caching/refresh behavior.
 */
export async function getControlNetCatalog(baseUrl, { now = Date.now, forceRefresh = false } = {}) {
  const t = now();
  if (!forceRefresh && _controlNetCatalogCache && (t - _controlNetCatalogCache.checkedAt) < CONTROLNET_CACHE_TTL_MS) {
    return _controlNetCatalogCache;
  }
  try {
    const [models, modules] = await Promise.all([
      a1111.getControlNetModels(baseUrl),
      a1111.getControlNetModules(baseUrl),
    ]);
    _controlNetCatalogCache = { available: true, models, modules, checkedAt: t };
  } catch (_) {
    _controlNetCatalogCache = { available: false, models: [], modules: [], checkedAt: t };
  }
  return _controlNetCatalogCache;
}

async function _prepareA1111(baseUrl, config) {
  const model = (config.a1111_model || '').trim();
  if (model) {
    await a1111.setModel(baseUrl, model);
  }
}

function _stripHeavyA1111Options(payload) {
  const safe = { ...payload };
  delete safe.refiner_checkpoint;
  delete safe.refiner_switch_at;
  delete safe.enable_hr;
  delete safe.hr_scale;
  delete safe.hr_second_pass_steps;
  delete safe.hr_upscaler;
  delete safe.denoising_strength;
  delete safe.alwayson_scripts;
  safe.override_settings = {
    ...(safe.override_settings || {}),
    sd_vae: 'Automatic',
  };
  return safe;
}

// Removes only the controlnet unit from alwayson_scripts, preserving ADetailer/other
// always-on scripts — narrower than _stripHeavyA1111Options, used when the failure is
// specifically attributable to the ControlNet/IP-Adapter unit, not the whole model load.
function _stripControlNet(payload) {
  if (!payload.alwayson_scripts?.controlnet) return payload;
  const alwayson_scripts = { ...payload.alwayson_scripts };
  delete alwayson_scripts.controlnet;
  const safe = { ...payload };
  if (Object.keys(alwayson_scripts).length) safe.alwayson_scripts = alwayson_scripts;
  else delete safe.alwayson_scripts;
  return safe;
}

const CONTROLNET_ERROR_PATTERN = /controlnet|ip.?adapter|preprocessor|script.*not found/i;

export async function callA1111(baseUrl, mode, payload, savePath) {
  const _call = (p) => (mode === 'img2img' ? a1111.img2img(baseUrl, p, savePath) : a1111.txt2img(baseUrl, p, savePath));

  try {
    const result = await _call(payload);
    return { ...result, controlnetFallback: false };
  } catch (err) {
    const msg = String(err?.message || err);
    const hadControlNet = !!payload.alwayson_scripts?.controlnet;
    const isControlNetError = hadControlNet && CONTROLNET_ERROR_PATTERN.test(msg);
    const isVaeError = msg.includes('AutoencoderKL') || msg.includes('state_dict');
    const hasExtras = payload.refiner_checkpoint || payload.enable_hr || payload.alwayson_scripts;

    // ControlNet/IP-Adapter-specific failure: fail open — retry once without the
    // controlnet unit rather than losing the whole image. Whatever generation results
    // still gets produced, just without a face reference for this one image.
    if (isControlNetError) {
      log('image-pipeline', 'a1111_controlnet_fallback', null,
        'ControlNet/IP-Adapter request rejected, retrying without FaceID: ' + msg.slice(0, 160));
      const withoutControlNet = _stripControlNet(payload);
      const result = await _call(withoutControlNet);
      return { ...result, controlnetFallback: true, controlnetFallbackReason: msg.slice(0, 200) };
    }

    if (isVaeError && hasExtras) {
      log('image-pipeline', 'a1111_retry', null, 'Retrying with safe payload after: ' + msg.slice(0, 120));
      const safe = _stripHeavyA1111Options(payload);
      const result = await _call(safe);
      return {
        ...result,
        controlnetFallback: hadControlNet,
        controlnetFallbackReason: hadControlNet ? msg.slice(0, 200) : undefined,
      };
    }
    if (isVaeError) {
      throw new Error('A1111 VAE/model load failed. In A1111 Settings set SD VAE to Automatic, verify the checkpoint is a full SDXL model, and disable refiner/hires if misconfigured. Original: ' + msg.slice(0, 180));
    }
    throw err;
  }
}
function _buildStyleContextSnapshot(config, profile) {
  return JSON.stringify({
    profile_id: config.active_profile_id ?? null,
    profile_name: profile?.name || '',
    model_name: config.a1111_model || '',
    lora1_file: config.lora1_file || '',
    lora1_strength: config.lora1_strength ?? 1,
    master_positive_snippet: (config.master_positive || '').slice(0, 120),
    profile_prefix_snippet: (config.prompt_prefix || '').slice(0, 120),
    hr_enabled: !!config.hr_enabled,
    ad_enabled: !!config.ad_enabled,
    refiner_enabled: !!config.refiner_enabled,
  });
}

function _canonicalFromSceneCard(sceneCard) {
  const plain = (sceneCard?.summary_plain || sceneCard?.image_prompt || '').trim();
  const tags = (sceneCard?.summary_tags || '').trim();
  return {
    canonical_plain: plain,
    canonical_tags: tags || plain || (sceneCard?.image_prompt || '').trim(),
  };
}

function _resolveBackground(location) {
  if (!location) return null;
  const folder = location.background_folder || '';
  if (!folder) return null;

  const rows = _getLocationBackgrounds.all(location.id);
  let chosenName = null;
  if (rows.length) {
    const defaultRow = rows.find(r => r.is_default === 1);
    const chosen = defaultRow || rows[Math.floor(Math.random() * rows.length)];
    chosenName = chosen.filename;
  } else if (location.default_background) {
    // Compat: FS/UI default set but not yet registered in location_backgrounds
    chosenName = location.default_background;
    try {
      db.prepare('INSERT OR IGNORE INTO location_backgrounds (location_id, filename) VALUES (?, ?)').run(location.id, chosenName);
      db.prepare('UPDATE location_backgrounds SET is_default = 1 WHERE location_id = ? AND filename = ?').run(location.id, chosenName);
    } catch (_) {}
  }
  if (!chosenName) return null;
  const full = path.join(BACKGROUNDS_DIR, folder, chosenName);
  if (!fs.existsSync(full)) return null;
  return full;
}

export async function generate({ mode, scenarioId, turnId = null, characterId = null, opts = {} }) {
  const runId    = randomUUID();
  const t0       = Date.now();
  const isBackground = mode === 'background';

  audit({ pipeline_run_id: runId, service: 'image-pipeline', stage: 'start',
          status: 'start', message: `generate mode=${mode}`,
          scenario_id: scenarioId, turn_id: turnId });

  try {
    // Stage 1: resolve_config
    const config  = resolveEffectiveConfig(db);
    const baseUrl = config.a1111_url || 'http://127.0.0.1:7860';

    audit({ pipeline_run_id: runId, service: 'image-pipeline', stage: 'resolve_config',
            status: 'success', message: 'config resolved',
            scenario_id: scenarioId, turn_id: turnId,
            output: { profile_id: config.active_profile_id } });

    // Stage 2: build_prompt
    let sceneCard   = null;
    let turn        = null;
    let location    = null;
    let characters  = [];

    if (turnId) {
      turn = _getTurn.get(turnId);
      if (turn?.scene_card_json) {
        try { sceneCard = JSON.parse(turn.scene_card_json); } catch (_) {}
      }
      if (turn?.location_id) {
        location = _getLocation.get(turn.location_id);
      }
    }

    if (opts.locationId && !location) {
      location = _getLocation.get(opts.locationId);
    }

    // When no specific turn is targeted (Scene button, character cards), or the turn's
    // scene card has no image_prompt, fall back to the latest narrator turn so the
    // generated image always reflects the current story beat rather than just char appearances.
    if (!isBackground && (!sceneCard || !sceneCard.image_prompt)) {
      const latestNarTurn = _getLatestTurnByRole.get(scenarioId, 'narrator');
      if (latestNarTurn?.scene_card_json) {
        try { sceneCard = JSON.parse(latestNarTurn.scene_card_json); } catch (_) {}
      }
      if (latestNarTurn?.location_id && !location) {
        location = _getLocation.get(latestNarTurn.location_id);
      }
    }

    // Final fallback: use scenario's pinned active location
    const scenario = _getScenario.get(scenarioId);
    if (!location && scenario?.active_location_id) {
      location = _getLocation.get(scenario.active_location_id);
    }

    characters = _getCharacters.all(scenarioId);

    // Stage 2a: scene_picker — advisory only, never mutates sceneCard/location/characters
        // Stage 2a: prefer stored visual_brief on the turn's scene_card_json (primary SoT).
    // Live pickBestMoment / extractVisualBrief only if brief missing (legacy migration path).
    // image_prompt is legacy fallback only — not parallel SoT.
    let pickedMoment = null;
    let visualBrief = loadVisualBriefFromCard(sceneCard);
    const skipAdvisory = turnId && userOwnsTags(db, turnId);
    if (skipAdvisory) {
      log('image-pipeline', 'advisory_skipped', null, 'user_edited_tags');
    }

    if (!isBackground && mode !== 'character' && !skipAdvisory) {
      if (visualBrief) {
        pickedMoment = visualBriefToLegacyMoment(visualBrief);
        log('image-pipeline', 'visual_brief_hit', null,
          `main_subject=${visualBrief.main_subject}` + (turnId ? ' (focal turn)' : ''));
      } else {
        // Migration fallback: try one extract, else old picker.
        const extractModel = (config.picker_model || config.prompt_extractor_model || config.narrator_model || '').trim();
        const storyForBrief = (turnId && turn?.content_text)
          ? turn.content_text
          : _getLatestTurnByRole.get(scenarioId, 'narrator')?.content_text;
        if (extractModel && storyForBrief) {
          const clothingMap = resolveScenarioClothingMap(scenarioId, characters);
          visualBrief = await extractVisualBrief({
            storyText: storyForBrief,
            cast: characters,
            clothingMap,
            location,
            model: extractModel,
            nsfwEnabled: config.nsfw_enabled === true,
          });
          if (visualBrief) {
            pickedMoment = visualBriefToLegacyMoment(visualBrief);
            // Persist onto in-memory sceneCard for this generate; do not require DB write here.
            sceneCard = { ...(sceneCard || {}), visual_brief: visualBrief };
            log('image-pipeline', 'visual_brief_extract_fallback', null, `main_subject=${visualBrief.main_subject}`);
          }
        }
        if (!pickedMoment) {
          const recentTurnsChronological = _getRecentNarratorTurns.all(scenarioId, 'narrator')
            .map(r => r.content_text).filter(Boolean).reverse();
          const pickerTurns = resolvePickerContextTurns({
            focalTurnText: turnId && turn ? turn.content_text : null,
            recentTurnsChronological,
          });
          const recentImageCards = _getRecentImageCards.all(scenarioId).map(r => { try { return JSON.parse(r.scene_card_json); } catch (_) { return null; } }).filter(Boolean);
          if (pickerTurns.length > 0) {
            pickedMoment = await pickBestMoment(
              pickerTurns,
              characters.filter(c => c.role !== 'player'),
              recentImageCards,
              config.picker_model || config.narrator_model,
              config.nsfw_enabled === true,
            );
            log('image-pipeline', 'picker_result', null,
              pickedMoment
                ? `picked: ${pickedMoment.visibleAction}` + (turnId ? ' (focal turn)' : '')
                : 'picker returned null, using scene card');
          }
        }
      }
    }

if (isBackground && location) {
      sceneCard = { image_prompt: location.image_tags || location.description || location.name };
    }
    if (opts.directPrompt && opts.rawPrompt) {
      sceneCard = { image_prompt: opts.rawPrompt };
    }
    let bgPath = (isBackground || config.location_bg_mode === 'description') ? null : _resolveBackground(location);
    let prompt, negative, parts;
    const resolvedClothingMap = resolveScenarioClothingMap(scenarioId, characters);
    let resolvedChar = null; // set in character mode; used by FaceID reference resolution below

    if (mode === 'character' && characterId) {
      let char = characters.find(c => c.id === characterId) || characters;
      if (!char || Array.isArray(char)) {
        throw new Error('Character not found in scenario cast');
      }
      // Ensure character prompt uses scenario-scoped clothing
      char = applyResolvedClothing(char, resolvedClothingMap[char.id] || getScenarioClothing(scenarioId, char.id));
      resolvedChar = char;
      let actionContext = '';
      // Character path: current-turn brief -> prior brief -> generic (description+clothing+location+pose).
      // Do not re-summarize the whole scene. image_prompt / summary_* are legacy fallbacks only.
      if (opts.directPrompt && opts.rawPrompt) {
        actionContext = String(opts.rawPrompt).trim();
      } else {
        const narratorTurnsNewestFirst = _getRecentNarratorTurns.all(scenarioId, 'narrator');
        // Ensure focal turn is first if present
        let turnsForBrief = narratorTurnsNewestFirst;
        if (turn && turn.role === 'narrator') {
          turnsForBrief = [turn, ...narratorTurnsNewestFirst.filter(r => r.id !== turn.id)];
        }
        const resolved = resolveCharacterBriefFromTurns({
          characterId: char.id,
          characterName: char.name,
          turnsNewestFirst: turnsForBrief,
        });
        if (resolved?.entry) {
          actionContext = composeCharacterActionFromBrief(resolved.entry, {
            settingBrief: resolved.brief?.setting_brief || '',
            shotHint: resolved.brief?.shot_hint || null,
          });
          log('image-pipeline', 'character_brief_hit', null, `${char.name}: ${resolved.entry.brief}`);
        } else if (sceneCard?.summary_tags) {
          actionContext = sceneCard.summary_tags;
        } else if (sceneCard?.summary_plain) {
          actionContext = sceneCard.summary_plain;
        } else if (sceneCard?.image_prompt) {
          actionContext = sceneCard.image_prompt; // legacy fallback only
        } else {
          actionContext = composeGenericCharacterAction({ location });
        }
      }
      ({ prompt, negative, parts } = buildCharacterPrompt({ character: char, actionContext, location, config }));
    } else {
      ({ prompt, negative, parts } = buildPrompt({
        sceneCard, characters, location, scenario, config,
        isImg2img: bgPath != null,
        resolvedClothingMap,
      }));
    }

    // Authoritative scenario clothing for this prompt — captured before the advisory
    // enhancer stage so it can be preserved even if the enhancer rewrites `prompt`.
    const resolvedClothingBlock = parts?.clothing_block || '';
    let enhancerApplied = false;
    const preEnhancerPrompt = prompt;

    // Stage 2b: story_enhancer — advisory only, rewrites prompt if model is configured
    // and output passes validation. Falls back to buildPrompt values silently.
    if (!isBackground && mode !== 'character' && mode !== 'background' && !skipAdvisory) {
      const nsfwOn = config.nsfw_enabled === true;

      // Prefer picker fields; fall back to scene card fields from narrator.
      // Build sceneDescription with explicit content leading when present.
            let sceneDescription;
      if (visualBrief) {
        sceneDescription = composeSceneDescriptionFromBrief(visualBrief);
      } else if (pickedMoment) {
        const descParts = [
          pickedMoment.visibleAction,
          pickedMoment.bodyPosition  || null,
          pickedMoment.explicitAct   || null,
          pickedMoment.nudityState   || null,
          pickedMoment.clothingState || null,
          pickedMoment.setting,
          pickedMoment.shotType ? pickedMoment.shotType + ' shot' : null,
        ];
        // Legacy: narrator image_prompt only when no visual_brief
        if (sceneCard?.image_prompt) descParts.push(sceneCard.image_prompt);
        sceneDescription = descParts.filter(Boolean).join(', ');
      } else {
        // Legacy fallback only
        sceneDescription = sceneCard?.image_prompt || '';
        if (!sceneDescription) {
          const storyForExtract = (turnId && turn?.content_text)
            ? turn.content_text
            : _getLatestTurnByRole.get(scenarioId, 'narrator')?.content_text;
          if (storyForExtract) {
            try {
              const extracted = await extractImagePrompt({ storyText: storyForExtract, characters, config });
              if (extracted) sceneDescription = extracted;
            } catch (_) {}
          }
        }
      }

// Extract structured explicit fields for the enhancer (picker preferred, scene card fallback)
      const explicitAct   = pickedMoment?.explicitAct   || sceneCard?.explicit_act   || null;
      const nudityState   = pickedMoment?.nudityState   || sceneCard?.nudity_state   || null;
      const bodyPosition  = pickedMoment?.bodyPosition  || sceneCard?.body_positions || null;
      const clothingState = pickedMoment?.clothingState || null;
      const mainCharForArousal = characters.find(c => c.role !== 'player') || characters[0] || null;
      const charState = mainCharForArousal
        ? getScenarioCharacterState(scenarioId, mainCharForArousal.id)
        : null;
      const arousalLevel  = charState?.arousalcurrent ?? sceneCard?.arousal_level ?? 1;

      // Inject structured fields into scene body (enhancer owns body only; pipeline wraps LoRA/neg)
      if (nsfwOn) {
        const structBits = [
          explicitAct ? `act:${explicitAct}` : null,
          nudityState ? `nudity:${nudityState}` : null,
          bodyPosition ? `pose:${bodyPosition}` : null,
          clothingState ? `clothing:${clothingState}` : null,
          arousalLevel > 1 ? `arousal:${arousalLevel}` : null,
        ].filter(Boolean);
        if (structBits.length) {
          sceneDescription = [sceneDescription, ...structBits].filter(Boolean).join(', ');
        }
      }

      const mainChar = mainCharForArousal;
      const enhModel = config.enhancer_model || config.narrator_model || '';

      try {
        const enhanced = await buildSdxlPrompt({
          char:          mainChar,
          scene:         sceneDescription,
          physicalTraits: null,
          nsfw:          nsfwOn,
          prefix:        config.prompt_prefix  || null,
          suffix:        config.prompt_suffix  || null,
          nsfwElements:  [],
          model:         enhModel,
        });
        if (enhanced?.positive && enhanced.positive.length > 20) {
          // Pipeline owns wrap layers: master/profile prefix+suffix + LoRAs + master negative.
          // resolvedClothingBlock is re-injected here (not sourced from the LLM output) so the
          // authoritative scenario clothing always survives the enhancer rewrite — see CF-1.
          const lora = loraTagsFromConfig(config);
          const prefix = [config.master_positive, config.prompt_prefix].filter(s => s && String(s).trim()).join(', ');
          const suffix = config.prompt_suffix || '';
          prompt = composeEnhancedScenePrompt({
            prefix,
            body: enhanced.positive,
            clothingBlock: resolvedClothingBlock,
            suffix,
            loraTags: lora,
          });
          negative = [
            config.master_negative || '',
            config.negative_additions || '',
            enhanced.negative || '',
          ].filter(s => s && String(s).trim()).join(', ');
          enhancerApplied = true;
        }
      } catch (enhErr) {
        log('image-pipeline', 'enhancer_skipped', null, enhErr.message);
      }
    }

    // Inject location environment into txt2img prompts (no background image selected)
    if (!bgPath && location) {
      const locEnv = [
        location.image_tags || '',
        location.time_of_day && location.time_of_day !== 'any' ? location.time_of_day + ' lighting' : '',
      ].filter(s => s && s.trim()).join(', ');
      if (locEnv.trim()) {
        prompt = prompt ? prompt + ', ' + locEnv : locEnv;
      }
    }

    audit({ pipeline_run_id: runId, service: 'prompt-builder', stage: 'build_prompt',
            status: 'success', message: enhancerApplied
              ? 'prompt assembled, then rewritten by story_enhancer (clothing preserved)'
              : 'prompt assembled',
            scenario_id: scenarioId, turn_id: turnId,
            input:  { scene_card: sceneCard, mode },
            // parts reflects buildPrompt()'s output; when the enhancer rewrites `prompt`,
            // the pre/post snippets below show what was actually sent, not just `parts`.
            output: { parts, enhancer_applied: enhancerApplied,
                      pre_enhancer_prompt_snippet: preEnhancerPrompt ? preEnhancerPrompt.slice(0, 200) : '',
                      final_prompt_snippet: prompt.slice(0, 200), prompt_length: prompt.length } });

    // Stage 3: resolve_background (resolved above; log outcome)
    const bgMethod = bgPath ? 'img2img' : 'txt2img';
    audit({ pipeline_run_id: runId, service: 'image-pipeline', stage: 'resolve_background',
            status: 'success',
            message: bgPath
              ? `img2img — selected ${path.basename(bgPath)} from folder "${location?.background_folder || ''}"`
              : `txt2img — no background folder or folder empty`,
            scenario_id: scenarioId, turn_id: turnId,
            output: { bg_path: bgPath, method: bgMethod } });

    await _prepareA1111(baseUrl, config);

    // Preflight: only mark FaceID "ready" once both the configured model AND the
    // resolved preprocessor module are confirmed present in this A1111 instance. An
    // unconfigured/missing model is never guessed at — see CF-A3/getControlNetCatalog.
    // Cheap early-out: skip the network round-trip entirely when no model is configured
    // at all — that alone is enough to know FaceID can't run this generation.
    config._controlnet_ready = false;
    if (config.ipadapter_enabled && !isBackground) {
      if (!String(config.ipadapter_model || '').trim()) {
        log('image-pipeline', 'ipadapter_skipped', null, 'No IP-Adapter model configured');
      } else {
        const resolvedModule = resolveIpAdapterModule({ configModule: config.ipadapter_module, checkpointModel: config.a1111_model });
        const catalog = await getControlNetCatalog(baseUrl);
        const validation = validateIpAdapterAgainstCatalog({ model: config.ipadapter_model, module: resolvedModule }, catalog);
        config._controlnet_ready = validation.ok;
        if (!validation.ok) {
          log('image-pipeline', 'ipadapter_skipped', null, validation.reason);
        }
      }
    }

    broadcast.send('image_status', { message: 'Sending to A1111...' });

    // Stage 4: a1111_call
    const timestamp = Date.now();
    let saveDir, savePath;

    if (isBackground && location) {
      const folderName = location.background_folder || _locationSlug(location.name);
      saveDir   = path.join(BACKGROUNDS_DIR, folderName);
      savePath  = path.join(saveDir, `${timestamp}.png`);
    } else {
      saveDir  = path.join(IMAGES_DIR, String(scenarioId));
      savePath = path.join(saveDir, `${timestamp}_${mode}.png`);
    }

    fs.mkdirSync(saveDir, { recursive: true });

    // Resolve IP-Adapter reference image (canonical: reference_image_path).
    // Reference character must match the character actually being generated — see CF-2.
    // mainSubject comes from Stage 2a's pickedMoment (real scene-picker LLM output, in scope
    // here); sceneCard has no equivalent field — see resolvePrimaryCharacterForReference doc.
    let referenceImageBase64 = null;
    if (config.ipadapter_enabled && !isBackground) {
      const mainCharRef = resolvePrimaryCharacterForReference({
        mode, resolvedChar, characters, mainSubject: pickedMoment?.mainSubject,
      });
      const refRel = mainCharRef?.reference_image_path || mainCharRef?.reference_image || '';
      if (refRel) {
        const refPath = path.join(IMAGES_DIR, refRel);
        if (fs.existsSync(refPath)) {
          referenceImageBase64 = fs.readFileSync(refPath).toString('base64');
        } else {
          log('image-pipeline', 'face_ref_missing', null, `ref not found: ${refPath}`);
        }
      }
    }

    const basePayload = buildA1111Payload(config, prompt, negative, referenceImageBase64, mode);

    log('image-pipeline', 'PROMPT_SUBMITTED', null,
      `[FULL PROMPT]\n${basePayload.prompt}\n\n[NEGATIVE]\n${basePayload.negative_prompt}`
    );
    log('image-pipeline', 'SCENE_CARD', null,
      `image_prompt="${sceneCard?.image_prompt || '(empty)'}" | mood="${sceneCard?.mood || '?'}" | arousal=${sceneCard?.arousal_level ?? '?'}`
    );

    let genResult;
    const t1 = Date.now();
    if (bgPath) {
      const bgBase64 = fs.readFileSync(bgPath).toString('base64');
      genResult = await callA1111(baseUrl, 'img2img', {
        ...basePayload,
        init_images:        [`data:image/png;base64,${bgBase64}`],
        denoising_strength: config.img2img_denoising ?? 0.45,
        resize_mode:        1,
      }, savePath);
    } else {
      genResult = await callA1111(baseUrl, 'txt2img', basePayload, savePath);
    }

    audit({ pipeline_run_id: runId, service: 'a1111', stage: 'a1111_call',
            status: 'success', message: genResult.controlnetFallback
              ? `generation complete without FaceID (ControlNet fallback), seed=${genResult.seed}`
              : `generation complete, seed=${genResult.seed}`,
            scenario_id: scenarioId, turn_id: turnId,
            duration_ms: Date.now() - t1,
            output: { seed: genResult.seed, model_name: genResult.model_name,
                      model_hash: genResult.model_hash, generation_time_ms: genResult.generation_time_ms,
                      controlnet_fallback: !!genResult.controlnetFallback,
                      controlnet_fallback_reason: genResult.controlnetFallbackReason || null } });

    // Stage 5: file_verify
    if (!fs.existsSync(savePath)) {
      throw new Error('Image file missing after generation: ' + savePath);
    }

    const basename = path.basename(savePath);
    const filename = isBackground ? basename : `${scenarioId}/${basename}`;

    audit({ pipeline_run_id: runId, service: 'image-pipeline', stage: 'file_verify',
            status: 'success', message: `file verified: ${filename}`,
            scenario_id: scenarioId, turn_id: turnId });

    // Stage 6: persist (skip for background mode — caller handles location update)
    let imageId = null;
    if (!isBackground) {
      const canon = _canonicalFromSceneCard(sceneCard || {});
      const styleSnap = _buildStyleContextSnapshot(config, null);
      const ins = _insertSceneImage.run(
        scenarioId,
        turnId  ?? null,
        filename,
        mode,
        bgPath ? 'img2img' : 'txt2img',
        bgPath ? path.basename(bgPath) : '',
        prompt,
        negative,
        config.active_profile_id ?? null,
        genResult.seed,
        Math.round(config.a1111_steps) || 30,
        config.a1111_cfg               || 7,
        Math.round(config.a1111_width) || 832,
        Math.round(config.a1111_height)|| 1216,
        genResult.model_name,
        genResult.model_hash,
        genResult.generation_time_ms,
        sceneCard ? JSON.stringify(sceneCard) : null,
        canon.canonical_plain || '',
        canon.canonical_tags || '',
        styleSnap,
      );
      imageId = ins.lastInsertRowid;

      audit({ pipeline_run_id: runId, service: 'image-pipeline', stage: 'persist',
              status: 'success', message: `scene_images row ${imageId} inserted`,
              scenario_id: scenarioId, turn_id: turnId,
              output: { image_id: imageId } });

      // Stage 7: broadcast
      broadcast.send('image_ready', {
        scenarioId: parseInt(scenarioId, 10),
        turnId:   turnId ?? null,
        imageId,
        filename,
        controlnetFallback: !!genResult.controlnetFallback,
      });
    }

    const duration = Date.now() - t0;
    log('image-pipeline', 'complete', { runId, mode, scenarioId, filename, duration_ms: duration });

    audit({ pipeline_run_id: runId, service: 'image-pipeline', stage: 'complete',
            status: 'success', message: `pipeline done in ${duration}ms`,
            scenario_id: scenarioId, turn_id: turnId, duration_ms: duration });

    return { ok: true, imageId, filename, savePath, controlnetFallback: !!genResult.controlnetFallback };

  } catch (err) {
    const duration = Date.now() - t0;
    logError('image-pipeline', 'failed', err);

    audit({ pipeline_run_id: runId, service: 'image-pipeline', stage: 'error',
            status: 'failed', message: err.message,
            scenario_id: scenarioId, turn_id: turnId, duration_ms: duration,
            error: err.message });

    broadcast.send('image_error', {
      scenarioId: parseInt(scenarioId, 10),
      error: err.message,
    });

    throw err;
  }
}
