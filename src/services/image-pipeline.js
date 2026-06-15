import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import db from '../db.js';
import { IMAGES_DIR, BACKGROUNDS_DIR } from '../paths.js';
import { log, logError } from '../logger.js';
import broadcast from '../broadcast.js';
import { resolveEffectiveConfig } from './config-resolver.js';
import { buildPrompt } from './prompt-builder.js';
import { audit } from './audit.js';
import * as a1111 from './a1111.js';

function _locationSlug(name) {
  return (name || 'location').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const IMAGE_EXT = /\.(png|jpg|jpeg)$/i;

function _buildA1111Payload(config, prompt, negative) {
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

  return payload;
}

function _resolveBackground(location) {
  if (!location) return null;
  const folder = location.background_folder || '';
  if (!folder) return null;

  const rows = db.prepare(
    'SELECT filename, is_default FROM location_backgrounds WHERE location_id = ?'
  ).all(location.id);
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
      turn = db.prepare('SELECT * FROM turns WHERE id = ?').get(turnId);
      if (turn?.scene_card_json) {
        try { sceneCard = JSON.parse(turn.scene_card_json); } catch (_) {}
      }
      if (turn?.location_id) {
        location = db.prepare('SELECT * FROM locations WHERE id = ?').get(turn.location_id);
      }
    }

    if (opts.locationId && !location) {
      location = db.prepare('SELECT * FROM locations WHERE id = ?').get(opts.locationId);
    }

    characters = db.prepare(`
      SELECT c.* FROM characters c
      JOIN scenario_characters sc ON c.id = sc.character_id
      WHERE sc.scenario_id = ?
      ORDER BY c.name
    `).all(scenarioId);

    const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);

    // For background mode use location image_tags as the scene image prompt
    if (isBackground && location) {
      sceneCard = { image_prompt: location.image_tags || location.description || location.name };
    }

    if (opts.directPrompt && opts.rawPrompt) {
      sceneCard = { image_prompt: opts.rawPrompt };
    }

    // Backgrounds are never img2img (we're generating them)
    let bgPath = isBackground ? null : _resolveBackground(location);

    const { prompt, negative, parts } = buildPrompt({
      sceneCard, characters, location, scenario, config,
      isImg2img: bgPath != null,
    });

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
    const basePayload = _buildA1111Payload(config, prompt, negative);

    let genResult;
    const t1 = Date.now();
    if (bgPath) {
      const bgBase64 = fs.readFileSync(bgPath).toString('base64');
      genResult = await a1111.img2img(baseUrl, {
        ...basePayload,
        init_images:        [`data:image/png;base64,${bgBase64}`],
        denoising_strength: 0.45,
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

    const filename = path.basename(savePath);

    audit({ pipeline_run_id: runId, service: 'image-pipeline', stage: 'file_verify',
            status: 'success', message: `file verified: ${filename}`,
            scenario_id: scenarioId, turn_id: turnId });

    // Stage 6: persist (skip for background mode — caller handles location update)
    let imageId = null;
    if (!isBackground) {
      const ins = db.prepare(`
        INSERT INTO scene_images (
          scenario_id, turn_id, filename, mode, generation_method,
          background_used, prompt_used, negative_used, profile_id,
          seed, steps, cfg, width, height, model_name, model_hash, generation_time_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
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
