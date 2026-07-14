# Story Lab A111 — Owner Walkthrough (vs desired functionality)

> Source of intent: `desired_functionality.md`
> Technical twin: `story-lab-a1111-master-knowledge.md`
> Updated after gap-closure pass 2026-07-13b.

---

## Matches / Partial / Missing

| Intended item | Status | Notes |
|---|---|---|
| Characters independent of scenarios | **Matches** | Global Characters library + scenario cast join |
| Physical descriptions for images | **Matches** | Appearance fields + appearance_prompt → prompt-builder |
| FaceID references | **Matches** | Accept ref → IP-Adapter on generate (needs A1111 extras) |
| Personality descriptions | **Matches** | Structured personality fed to narrator |
| Relationship summaries | **Matches** | Global relationships injected into narrator for cast pairs |
| Arousal triggers influence narration | **Matches** | Injected into cast behavior when heated + NSFW allows |
| Turn-offs influence narration | **Matches** (after gap pass) | `moodtriggersneg` injected as turn-offs; UI relabeled |
| Locations independent | **Matches** | Global Locations library + scenario membership |
| Location name / visual description / tags | **Matches** | Name, description (visual), image tags |
| Location background info | **Matches** (after gap pass) | `full_desc` field in UI + narrator |
| Location backgrounds for images | **Matches** | Folder + registry → img2img |
| Scenario name + description | **Matches** | Title + premise/description |
| Select location card | **Matches** | Required location picker |
| Select characters from master list | **Matches** | Cast step |
| Starting clothing set per cast member | **Matches** | Scenario setup dropdown of saved sets; stored on scenario_characters |
| Overall mood | **Partial** | Tone / writing-style controls (not a separate “mood” meter name) |
| NSFW on/off | **Matches** | Scenario Safe Mode; also master config |
| Narrator settings that affect runtime | **Matches** | Reply length, pacing, violence, POV, tone modifier used by narrator |
| Guidance box + lock | **Matches** | Lock = guidance becomes literal story input |
| Character / Narrator / Continue buttons | **Matches** | Clearer respond-as / narrate / continue instructions |
| Img under turn text | **Matches** | Per-turn Img button; images inject under that turn |
| Character-focused image + editable prompt | **Matches** (after gap pass) | Side panel chips; preview auto-builds; edits sent as direct prompt |
| Persistent clothing through turns | **Matches** | Start outfit → narrator clothing_changes → tracked |
| Narrator uses personality/relationships/triggers/turn-offs | **Matches** (after gap pass) | All wired into system prompt / cast behavior when NSFW policy allows cast arousal block |

---

## How play works now (plain English)

1. Build reusable **Characters** (looks, FaceID, personality, relationships, arousal triggers, turn-offs).
2. Build reusable **Locations** (name, visual description, tags, background info, background images).
3. Create a **Scenario**: pick location, add cast, set each character’s **initial clothing**, set tone / reply length / Safe Mode, save.
4. In **Play**: type optional Guidance; optionally Lock it; press a character button, Narrator, or Continue.
5. Narrator writes the next beat using cast personalities, relationships, outfits, location, and (when NSFW allows) arousal triggers / turn-offs.
6. Press **Img** under a turn for a scene picture, or use the side **Image Prompt** panel, pick a character chip, edit the auto prompt, Generate — images appear under the related turn text.

---

## What still does not match the intended design

1. **Clothing is scenario-scoped (2026-07-13c).** Character page stores named clothing sets; scenario setup picks a starting set; Play/narrator/images use per-scenario runtime clothing without mutating the character card.
2. **Filter Rules** remain unavailable (honestly disabled); use Scenario reply-length / tone / NSFW instead.
3. **Enhance Guidance** button still says not available.
4. **Video / clip** controls remain stubs.
5. **Styles library / Images gallery** pages remain quarantined (use Image Profiles / Play / Characters).
6. **Overall mood** is expressed as Tone + lust/style settings, not a dedicated “overall mood” card field with that exact name.
7. Character arousal **max** UI historically capped lower than 1–10 story language (engine caveat).

---

## Status cheat sheet (post gap closure)

| Area | Status |
|---|---|
| Independent characters + FaceID + personality + relationships | Fully working |
| Arousal triggers + turn-offs → narrator | Fully working (NSFW-gated cast behavior block) |
| Independent locations + backgrounds | Fully working |
| Scenario cast + starting clothing set | Fully working |
| Guidance lock + focus buttons | Fully working |
| Inline scene Img + character editable prompt generate | Fully working |
| Filter Rules / Enhance Guidance / Video / Styles gallery | Disabled or stubbed (honest) |
