import { Router } from 'express';
import db from '../db.js';
import broadcast from '../broadcast.js';
import {
  listScenarioCharacterStates,
  updateScenarioCharacterStateManual,
} from '../services/character-state.js';

const router = Router({ mergeParams: true });

router.get('/', function (req, res) {
  const scenarioId = parseInt(req.params.scenarioId, 10);
  if (!scenarioId) return res.status(400).json({ error: 'invalid scenario id' });

  const scenario = db.prepare('SELECT id FROM scenarios WHERE id = ?').get(scenarioId);
  if (!scenario) return res.status(404).json({ error: 'scenario not found' });

  try {
    const states = listScenarioCharacterStates(scenarioId);
    res.json({ states });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:characterId', function (req, res) {
  const scenarioId = parseInt(req.params.scenarioId, 10);
  const characterId = parseInt(req.params.characterId, 10);
  if (!scenarioId || !characterId) {
    return res.status(400).json({ error: 'invalid id' });
  }

  const { moodcurrent, arousalcurrent } = req.body || {};
  if (moodcurrent == null || arousalcurrent == null) {
    return res.status(400).json({ error: 'moodcurrent and arousalcurrent are required' });
  }

  const scenario = db.prepare('SELECT id FROM scenarios WHERE id = ?').get(scenarioId);
  if (!scenario) return res.status(404).json({ error: 'scenario not found' });

  const inCast = db.prepare(
    'SELECT 1 FROM scenario_characters WHERE scenario_id = ? AND character_id = ?'
  ).get(scenarioId, characterId);
  if (!inCast) return res.status(404).json({ error: 'character not in scenario cast' });

  try {
    const row = updateScenarioCharacterStateManual(scenarioId, characterId, {
      moodcurrent,
      arousalcurrent,
    });
    const char = db.prepare('SELECT name FROM characters WHERE id = ?').get(characterId);
    const payload = {
      characterId,
      name: char?.name || '',
      moodcurrent: row.moodcurrent,
      arousalcurrent: row.arousalcurrent,
    };
    broadcast.send('moodupdate', { scenarioId, characters: [payload] });
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
