Clothing should work like this:

1. Character-level saved clothing sets
Each character has a JSON array of named clothing sets stored on the character record.

Example:
[
  {
    "name": "Bathing suit",
    "description": "skimpy blue and white striped 2 piece bikini"
  },
  {
    "name": "Towel",
    "description": "a white towel wrapped around their chest with nothing underneath"
  },
  {
    "name": "Lounging at home",
    "description": "loose blue pajama pants and a loose tank top"
  }
]

2. Scenario creation
When I add a character to a scenario, I choose one of that character’s saved clothing sets as their starting outfit for that scenario.

3. Scenario runtime
After the scenario starts, clothing changes during the story must be tracked per scenario, not globally on the character.
The base clothing-set JSON on the character should remain unchanged unless I manually edit the character card itself.

4. Prompt behavior
- Narrator uses the character’s current scenario clothing state.
- Scene image generation uses the current scenario clothing state.
- Character-focused image generation uses the current scenario clothing state.
- If no runtime clothing change has happened yet, use the selected starting clothing set from scenario creation.

5. UI expectation
- Character page = manage saved clothing sets.
- Scenario setup = choose one saved clothing set per character as the starting outfit.
- Play screen = show the current live clothing state for that scenario.

Please implement exactly this model and update story-lab-a1111-master-knowledge.md to document:
- character clothing-set JSON structure
- scenario starting outfit selection
- scenario-scoped runtime clothing state
- narrator/image read order for clothing