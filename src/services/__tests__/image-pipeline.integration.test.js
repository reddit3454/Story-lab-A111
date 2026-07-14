// Integration regression tests for CF-1 (story-enhancer clothing preservation) and
// CF-2 (FaceID reference character selection) inside the real generate() orchestration.
//
// Uses a real in-memory SQLite database (node:sqlite via db.js's own real schema,
// redirected off the real story-lab.db by mocking paths.js) and a mocked global fetch
// (no real A1111 / Ollama). This exercises the actual stage sequencing, audit logging,
// and wiring inside image-pipeline.js — not just the pure helper functions it calls — so
// a regression in how those helpers are *used* would be caught here even if their own
// unit tests still pass.
//
// paths.js/db.js are mocked ONCE for this whole file (ES modules are cached by resolved
// URL — re-mocking per-test would not create a fresh db.js instance, it would silently
// keep reusing the first one). Every test therefore shares one in-memory DB and scopes
// its own queries by the scenario/character IDs it just seeded.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-cf1cf2-'));
const DIRS = {
  data: path.join(ROOT, 'data'),
  images: path.join(ROOT, 'images'),
  backgrounds: path.join(ROOT, 'backgrounds'),
  audio: path.join(ROOT, 'audio'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT,
    PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DIRS.data,
    IMAGES_DIR: DIRS.images,
    BACKGROUNDS_DIR: DIRS.backgrounds,
    AUDIO_DIR: DIRS.audio,
    DB_PATH: ':memory:',
    AUDIT_LOG_PATH: path.join(DIRS.data, 'audit.jsonl'),
  },
});

const { default: db } = await import('../../db.js');
const { generate } = await import('../image-pipeline.js');

const FAKE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function fakeA1111Response() {
  return {
    status: 200,
    json: {
      images: [FAKE_PNG_BASE64],
      info: JSON.stringify({ seed: 1, sd_model_name: 'fake', sd_model_hash: 'abc' }),
    },
  };
}

// Scene-picker and story-enhancer both call ollama.js's chat() -> POST /api/chat.
// Differentiate by payload content: scene-picker's prompt text embeds the literal
// schema key "mainSubject"; the story-enhancer path is anything else.
function ollamaChatRouter({ pickerMainSubject, enhancerPositive, enhancerNegative = 'worst quality, blurry' }) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    const userMsg = body.messages.find(m => m.role === 'user')?.content || '';
    if (userMsg.includes('mainSubject')) {
      return {
        status: 200,
        json: { message: { content: JSON.stringify({
          summary: 'a moment', mainSubject: pickerMainSubject, visibleAction: 'standing quietly',
          setting: 'a room', shotType: 'medium', imageabilityScore: 7, penaltyReason: null,
        }) } },
      };
    }
    return {
      status: 200,
      json: { message: { content: `${enhancerPositive}\n\nNegative prompt: ${enhancerNegative}` } },
    };
  };
}

function installFetch(t, routes) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, init });
    const key = Object.keys(routes).find(k => urlStr.includes(k));
    if (!key) {
      throw new Error(`installFetch: no mock route matches ${urlStr}`);
    }
    const handler = routes[key];
    const result = typeof handler === 'function' ? await handler(urlStr, init) : handler;
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.json,
      text: async () => JSON.stringify(result.json ?? {}),
    };
  });
  return calls;
}

// Matches resolveIpAdapterModule()'s default fallback when a1111_model doesn't imply
// SDXL (no a1111_model configured in these tests) — see ipadapter-resolution.js.
const TEST_IPADAPTER_MODEL = 'ip-adapter-plus-face_sd15 [testhash]';
const TEST_IPADAPTER_MODULE = 'ip-adapter_clip_sd15';

let _configSeeded = false;
function seedBaseConfig() {
  if (_configSeeded) return;
  _configSeeded = true;
  const set = db.prepare(`INSERT OR REPLACE INTO global_config (key, value) VALUES (?, ?)`);
  set.run('narrator_model', 'fake-model');
  set.run('picker_model', 'fake-model');
  set.run('ipadapter_enabled', 'true');
  set.run('ipadapter_model', TEST_IPADAPTER_MODEL);
}

// Standard ControlNet catalog routes — every test that exercises FaceID needs both the
// model AND module preflight checks to pass (see getControlNetCatalog/CF-A6).
const CONTROLNET_CATALOG_ROUTES = {
  '/controlnet/model_list': { status: 200, json: { model_list: [TEST_IPADAPTER_MODEL] } },
  '/controlnet/module_list': { status: 200, json: { module_list: [TEST_IPADAPTER_MODULE] } },
};

function seedScenario({ npcNames, clothingByName, referenceByName = {}, withNarratorTurn = true }) {
  seedBaseConfig();
  const scenarioId = db.prepare(`INSERT INTO scenarios (title) VALUES ('Test Scenario')`).run().lastInsertRowid;

  const idByName = {};
  for (const name of npcNames) {
    const charId = db.prepare(
      `INSERT INTO characters (name, role, gender) VALUES (?, 'character', 'female')`
    ).run(name).lastInsertRowid;
    idByName[name] = charId;
    db.prepare(`INSERT INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)`).run(scenarioId, charId);
    db.prepare(
      `INSERT INTO scenario_character_state (scenario_id, character_id, current_clothing) VALUES (?, ?, ?)`
    ).run(scenarioId, charId, clothingByName[name] || '');

    if (referenceByName[name]) {
      const relPath = `characters/${charId}/ref.png`;
      const fullPath = path.join(DIRS.images, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, Buffer.from(referenceByName[name], 'utf8'));
      db.prepare(`UPDATE characters SET reference_image_path = ? WHERE id = ?`).run(relPath, charId);
    }
  }

  if (withNarratorTurn) {
    db.prepare(
      `INSERT INTO turns (scenario_id, turn_number, role, content_text) VALUES (?, 1, 'narrator', 'She stood quietly in the room.')`
    ).run(scenarioId);
  }

  return { scenarioId, idByName };
}

function lastSceneImage(scenarioId) {
  return db.prepare(
    `SELECT * FROM scene_images WHERE scenario_id = ? ORDER BY id DESC LIMIT 1`
  ).get(scenarioId);
}

function lastBuildPromptAudit(scenarioId) {
  const row = db.prepare(
    `SELECT detail_json FROM audit_events WHERE event = 'build_prompt' AND scenario_id = ? ORDER BY id DESC LIMIT 1`
  ).get(scenarioId);
  return row ? JSON.parse(row.detail_json) : null;
}

// ---------------------------------------------------------------------------
// CF-1 — story-enhancer clothing preservation
// ---------------------------------------------------------------------------

test('CF-1: scene-mode enhancer rewrite still contains authoritative scenario clothing', async (t) => {
  installFetch(t, {
    '/api/chat': ollamaChatRouter({
      pickerMainSubject: 'Riley',
      // Deliberately no clothing mention in the enhancer's own output.
      enhancerPositive: 'masterpiece, best quality, medium shot, standing near window, warm light',
    }),
    ...CONTROLNET_CATALOG_ROUTES,
    '/sdapi/v1/txt2img': () => fakeA1111Response(),
  });

  const { scenarioId } = seedScenario({ npcNames: ['Riley'], clothingByName: { Riley: 'red silk robe' } });
  await generate({ mode: 'scene', scenarioId, turnId: null });

  const detail = lastBuildPromptAudit(scenarioId);
  assert.equal(detail.output.enhancer_applied, true, 'enhancer must have actually run and been applied');
  assert.ok(
    detail.output.final_prompt_snippet.includes('red silk robe'),
    `final prompt snippet must contain authoritative clothing, got: ${detail.output.final_prompt_snippet}`
  );
  assert.ok(
    !detail.output.pre_enhancer_prompt_snippet.includes('warm light'),
    'pre-enhancer snippet must be the deterministic buildPrompt() output, not the enhancer rewrite'
  );

  const image = lastSceneImage(scenarioId);
  assert.ok(image.prompt_used.includes('red silk robe'),
    `saved scene_images.prompt_used must contain authoritative clothing, got: ${image.prompt_used}`);
});

test('CF-1: authoritative clothing survives even when enhancer text names conflicting clothing', async (t) => {
  installFetch(t, {
    '/api/chat': ollamaChatRouter({
      pickerMainSubject: 'Riley',
      enhancerPositive: 'masterpiece, best quality, medium shot, wearing a blue evening gown, ballroom',
    }),
    ...CONTROLNET_CATALOG_ROUTES,
    '/sdapi/v1/txt2img': () => fakeA1111Response(),
  });

  const { scenarioId } = seedScenario({ npcNames: ['Riley'], clothingByName: { Riley: 'red silk robe' } });
  await generate({ mode: 'scene', scenarioId, turnId: null });

  const image = lastSceneImage(scenarioId);
  assert.ok(image.prompt_used.includes('red silk robe'),
    `authoritative clothing must still be present alongside conflicting enhancer text, got: ${image.prompt_used}`);
});

test('CF-1: character mode bypasses Stage 2b entirely (no picker/enhancer Ollama calls) and uses resolved clothing', async (t) => {
  const calls = installFetch(t, {
    '/api/chat': async () => ({ status: 200, json: { message: { content: '{}' } } }),
    ...CONTROLNET_CATALOG_ROUTES,
    '/sdapi/v1/txt2img': () => fakeA1111Response(),
  });

  const { scenarioId, idByName } = seedScenario({ npcNames: ['Riley'], clothingByName: { Riley: 'green sundress' } });
  await generate({ mode: 'character', scenarioId, characterId: idByName.Riley, turnId: null });

  const chatCalls = calls.filter(c => c.url.includes('/api/chat'));
  assert.equal(chatCalls.length, 0, 'character mode must never call the picker or the enhancer');

  const image = lastSceneImage(scenarioId);
  assert.ok(image.prompt_used.includes('green sundress'),
    `character-mode prompt must include resolved scenario clothing, got: ${image.prompt_used}`);
});

// ---------------------------------------------------------------------------
// CF-2 — FaceID reference character selection
// ---------------------------------------------------------------------------

function decodeSentReferenceImage(calls) {
  const call = calls.find(c => c.url.includes('/sdapi/v1/txt2img'));
  assert.ok(call, 'expected a txt2img call to have been made');
  const payload = JSON.parse(call.init.body);
  const cnArgs = payload.alwayson_scripts?.controlnet?.args?.[0];
  assert.ok(cnArgs, 'expected a controlnet arg block in the submitted payload');
  return Buffer.from(cnArgs.image, 'base64').toString('utf8');
}

test('CF-2: character mode FaceID reference matches the character actually being generated (not alphabetical-first)', async (t) => {
  const calls = installFetch(t, {
    ...CONTROLNET_CATALOG_ROUTES,
    '/sdapi/v1/txt2img': () => fakeA1111Response(),
  });

  // Alice sorts before Riley — the pre-fix bug always picked the alphabetically-first NPC.
  const { scenarioId, idByName } = seedScenario({
    npcNames: ['Alice', 'Riley'],
    clothingByName: { Alice: 'jeans', Riley: 'dress' },
    referenceByName: { Alice: 'REF:Alice', Riley: 'REF:Riley' },
    withNarratorTurn: false,
  });

  await generate({ mode: 'character', scenarioId, characterId: idByName.Riley, turnId: null });

  assert.equal(decodeSentReferenceImage(calls), 'REF:Riley',
    'character mode must submit the reference image of the character actually being generated');
});

test('CF-2: scene mode picks the cast member named in mainSubject, disproving the old alphabetical-first-NPC bug', async (t) => {
  const calls = installFetch(t, {
    '/api/chat': ollamaChatRouter({ pickerMainSubject: 'Riley', enhancerPositive: 'masterpiece, standing, medium shot' }),
    ...CONTROLNET_CATALOG_ROUTES,
    '/sdapi/v1/txt2img': () => fakeA1111Response(),
  });

  // Alice sorts before Riley alphabetically; mainSubject names Riley.
  const { scenarioId } = seedScenario({
    npcNames: ['Alice', 'Riley'],
    clothingByName: { Alice: 'jeans', Riley: 'dress' },
    referenceByName: { Alice: 'REF:Alice', Riley: 'REF:Riley' },
  });

  await generate({ mode: 'scene', scenarioId, turnId: null });

  assert.equal(decodeSentReferenceImage(calls), 'REF:Riley',
    'scene mode must use the mainSubject-named character, not the alphabetically-first NPC (Alice)');
});

test('CF-2: legacy sceneCard.characters_present is ignored even if somehow present', async (t) => {
  // Regression guard at the orchestration level (unit-level guard already exists in
  // prompt-resolution.test.js): even if a turn's stored scene_card_json contains the old
  // dead field, generate() must not resurrect it as a signal.
  const calls = installFetch(t, {
    '/api/chat': ollamaChatRouter({ pickerMainSubject: 'nobody in particular', enhancerPositive: 'masterpiece, standing, medium shot' }),
    ...CONTROLNET_CATALOG_ROUTES,
    '/sdapi/v1/txt2img': () => fakeA1111Response(),
  });

  const { scenarioId } = seedScenario({
    npcNames: ['Alice', 'Riley'],
    clothingByName: { Alice: 'jeans', Riley: 'dress' },
    referenceByName: { Alice: 'REF:Alice', Riley: 'REF:Riley' },
    withNarratorTurn: false,
  });
  // Seed a turn whose scene card has the legacy characters_present field naming Riley —
  // it must be ignored; with no picker signal (no narrator turn for the picker to read),
  // resolution must fall back to the first non-player cast member (Alice).
  db.prepare(
    `INSERT INTO turns (scenario_id, turn_number, role, content_text, scene_card_json)
     VALUES (?, 1, 'narrator', 'irrelevant', ?)`
  ).run(scenarioId, JSON.stringify({ characters_present: [{ name: 'Riley' }] }));

  await generate({ mode: 'scene', scenarioId, turnId: null });

  assert.equal(decodeSentReferenceImage(calls), 'REF:Alice',
    'must ignore characters_present and fall back to the first non-player cast member (Alice)');
});

// ---------------------------------------------------------------------------
// CF-A1/CF-A3 — no model configured, and ControlNet payload-level fallback
// ---------------------------------------------------------------------------

test('CF-A3: FaceID is skipped (no controlnet block submitted) when no IP-Adapter model is configured', async (t) => {
  const calls = installFetch(t, {
    ...CONTROLNET_CATALOG_ROUTES,
    '/sdapi/v1/txt2img': () => fakeA1111Response(),
  });

  const { scenarioId, idByName } = seedScenario({
    npcNames: ['Riley'],
    clothingByName: { Riley: 'dress' },
    referenceByName: { Riley: 'REF:Riley' },
    withNarratorTurn: false,
  });
  // Override the base-config model to empty for this scenario's generation.
  db.prepare(`INSERT OR REPLACE INTO global_config (key, value) VALUES ('ipadapter_model', '')`).run();

  await generate({ mode: 'character', scenarioId, characterId: idByName.Riley, turnId: null });

  const call = calls.find(c => c.url.includes('/sdapi/v1/txt2img'));
  const payload = JSON.parse(call.init.body);
  assert.equal(payload.alwayson_scripts?.controlnet, undefined,
    'no model configured must skip FaceID entirely, not submit a guessed model name');
  // The catalog endpoints must never even be hit — cheap early-out on empty model.
  const catalogCalls = calls.filter(c => c.url.includes('/controlnet/model_list') || c.url.includes('/controlnet/module_list'));
  assert.equal(catalogCalls.length, 0, 'must not make a network call to validate a model that was never configured');

  // Restore for subsequent tests in this file.
  db.prepare(`INSERT OR REPLACE INTO global_config (key, value) VALUES ('ipadapter_model', ?)`).run(TEST_IPADAPTER_MODEL);
});

test('CF-A2: a rejected ControlNet/IP-Adapter request falls open — image still generates, and the fallback is surfaced to the caller and the WS broadcast', async (t) => {
  let txt2imgCallCount = 0;
  installFetch(t, {
    ...CONTROLNET_CATALOG_ROUTES,
    '/sdapi/v1/txt2img': () => {
      txt2imgCallCount++;
      if (txt2imgCallCount === 1) {
        // installFetch derives text() from JSON.stringify(json) — put the matching
        // substring inside the json body so a1111.js's error message includes it.
        return { status: 500, json: { error: 'ControlNet unit 0: module not found' } };
      }
      return fakeA1111Response();
    },
  });

  const broadcastMod = await import('../../broadcast.js');
  const broadcastCalls = [];
  t.mock.method(broadcastMod.default, 'send', (type, payload) => broadcastCalls.push({ type, payload }));

  const { scenarioId, idByName } = seedScenario({
    npcNames: ['Riley'],
    clothingByName: { Riley: 'dress' },
    referenceByName: { Riley: 'REF:Riley' },
    withNarratorTurn: false,
  });

  const result = await generate({ mode: 'character', scenarioId, characterId: idByName.Riley, turnId: null });

  assert.equal(result.ok, true, 'generation must still succeed overall');
  assert.equal(result.controlnetFallback, true, 'fallback must be surfaced on generate()\'s return value');

  const imageReadyCall = broadcastCalls.find(c => c.type === 'image_ready');
  assert.ok(imageReadyCall, 'expected an image_ready broadcast');
  assert.equal(imageReadyCall.payload.controlnetFallback, true,
    'fallback must be surfaced in the image_ready WS payload so the UI can show it');
});

test('CF-2: falls back to the first non-player cast member when no picker signal is available', async (t) => {
  const calls = installFetch(t, {
    // No narrator turns are seeded below, so the picker itself is never called — but
    // Stage 2b (story-enhancer) still runs independently and needs a route to avoid a
    // caught-but-logged error cluttering test output.
    '/api/chat': async () => ({ status: 200, json: { message: { content: 'masterpiece, standing, medium shot\n\nNegative prompt: worst quality' } } }),
    ...CONTROLNET_CATALOG_ROUTES,
    '/sdapi/v1/txt2img': () => fakeA1111Response(),
  });

  // No narrator turns at all -> Stage 2a never calls the picker -> pickedMoment stays null.
  const { scenarioId } = seedScenario({
    npcNames: ['Alice', 'Riley'],
    clothingByName: { Alice: 'jeans', Riley: 'dress' },
    referenceByName: { Alice: 'REF:Alice', Riley: 'REF:Riley' },
    withNarratorTurn: false,
  });

  await generate({ mode: 'scene', scenarioId, turnId: null });

  assert.equal(decodeSentReferenceImage(calls), 'REF:Alice',
    'documented fallback: first non-player cast member (alphabetical) when no scene-subject signal exists');
});
