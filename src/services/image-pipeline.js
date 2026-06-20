import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import db from '../db.js';
import { IMAGES_DIR, BACKGROUNDS_DIR } from '../paths.js';
import { log, logError } from '../logger.js';
import broadcast from '../broadcast.js';
import { resolveEffectiveConfig } from './config-resolver.js';
import { buildPrompt, buildCharacterPrompt } from './prompt-builder.js';
import { audit } from './audit.js';
import * as a1111 from './a1111.js';
import { pickBestMoment } from './scene-picker.js';
import { buildSdxlPrompt } from './story-enhancer.js';
import { extractImagePrompt } from './prompt-extractor.js';

const _getTurn                = db.prepare('SELECT * FROM turns WHERE id = ?');
const _getLocation            = db.prepare('SELECT * FROM locations WHERE id = ?');
const _getScenario            = db.prepare('SELECT * FROM scenarios WHERE id = ?');
const _getLatestTurnByRole    = db.prepare('SELECT * FROM turns WHERE scenario_id = ? AND role = ? ORDER BY turn_number DESC LIMIT 1');
const _getCharacters          = db.prepare('SELECT c.* FROM characters c JOIN scenario_characters sc ON c.id = sc.character_id WHERE sc.scenario_id = ? ORDER BY c.name');
const _getRecentNarratorTurns = db.prepare('SELECT content_text FROM turns WHERE scenario_id = ? AND role = ? ORDER BY turn_number DESC LIMIT 6');
const _getRecentImageCards    = db.prepare('SELECT scene_card_json FROM scene_images WHERE scenario_id = ? ORDER BY id DESC LIMIT 4');
const _insertSceneImage       = db.prepare(`
  INSERT INTO scene_images (
    scenario_id, turn_id, filename, mode, generation_method,
    background_used, prompt_used, negative_used, profile_id,
    seed, steps, cfg, width, height, model_name, model_hash, generation_time_ms,
    scene_card_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const _getLocationBackgrounds = db.prepare('SELECT filename, is_default FROM location_backgrounds WHERE location_id = ?');

function _locationSlug(name) {
  return (name || 'location').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const IMAGE_EXT = /\.(png|jpg|jpeg)$/i;

function _buildA1111Payload(config, prompt, negative, referenceImageBase64 = null) {
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

  if (referenceImageBase64 && config.ipadapter_enabled) {
    if (!payload.alwayson_scripts) payload.alwayson_scripts = {};
    payload.alwayson_scripts['controlnet'] = {
      args: [{
        enabled:        true,
        module:         'ip-adapter-auto',
        model:          config.ipadapter_model || 'ip-adapter-plus-face_sdxl_vit-h [andrewnuness]',
        weight:         parseFloat(config.ipadapter_weight) || 0.35,
        image:          referenceImageBase64,
        guidance_start: 0.0,
        guidance_end:   parseFloat(config.ipadapter_end) || 0.6,
        control_mode:   0,
        pixel_perfect:  true,
      }],
    };
  }

  return payload;
}

function _resolveBackground(location) {
  if (!location) return null;
  const folder = location.background_folder || '';
  if (!folder) return null;

  const rows = _getLocationBackgrounds.all(location.id);
  if (!rows.length) return null;

  // Prefer the row marked is_default; fall back to a random pick
  const defaultRow = rows.find(r => r.is_default === 1);
  const chosen = defaultRow || rows[Math.floor(Math.random() * rows.length)];
  return path.join(BACKGROUNDS_DIR, folder, chosen.filename);
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
    let pickedMoment = null;
    if (!isBackground && mode !== 'character') {
      const recentTurns = _getRecentNarratorTurns.all(scenarioId, 'narrator').map(r => r.content_text).filter(Boolean).reverse();

      const recentImageCards = _getRecentImageCards.all(scenarioId).map(r => { try { return JSON.parse(r.scene_card_json); } catch (_) { return null; } }).filter(Boolean);

      if (recentTurns.length > 0) {
        pickedMoment = await pickBestMoment(
          recentTurns,
          characters.filter(c => c.role !== 'player'),
          recentImageCards,
          config.picker_model || config.narrator_model,
          config.nsfw_enabled === true,
        );
        log('image-pipeline', 'picker_result', null,
          pickedMoment ? `picked: ${pickedMoment.visibleAction}` : 'picker returned null, using scene card');
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
    const resolvedClothingMap = {};
    for (const char of characters) {
      resolvedClothingMap[char.id] = char.current_clothing || char.base_clothing || '';
    }

    if (mode === 'character' && characterId) {
      const char = characters.find(c => c.id === characterId) || characters;
      let actionContext = '';
      if (sceneCard?.image_prompt) {
        actionContext = sceneCard.image_prompt;
      } else {
        const locTags = location?.image_tags || '';
        const locName = (location?.name || '').toLowerCase();
        let poseFallback = 'standing, natural candid pose, not looking at camera';
        if      (locName.includes('bed') || locName.includes('room')) poseFallback = 'lying on bed, relaxed, not looking at camera';
        else if (locName.includes('bath'))                            poseFallback = 'standing in bathroom, not looking at camera';
        else if (locName.includes('car'))                             poseFallback = 'sitting in car seat, looking out window';
        else if (locName.includes('beach'))                           poseFallback = 'standing on beach, looking at horizon';
        else if (locName.includes('park') || locName.includes('outdoor')) poseFallback = 'standing outdoors, looking away into distance';
        actionContext = [poseFallback, locTags].filter(Boolean).join(', ');
      }
      ({ prompt, negative, parts } = buildCharacterPrompt({ character: char, actionContext, config }));
    } else {
      ({ prompt, negative, parts } = buildPrompt({
        sceneCard, characters, location, scenario, config,
        isImg2img: bgPath != null,
        resolvedClothingMap,
      }));
    }

    // Stage 2b: story_enhancer — advisory only, rewrites prompt if model is configured
    // and output passes validation. Falls back to buildPrompt values silently.
    if (!isBackground && mode !== 'character' && mode !== 'background') {
      const nsfwOn = config.nsfw_enabled === true;

      // Prefer picker fields; fall back to scene card fields from narrator.
      // Build sceneDescription with explicit content leading when present.
      let sceneDescription;
      if (pickedMoment) {
        const descParts = [
          pickedMoment.visibleAction,
          pickedMoment.bodyPosition  || null,
          pickedMoment.explicitAct   || null,
          pickedMoment.nudityState   || null,
          pickedMoment.clothingState || null,
          pickedMoment.setting,
          pickedMoment.shotType ? pickedMoment.shotType + ' shot' : null,
        ];
        // Also blend narrator's image_prompt as supplementary context
        if (sceneCard?.image_prompt) descParts.push(sceneCard.image_prompt);
        sceneDescription = descParts.filter(Boolean).join(', ');
      } else {
        // No picked moment: use the narrator's extracted image_prompt when available.
        // If that is also empty, call extractImagePrompt on the latest story text directly.
        // Never fall back to the appearance-blob prompt — that duplicates traitBlock in
        // buildSdxlPrompt and gives the enhancer zero actual story context.
        sceneDescription = sceneCard?.image_prompt || '';
        if (!sceneDescription) {
          const latestNarTurn = _getLatestTurnByRole.get(scenarioId, 'narrator');
          if (latestNarTurn?.content_text) {
            try {
              const extracted = await extractImagePrompt({ storyText: latestNarTurn.content_text, characters, config });
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
      const arousalLevel  = sceneCard?.arousal_level ?? 1;

      const mainChar = characters.find(c => c.role !== 'player') || characters[0] || null;
      const enhModel = config.enhancer_model || config.narrator_model || '';

      try {
        const enhanced = await buildSdxlPrompt({
          char:          mainChar,
          scene:         sceneDescription,
          physicalTraits: null,
          nsfw:          nsfwOn,
          arousalLevel,
          explicitAct,
          nudityState,
          bodyPosition,
          clothingState,
          prefix:        config.prompt_prefix  || null,
          suffix:        config.prompt_suffix  || null,
          nsfwElements:  [],
          model:         enhModel,
        });
        if (enhanced?.positive && enhanced.positive.length > 20) {
          prompt   = enhanced.positive;
          negative = enhanced.negative || negative;
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
            status: 'success', message: 'prompt assembled',
            scenario_id: scenarioId, turn_id: turnId,
            input:  { scene_card: sceneCard, mode },
            output: { parts, prompt_length: prompt.length } });

    // Stage 3: resolve_background (resolved above; log outcome)
    const bgMethod = bgPath ? 'img2img' : 'txt2img';
    audit({ pipeline_run_id: runId, service: 'image-pipeline', stage: 'resolve_background',
            status: 'success',
            message: bgPath
              ? `img2img — selected ${path.basename(bgPath)} from folder "${location?.background_folder || ''}"`
              : `txt2img — no background folder or folder empty`,
            scenario_id: scenarioId, turn_id: turnId,
            output: { bg_path: bgPath, method: bgMethod } });

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

    // Resolve IP-Adapter reference image (main character's stored reference_image path)
    let referenceImageBase64 = null;
    if (config.ipadapter_enabled && !isBackground) {
      const mainCharRef = characters.find(c => c.role !== 'player') || characters[0] || null;
      if (mainCharRef?.reference_image) {
        const refPath = path.join(IMAGES_DIR, mainCharRef.reference_image);
        if (fs.existsSync(refPath)) {
          referenceImageBase64 = fs.readFileSync(refPath).toString('base64');
        }
      }
    }

    const basePayload = _buildA1111Payload(config, prompt, negative, referenceImageBase64);

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
      genResult = await a1111.img2img(baseUrl, {
        ...basePayload,
        init_images:        [`data:image/png;base64,${bgBase64}`],
        denoising_strength: config.img2img_denoising ?? 0.45,
        resize_mode:        1,
      }, savePath);
    } else {
      genResult = await a1111.txt2img(baseUrl, basePayload, savePath);
    }

    audit({ pipeline_run_id: runId, service: 'a1111', stage: 'a1111_call',
            status: 'success', message: `generation complete, seed=${genResult.seed}`,
            scenario_id: scenarioId, turn_id: turnId,
            duration_ms: Date.now() - t1,
            output: { seed: genResult.seed, model_name: genResult.model_name,
                      model_hash: genResult.model_hash, generation_time_ms: genResult.generation_time_ms } });

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
      });
    }

    const duration = Date.now() - t0;
    log('image-pipeline', 'complete', { runId, mode, scenarioId, filename, duration_ms: duration });

    audit({ pipeline_run_id: runId, service: 'image-pipeline', stage: 'complete',
            status: 'success', message: `pipeline done in ${duration}ms`,
            scenario_id: scenarioId, turn_id: turnId, duration_ms: duration });

    return { ok: true, imageId, filename, savePath };

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
