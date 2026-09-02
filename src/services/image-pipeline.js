import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from '../db.js';
import { IMAGES_DIR } from '../paths.js';
import { resolveEffectiveConfig } from './config-resolver.js';
import { buildCharacterAppearance, readFaceRefBase64 } from './character-appearance.js';
import { buildPrompt } from './prompt-builder.js';
import { resolveShotActionSync, normalizeShotAction } from './image-shot-action.js';
import { parseVisualDirections, visualDirectionPromptText } from './visual-direction.js';
import { getScenarioClothing } from './clothing.js';
import { audit } from './audit.js';
import { log, logError } from '../logger.js';
import broadcast from '../broadcast.js';
import * as a1111 from './a1111.js';

const VALID_MODES = new Set(['scene', 'portrait', 'fullbody']);

const _getScenario = db.prepare('SELECT * FROM scenarios WHERE id = ?');
const _getTurn = db.prepare('SELECT * FROM turns WHERE id = ? AND scenario_id = ?');
const _getLocation = db.prepare('SELECT * FROM locations WHERE id = ?');
const _getScenarioCast = db.prepare(`
  SELECT c.* FROM characters c
  JOIN scenario_characters sc ON c.id = sc.character_id
  WHERE sc.scenario_id = ? ORDER BY c.name
`);
const _getCharactersByIds = db.prepare('SELECT * FROM characters WHERE id = ?');

const _insertImage = db.prepare(`
  INSERT INTO scene_images (
    scenario_id, turn_id, filename, mode, generation_method,
    prompt_used, negative_used, look_id, seed, steps, cfg, width, height,
    model_name, model_hash, generation_time_ms, face_ref_json,
    prompt_parts_json, character_ids_json, pipeline_run_id
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

function _audit(pipelineRunId, scenarioId, turnId, stage, status, message, extra) {
  try {
    audit({
      pipeline_run_id: pipelineRunId,
      service: 'image-pipeline',
      stage,
      status,
      message: message || '',
      scenario_id: scenarioId ?? null,
      turn_id: turnId ?? null,
      ...extra,
    });
  } catch (err) {
    // audit() already guards its own DB/file writes and should never throw,
    // but the pipeline itself must never fail because of a logging problem.
    console.error('[image-pipeline] audit call failed:', err.message);
  }
}

/**
 * One orchestrator for every image type. mode: 'scene' | 'portrait' | 'fullbody'.
 * Always on-command — never call this automatically from a narrator turn.
 */
export async function generate({ scenarioId, turnId = null, mode = 'scene', actionText, characterAction = '', characterIds = null, framing = 'auto' } = {}) {
  const pipelineRunId = crypto.randomUUID();
  const t0 = Date.now();

  if (!scenarioId) throw new Error('scenarioId is required');
  if (!VALID_MODES.has(mode)) throw new Error(`invalid mode "${mode}" — must be one of scene, portrait, fullbody`);

  _audit(pipelineRunId, scenarioId, turnId, 'start', 'info', `generate mode=${mode}`);

  try {
    const scenario = _getScenario.get(scenarioId);
    if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

    // ── resolve_config ──────────────────────────────────────────────
    const config = resolveEffectiveConfig(db);
    _audit(pipelineRunId, scenarioId, turnId, 'resolve_config', 'info',
      `look=${config.look ? config.look.name : '(none)'}`, { input: { checkpoint: config.checkpoint, steps: config.steps, cfg: config.cfg } });

    const healthCheck = await a1111.checkHealth(config.a1111_url);
    if (!healthCheck.ok) {
      throw new Error(`A1111 is not reachable at ${config.a1111_url}: ${healthCheck.error}`);
    }

    // ── load_context ────────────────────────────────────────────────
    let turn = null;
    if (turnId) {
      turn = _getTurn.get(turnId, scenarioId);
      if (!turn) throw new Error(`Turn ${turnId} not found in scenario ${scenarioId}`);
    }
    const scenarioCast = _getScenarioCast.all(scenarioId);
    const castById = new Map(scenarioCast.map((character) => [Number(character.id), character]));
    let castRows;
    if (mode === 'portrait' || mode === 'fullbody') {
      // Portrait/fullbody never fall back to the full scenario cast — that produced
      // confusing "got N" errors when characterIds was omitted or empty.
      if (!Array.isArray(characterIds) || characterIds.length !== 1) {
        throw new Error(
          `mode "${mode}" requires exactly one character id — got ${Array.isArray(characterIds) ? characterIds.length : 0}`
        );
      }
      castRows = characterIds.map((id) => castById.get(Number(id))).filter(Boolean);
      if (castRows.length !== 1) {
        throw new Error(`mode "${mode}" character id ${characterIds[0]} not found`);
      }
    } else if (Array.isArray(characterIds) && characterIds.length) {
      if (characterIds.length > 2) throw new Error('scene mode allows at most two character ids');
      castRows = characterIds.map((id) => castById.get(Number(id))).filter(Boolean);
      if (castRows.length !== characterIds.length) throw new Error('every selected scene character must belong to this scenario');
    } else {
      castRows = scenarioCast;
    }
    let resolvedAction = '';
    if (actionText != null && String(actionText).trim()) resolvedAction = normalizeShotAction(String(actionText).trim());
    else if (turn && mode === 'fullbody') {
      const direction = parseVisualDirections(turn.image_direction_json, scenarioCast).fullbody_by_character[String(castRows[0]?.id)];
      resolvedAction = visualDirectionPromptText(direction, 'fullbody');
    } else if (turn) resolvedAction = resolveShotActionSync(turn).text || '';
    if (mode === 'fullbody' && resolvedAction && !resolvedAction.includes('full-body composition')) {
      resolvedAction = visualDirectionPromptText({ action_text: resolvedAction, framing }, 'fullbody');
    }

    const location = scenario.active_location_id ? _getLocation.get(scenario.active_location_id) : null;
    const locationTags = location ? (location.description || location.short_desc || '') : '';
    const backgroundPath = location?.background_image_path
      ? (path.isAbsolute(location.background_image_path) ? location.background_image_path : path.join(IMAGES_DIR, location.background_image_path))
      : null;
    const hasBackground = !!(backgroundPath && fs.existsSync(backgroundPath));

    const clothingParts = castRows.map((c) => getScenarioClothing(scenarioId, c.id)).filter(Boolean);
    const clothingText = clothingParts.join(', ');

    _audit(pipelineRunId, scenarioId, turnId, 'load_context', 'info',
      `characters=${castRows.length} location=${location ? location.name : '(none)'} background=${hasBackground}`);

    // ── character appearance + FaceID reference ────────────────────
    const appearances = castRows.map(buildCharacterAppearance);
    const faceRefCharacter = castRows.find((c) => c.reference_image_path) || null;
    let faceRefBase64 = null;
    let controlNetUnit = null;
    const faceRefJson = [];

    if (faceRefCharacter) {
      faceRefBase64 = readFaceRefBase64(faceRefCharacter);
      if (faceRefBase64) {
        const master = db.prepare("SELECT key, value FROM global_config WHERE key IN ('a1111_faceid_model','a1111_faceid_module')").all();
        const masterMap = Object.fromEntries(master.map((r) => [r.key, r.value]));
        const faceidModel = masterMap.a1111_faceid_model || '';
        const faceidModule = masterMap.a1111_faceid_module || 'ip-adapter_clip_sdxl';

        if (!faceidModel) {
          log('image-pipeline', 'faceid_skipped', { reason: 'no a1111_faceid_model configured' });
        } else {
          const cnStatus = await a1111.checkControlNetAvailable(config.a1111_url);
          if (!cnStatus.available) {
            log('image-pipeline', 'faceid_skipped', { reason: 'sd-webui-controlnet extension not detected' });
          } else {
            controlNetUnit = a1111.buildFaceIdControlNetUnit(faceRefBase64, { model: faceidModel, module: faceidModule, weight: 0.6 });
            faceRefJson.push({ character_id: faceRefCharacter.id, path: faceRefCharacter.reference_image_path });
          }
        }
      }
    }

    // ── build_prompt ────────────────────────────────────────────────
    const built = buildPrompt({
      look: config.look,
      characters: appearances,
      characterAction: mode === 'fullbody' ? '' : characterAction,
      actionText: resolvedAction,
      clothingText,
      locationTags,
      masterNegative: config.master_negative,
      mode,
      hasFaceRef: !!controlNetUnit,
    });
    _audit(pipelineRunId, scenarioId, turnId, 'build_prompt', 'info', 'prompt assembled',
      { output: { prompt: built.prompt, negative: built.negative, parts: built.parts } });

    // ── set_model (only if the effective checkpoint differs) ──────
    if (config.checkpoint) {
      try {
        const options = await a1111.getOptions(config.a1111_url);
        if (options?.sd_model_checkpoint && !options.sd_model_checkpoint.startsWith(config.checkpoint)) {
          await a1111.setModel(config.a1111_url, config.checkpoint);
          _audit(pipelineRunId, scenarioId, turnId, 'set_model', 'info', `switched to ${config.checkpoint}`);
        }
      } catch (err) {
        // Checkpoint switching is best-effort — generation proceeds on whatever
        // model is already loaded rather than failing the whole request.
        log('image-pipeline', 'set_model_failed', { error: err.message });
      }
    }

    // ── generate (txt2img or img2img) ──────────────────────────────
    const generationMethod = hasBackground ? 'img2img' : 'txt2img';
    const payload = {
      prompt: built.prompt,
      negative_prompt: built.negative,
      steps: config.steps,
      cfg_scale: config.cfg,
      width: config.width,
      height: config.height,
      sampler_name: config.sampler,
      scheduler: config.scheduler,
      restore_faces: config.restore_faces,
      tiling: config.tiling,
      seed: -1,
      n_iter: 1,
      batch_size: 1,
    };
    if (config.vae || config.clip_skip != null) {
      payload.override_settings = {};
      if (config.vae) payload.override_settings.sd_vae = config.vae;
      if (config.clip_skip != null) payload.override_settings.CLIP_stop_at_last_layers = config.clip_skip;
      payload.override_settings_restore_afterwards = true;
    }
    if (controlNetUnit) Object.assign(payload, controlNetUnit);
    if (hasBackground) {
      payload.init_images = [fs.readFileSync(backgroundPath).toString('base64')];
      payload.denoising_strength = 0.45;
      payload.resize_mode = 1;
    }

    const scenarioDir = path.join(IMAGES_DIR, String(scenarioId));
    const filename = `${Date.now()}_${mode}.png`;
    const savePath = path.join(scenarioDir, filename);

    let genResult;
    try {
      genResult = hasBackground
        ? await a1111.img2img(config.a1111_url, payload, savePath)
        : await a1111.txt2img(config.a1111_url, payload, savePath);
    } catch (err) {
      _audit(pipelineRunId, scenarioId, turnId, 'generate', 'failed', err.message);
      throw err;
    }
    _audit(pipelineRunId, scenarioId, turnId, 'generate', 'success',
      `${generationMethod} in ${genResult.generation_time_ms}ms`, { duration_ms: genResult.generation_time_ms });

    // ── file_verify ─────────────────────────────────────────────────
    if (!fs.existsSync(savePath)) {
      throw new Error(`Generated file was not found on disk after generation: ${savePath}`);
    }
    _audit(pipelineRunId, scenarioId, turnId, 'file_verify', 'success', filename);

    // ── persist ─────────────────────────────────────────────────────
    const ins = _insertImage.run(
      scenarioId,
      turnId ?? null,
      filename,
      mode,
      generationMethod,
      built.prompt,
      built.negative,
      config.look ? config.look.id : null,
      genResult.seed,
      config.steps,
      config.cfg,
      config.width,
      config.height,
      genResult.model_name,
      genResult.model_hash,
      genResult.generation_time_ms,
      JSON.stringify(faceRefJson),
      JSON.stringify(built.parts),
      JSON.stringify(castRows.map((c) => c.id)),
      pipelineRunId,
    );
    const imageRow = db.prepare('SELECT * FROM scene_images WHERE id = ?').get(ins.lastInsertRowid);
    _audit(pipelineRunId, scenarioId, turnId, 'persist', 'success', `scene_images.id=${imageRow.id}`);

    // ── broadcast ───────────────────────────────────────────────────
    broadcast.send('imageready', {
      scenarioId: Number(scenarioId),
      turnId: turnId ? Number(turnId) : null,
      image: imageRow,
    });
    _audit(pipelineRunId, scenarioId, turnId, 'complete', 'success', `total ${Date.now() - t0}ms`, { duration_ms: Date.now() - t0 });

    return { ok: true, image: imageRow, pipeline_run_id: pipelineRunId };
  } catch (err) {
    logError('image-pipeline', 'generate_failed', err);
    _audit(pipelineRunId, scenarioId, turnId, 'failed', 'failed', err.message);
    throw err;
  }
}
