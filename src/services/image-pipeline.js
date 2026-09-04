import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from '../db.js';
import { IMAGES_DIR } from '../paths.js';
import { resolveEffectiveConfig } from './config-resolver.js';
import { buildCharacterAppearance, readFaceRefBase64 } from './character-appearance.js';
import { readPoseControlBase64, getPoseMeta } from './pose-library.js';
import { buildPrompt, stripStyleWords } from './prompt-builder.js';
import { resolveShotActionSync, normalizeShotAction } from './image-shot-action.js';
import { parseVisualDirections, visualDirectionPromptText, SCENE_FRAMINGS, FULLBODY_FRAMINGS } from './visual-direction.js';
import { getScenarioClothing } from './clothing.js';
import { resolveScenarioPlace } from './scenario-place.js';
import { cancelWarmup } from './image-warmup.js';
import { audit } from './audit.js';
import { log, logError } from '../logger.js';
import broadcast from '../broadcast.js';
import * as a1111 from './a1111.js';

const VALID_MODES = new Set(['scene', 'portrait', 'fullbody']);

// Marks an error as caused by the caller's request (bad ids, unknown pose,
// unusable selection) rather than by an upstream A1111 failure, so the route
// can answer 400 instead of 502. See src/routes/images.js.
function _badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// A1111 is mid-render and its single-threaded API cannot take this job yet.
function _busy(message) {
  return Object.assign(new Error(message), { status: 409 });
}

const _getScenario = db.prepare('SELECT * FROM scenarios WHERE id = ?');
const _getTurn = db.prepare('SELECT * FROM turns WHERE id = ? AND scenario_id = ?');
const _getLocation = db.prepare('SELECT * FROM locations WHERE id = ?');
const _getScenarioCast = db.prepare(`
  SELECT c.* FROM characters c
  JOIN scenario_characters sc ON c.id = sc.character_id
  WHERE sc.scenario_id = ? ORDER BY c.name
`);

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
export async function generate({ scenarioId, turnId = null, mode = 'scene', actionText, characterAction = '', characterIds = null, framing = 'auto', poseId = null } = {}) {
  const pipelineRunId = crypto.randomUUID();
  const t0 = Date.now();

  if (!scenarioId) throw _badRequest('scenarioId is required');
  if (!VALID_MODES.has(mode)) throw _badRequest(`invalid mode "${mode}" — must be one of scene, portrait, fullbody`);

  _audit(pipelineRunId, scenarioId, turnId, 'start', 'info', `generate mode=${mode}`);

  try {
    const scenario = _getScenario.get(scenarioId);
    if (!scenario) throw _badRequest(`Scenario ${scenarioId} not found`);

    // ── resolve_config ──────────────────────────────────────────────
    const config = resolveEffectiveConfig(db);
    _audit(pipelineRunId, scenarioId, turnId, 'resolve_config', 'info',
      `look=${config.look ? config.look.name : '(none)'}`, { input: { checkpoint: config.checkpoint, steps: config.steps, cfg: config.cfg } });

    // Stop our own warm-up first so it neither queues ahead of this job nor
    // registers as "A1111 is busy" in the check just below.
    await cancelWarmup(config.a1111_url);

    const healthCheck = await a1111.checkHealth(config.a1111_url);
    if (!healthCheck.ok) {
      throw new Error(`A1111 is not reachable at ${config.a1111_url}: ${healthCheck.error}`);
    }

    // A1111's raw API is single-threaded: submitting now would block for the
    // whole of the other render, and every catalog probe in between would time
    // out and be misreported as "unreachable". Fail fast with a clear message.
    const busyCheck = await a1111.getProgressSafe(config.a1111_url);
    if (busyCheck.busy) {
      const pct = Math.round(busyCheck.progress * 100);
      const eta = busyCheck.eta_seconds ? ` (~${Math.round(busyCheck.eta_seconds)}s left)` : '';
      throw _busy(`A1111 is still finishing another image — ${pct}%${eta}. Wait for it to complete, then generate again.`);
    }

    // ── load_context ────────────────────────────────────────────────
    let turn = null;
    if (turnId) {
      turn = _getTurn.get(turnId, scenarioId);
      if (!turn) throw _badRequest(`Turn ${turnId} not found in scenario ${scenarioId}`);
    }
    const scenarioCast = _getScenarioCast.all(scenarioId);
    const castById = new Map(scenarioCast.map((character) => [Number(character.id), character]));
    let castRows;
    if (mode === 'portrait' || mode === 'fullbody') {
      // Portrait/fullbody never fall back to the full scenario cast — that produced
      // confusing "got N" errors when characterIds was omitted or empty.
      if (!Array.isArray(characterIds) || characterIds.length !== 1) {
        throw _badRequest(
          `mode "${mode}" requires exactly one character id — got ${Array.isArray(characterIds) ? characterIds.length : 0}`
        );
      }
      castRows = characterIds.map((id) => castById.get(Number(id))).filter(Boolean);
      if (castRows.length !== 1) {
        throw _badRequest(`mode "${mode}" character id ${characterIds[0]} not found`);
      }
    } else if (Array.isArray(characterIds) && characterIds.length) {
      if (characterIds.length > 2) throw _badRequest('scene mode allows at most two character ids');
      castRows = characterIds.map((id) => castById.get(Number(id))).filter(Boolean);
      if (castRows.length !== characterIds.length) throw _badRequest('every selected scene character must belong to this scenario');
    } else {
      castRows = scenarioCast;
    }
    // `framing` is an untrusted request value — clamp it to the set valid for
    // this mode before it can reach the prompt.
    const safeFraming = mode === 'fullbody'
      ? (FULLBODY_FRAMINGS.has(framing) ? framing : 'auto')
      : (SCENE_FRAMINGS.has(framing) ? framing : 'auto');

    let resolvedAction = '';
    if (actionText != null && String(actionText).trim()) resolvedAction = normalizeShotAction(String(actionText).trim());
    else if (turn && mode === 'fullbody') {
      const direction = parseVisualDirections(turn.image_direction_json, scenarioCast).fullbody_by_character[String(castRows[0]?.id)];
      resolvedAction = visualDirectionPromptText(direction, 'fullbody');
    } else if (turn) resolvedAction = resolveShotActionSync(turn).text || '';
    if (mode === 'fullbody' && !resolvedAction.includes('full-body composition')) {
      // The full-figure cue is mandatory for fullbody even when there is no
      // action text at all, otherwise the model returns a portrait crop.
      resolvedAction = visualDirectionPromptText({ action_text: resolvedAction, framing: safeFraming }, 'fullbody')
        || 'full-body composition, entire figure in frame';
    } else if (mode === 'scene' && safeFraming !== 'auto') {
      resolvedAction = [`${safeFraming} shot`, resolvedAction].filter(Boolean).join(', ');
    }

    const locationCard = scenario.active_location_id ? _getLocation.get(scenario.active_location_id) : null;
    const place = resolveScenarioPlace({ scenario, location: locationCard });
    const locationTags = place ? place.description : '';
    const backgroundPath = place?.background_image_path
      ? (path.isAbsolute(place.background_image_path) ? place.background_image_path : path.join(IMAGES_DIR, place.background_image_path))
      : null;
    const hasBackground = !!(backgroundPath && fs.existsSync(backgroundPath));

    const clothingParts = castRows.map((c) => getScenarioClothing(scenarioId, c.id)).filter(Boolean);
    const clothingText = clothingParts.join(', ');

    _audit(pipelineRunId, scenarioId, turnId, 'load_context', 'info',
      `characters=${castRows.length} location=${place ? place.name : '(none)'} background=${hasBackground}`);

    // ── character appearance + FaceID reference ────────────────────
    const appearances = castRows.map(buildCharacterAppearance);
    const faceRefCharacter = castRows.find((c) => c.reference_image_path) || null;
    let faceRefBase64 = null;
    let controlNetUnit = null;
    let poseControlUnit = null;
    let posePromptHint = '';
    let controlNetStatus = null;
    const faceRefJson = [];
    const selectedPoseId = typeof poseId === 'string' ? poseId.trim() : '';
    const masterRows = db.prepare("SELECT key, value FROM global_config WHERE key IN ('a1111_faceid_model','a1111_faceid_module','a1111_pose_model','a1111_pose_module','a1111_faceid_weight','a1111_pose_weight')").all();
    const masterMap = Object.fromEntries(masterRows.map((row) => [row.key, row.value]));
    // ControlNet weights are optional overrides. Blank/invalid falls back to the
    // build-helper default (FaceID 0.6, pose 0.75); values are clamped to the
    // range the A1111 ControlNet UI itself allows.
    const _cnWeight = (raw, fallback) => {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : fallback;
    };
    const faceidWeight = _cnWeight(masterMap.a1111_faceid_weight, 0.6);
    const poseWeight = _cnWeight(masterMap.a1111_pose_weight, 0.75);

    // Memoised as a promise, not a resolved value, so the network round-trip can
    // be started here (it overlaps the synchronous prompt assembly and the
    // set_model /options call) and awaited later where the result is needed.
    function getControlNetStatus() {
      if (!controlNetStatus) controlNetStatus = a1111.checkControlNetAvailable(config.a1111_url);
      return controlNetStatus;
    }
    if (faceRefCharacter || selectedPoseId) getControlNetStatus();

    if (faceRefCharacter) {
      faceRefBase64 = readFaceRefBase64(faceRefCharacter);
      if (faceRefBase64) {
        const faceidModel = masterMap.a1111_faceid_model || '';
        const faceidModule = masterMap.a1111_faceid_module || '';

        if (!faceidModel) {
          log('image-pipeline', 'faceid_skipped', { reason: 'no a1111_faceid_model configured' });
        } else if (!faceidModule) {
          // The faceid-config route always stores a verified model+module pair.
          // A blank module here means the config was hand-edited or half-migrated;
          // fall through to "no FaceID" rather than send an SDXL-CLIP preprocessor
          // that does not belong with an IP-Adapter FaceID model.
          log('image-pipeline', 'faceid_skipped', { reason: 'a1111_faceid_module missing for configured model' });
        } else {
          const cnStatus = await getControlNetStatus();
          if (!cnStatus.available) {
            log('image-pipeline', 'faceid_skipped', { reason: 'sd-webui-controlnet extension not detected' });
          } else {
            controlNetUnit = a1111.buildFaceIdControlNetUnit(faceRefBase64, { model: faceidModel, module: faceidModule, weight: faceidWeight });
            faceRefJson.push({ character_id: faceRefCharacter.id, path: faceRefCharacter.reference_image_path });
          }
        }
      }
    }

    // A skipped pose still produces an image (Critical Rule 7 — soft-fail when
    // ControlNet is unavailable); the reason is surfaced in the response and the
    // audit trail so the UI can tell the user the skeleton was dropped. Only a
    // selection the user must actively fix (unknown id, wrong subject count) is a
    // hard 400.
    let poseSkippedReason = null;
    if (selectedPoseId) {
      let poseMeta;
      try {
        poseMeta = getPoseMeta(selectedPoseId);
      } catch (err) {
        throw _badRequest(err.message); // unknown / malformed pose id
      }
      if (poseMeta.subjects !== castRows.length) {
        throw _badRequest(
          `Pose "${poseMeta.label}" is drawn for ${poseMeta.subjects} ${poseMeta.subjects === 1 ? 'person' : 'people'}, ` +
          `but this image has ${castRows.length}. Pick a matching pose or adjust the selected characters — ` +
          'a mismatched skeleton makes the model render a phantom figure or merge the cast.'
        );
      }
      const poseModel = masterMap.a1111_pose_model || '';
      const poseModule = masterMap.a1111_pose_module || '';
      const cnStatus = (poseModel && poseModule) ? await getControlNetStatus() : null;
      if (!poseModel || !poseModule) {
        poseSkippedReason = 'Pose ControlNet is not configured — choose a verified OpenPose option in Settings.';
      } else if (!cnStatus.available) {
        poseSkippedReason = 'the sd-webui-controlnet extension is not reachable.';
      } else if (!cnStatus.models.includes(poseModel)) {
        poseSkippedReason = 'the configured pose ControlNet model is not in the running A1111 catalog.';
      } else {
        posePromptHint = stripStyleWords(poseMeta.description);
        poseControlUnit = a1111.buildOpenPoseControlNetUnit(readPoseControlBase64(selectedPoseId), {
          model: poseModel,
          module: poseModule,
          weight: poseWeight,
        });
      }
      if (poseSkippedReason) log('image-pipeline', 'pose_skipped', { reason: poseSkippedReason });
    }

    let controlNetPayload = a1111.buildControlNetPayload([controlNetUnit, poseControlUnit]);
    let controlNetCount = controlNetPayload?.alwayson_scripts?.controlnet?.args?.length || 0;
    if (controlNetCount > 1) {
      const capacity = await a1111.getControlNetUnitCapacity(config.a1111_url);
      if (capacity < controlNetCount) {
        // Drop the pose rather than fail the whole image — an attached FaceID
        // lock is worth keeping even when the skeleton will not fit.
        poseSkippedReason = `A1111 ControlNet is configured for ${capacity} unit(s); the pose skeleton did not fit alongside FaceID. Increase the unit count in Settings to use both.`;
        poseControlUnit = null;
        posePromptHint = '';
        controlNetPayload = a1111.buildControlNetPayload([controlNetUnit]);
        controlNetCount = controlNetPayload?.alwayson_scripts?.controlnet?.args?.length || 0;
        log('image-pipeline', 'pose_skipped', { reason: poseSkippedReason });
      }
    }
    if (poseSkippedReason) {
      _audit(pipelineRunId, scenarioId, turnId, 'pose', 'warn', `pose skipped: ${poseSkippedReason}`);
    }

    // ── build_prompt ────────────────────────────────────────────────
    // A selected pose drives geometry via the skeleton; a short style-stripped
    // text cue from the pose's own description reinforces it in the prompt.
    const actionForPrompt = [resolvedAction, posePromptHint].filter(Boolean).join(', ');
    const built = buildPrompt({
      look: config.look,
      characters: appearances,
      characterAction: mode === 'fullbody' ? '' : characterAction,
      actionText: actionForPrompt,
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
        // The health probe already fetched /options; reuse it rather than hit
        // A1111 a second time for the same body.
        const options = healthCheck.options || await a1111.getOptions(config.a1111_url);
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
      // GFPGAN face restoration re-synthesises the face after sampling, which
      // undoes the identity an IP-Adapter FaceID unit just enforced. Skip it
      // whenever a FaceID reference is attached.
      restore_faces: controlNetUnit ? false : config.restore_faces,
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
    Object.assign(payload, controlNetPayload);
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
      pose_skipped: poseSkippedReason || null,
    });
    _audit(pipelineRunId, scenarioId, turnId, 'complete', 'success', `total ${Date.now() - t0}ms`, { duration_ms: Date.now() - t0 });

    return { ok: true, image: imageRow, pipeline_run_id: pipelineRunId, pose_skipped: poseSkippedReason || null };
  } catch (err) {
    logError('image-pipeline', 'generate_failed', err);
    _audit(pipelineRunId, scenarioId, turnId, 'failed', 'failed', err.message);
    throw err;
  }
}
