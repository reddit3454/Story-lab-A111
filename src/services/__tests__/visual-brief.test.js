import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

test('normalizeVisualBrief requires main_subject moment_summary setting_brief', async () => {
  const { normalizeVisualBrief } = await import('../visual-brief.js');
  assert.equal(normalizeVisualBrief({ main_subject: 'A' }), null);
  const ok = normalizeVisualBrief({
    main_subject: 'Jake',
    moment_summary: 'Jake yells from the table',
    setting_brief: 'living room',
    shot_hint: 'medium wide',
    character_briefs: [
      { character_name: 'Jake', role: 'main', visible: true, brief: 'standing on table yelling' },
      { character_name: '', role: 'support', visible: true, brief: 'x' },
    ],
  }, [{ id: 12, name: 'Jake' }]);
  assert.equal(ok.main_subject, 'Jake');
  assert.equal(ok.character_briefs.length, 1);
  assert.equal(ok.character_briefs[0].character_id, 12);
});

test('resolveCharacterBriefFromTurns uses current then prior then null', async () => {
  const { resolveCharacterBriefFromTurns } = await import('../visual-brief.js');
  const turns = [
    { scene_card: { visual_brief: {
      main_subject: 'Mia', moment_summary: 'm', setting_brief: 's',
      character_briefs: [{ character_name: 'Mia', character_id: 3, role: 'main', visible: true, brief: 'laughing' }],
    } } },
    { scene_card: { visual_brief: {
      main_subject: 'Jake', moment_summary: 'm2', setting_brief: 's2',
      character_briefs: [
        { character_name: 'Jake', character_id: 1, role: 'main', visible: true, brief: 'on table' },
        { character_name: 'Sarah', character_id: 2, role: 'support', visible: true, brief: 'on couch' },
      ],
    } } },
  ];
  const cur = resolveCharacterBriefFromTurns({ characterId: 3, characterName: 'Mia', turnsNewestFirst: turns });
  assert.equal(cur.entry.brief, 'laughing');
  const prior = resolveCharacterBriefFromTurns({ characterId: 2, characterName: 'Sarah', turnsNewestFirst: turns });
  assert.equal(prior.entry.brief, 'on couch');
  const miss = resolveCharacterBriefFromTurns({ characterId: 99, characterName: 'Nobody', turnsNewestFirst: turns });
  assert.equal(miss, null);
});

test('composeSceneDescriptionFromBrief prefers brief fields not legacy image_prompt', async () => {
  const { composeSceneDescriptionFromBrief } = await import('../visual-brief.js');
  const text = composeSceneDescriptionFromBrief({
    main_subject: 'Jake',
    moment_summary: 'Jake yells',
    setting_brief: 'living room',
    shot_hint: 'medium wide',
    character_briefs: [
      { character_name: 'Jake', role: 'main', visible: true, brief: 'on table arms raised' },
      { character_name: 'Sarah', role: 'support', visible: true, brief: 'on couch surprised' },
    ],
  }, { legacyImagePrompt: 'SHOULD_NOT_APPEAR long prose' });
  assert.ok(text.includes('Jake yells'));
  assert.ok(text.includes('on couch'));
  assert.ok(!text.includes('SHOULD_NOT_APPEAR'));
});

test('extractVisualBrief sends format schema and low temperature', async (t) => {
  let captured = null;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    captured = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            main_subject: 'Jake',
            moment_summary: 'Jake stands on the table',
            setting_brief: 'living room',
            shot_hint: 'medium wide',
            character_briefs: [
              { character_name: 'Jake', role: 'main', visible: true, brief: 'standing on table yelling' },
            ],
          }),
        },
      }),
    };
  });
  const { extractVisualBrief } = await import('../visual-brief.js');
  const brief = await extractVisualBrief({
    storyText: 'Jake jumped on the table and yelled.',
    cast: [{ id: 1, name: 'Jake' }],
    clothingMap: { 1: 'jeans and tee' },
    location: { name: 'Living Room', image_tags: 'couch, table' },
    model: 'test-model',
    nsfwEnabled: false,
  });
  assert.ok(brief);
  assert.equal(brief.main_subject, 'Jake');
  assert.equal(brief.character_briefs[0].character_id, 1);
  assert.ok(captured.format);
  assert.equal(captured.options.temperature, 0.1);
  assert.ok(String(captured.messages[1].content).includes('wearing: jeans and tee'));
});

test('visualBriefToLegacyMoment maps mainSubject for FaceID handoff', async () => {
  const { visualBriefToLegacyMoment } = await import('../visual-brief.js');
  const m = visualBriefToLegacyMoment({
    main_subject: 'Jake',
    moment_summary: 'yells',
    setting_brief: 'room',
    shot_hint: 'wide',
    character_briefs: [{ character_name: 'Jake', role: 'main', visible: true, brief: 'on table' }],
  });
  assert.equal(m.mainSubject, 'Jake');
  assert.equal(m.visibleAction, 'on table');
  assert.equal(m.setting, 'room');
  assert.equal(m.shotType, 'wide');
});
