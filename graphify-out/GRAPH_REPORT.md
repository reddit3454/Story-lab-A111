# Graph Report - .  (2026-06-18)

## Corpus Check
- 80 files · ~251,035 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 528 nodes · 1240 edges · 30 communities (24 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.87)
- Token cost: 22,850 input · 4,920 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Turn Execution & Clothing|Turn Execution & Clothing]]
- [[_COMMUNITY_Frontend UI Utilities|Frontend UI Utilities]]
- [[_COMMUNITY_Character & Audit Routes|Character & Audit Routes]]
- [[_COMMUNITY_App Shell & Navigation|App Shell & Navigation]]
- [[_COMMUNITY_Architecture Concepts & Config|Architecture Concepts & Config]]
- [[_COMMUNITY_Client State Management|Client State Management]]
- [[_COMMUNITY_Image Gallery & Lightbox|Image Gallery & Lightbox]]
- [[_COMMUNITY_A1111 API Integration|A1111 API Integration]]
- [[_COMMUNITY_FontLobby Client|FontLobby Client]]
- [[_COMMUNITY_Style Creation Wizard|Style Creation Wizard]]
- [[_COMMUNITY_Font Painter Tool|Font Painter Tool]]
- [[_COMMUNITY_Package Manifest|Package Manifest]]
- [[_COMMUNITY_Fantasy Character Seed|Fantasy Character Seed]]
- [[_COMMUNITY_Style Picker Patch|Style Picker Patch]]
- [[_COMMUNITY_Debug Console|Debug Console]]
- [[_COMMUNITY_Style Creator View|Style Creator View]]
- [[_COMMUNITY_Male Character Seed|Male Character Seed]]
- [[_COMMUNITY_Female Character Seed 4|Female Character Seed #4]]
- [[_COMMUNITY_Location Picker|Location Picker]]
- [[_COMMUNITY_Female Character Seed 18|Female Character Seed #18]]
- [[_COMMUNITY_ControlNet Pose Reference|ControlNet Pose Reference]]
- [[_COMMUNITY_Scenarios Table|Scenarios Table]]
- [[_COMMUNITY_DB Schema|DB Schema]]
- [[_COMMUNITY_Route Layer|Route Layer]]
- [[_COMMUNITY_Service Layer|Service Layer]]
- [[_COMMUNITY_WS Events|WS Events]]

## God Nodes (most connected - your core abstractions)
1. `escapeHtml()` - 68 edges
2. `showToast()` - 59 edges
3. `db` - 22 edges
4. `imageSrc()` - 19 edges
5. `FontLobbyClient()` - 18 edges
6. `setupPlayInteractions()` - 18 edges
7. `log()` - 18 edges
8. `setLoading()` - 16 edges
9. `logError()` - 15 edges
10. `showConfirm()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Advisory Layer Pattern (fail-safe LLM overlay)` --semantically_similar_to--> `Fire-and-Forget Image Generation Pattern`  [INFERRED] [semantically similar]
  docs/superpowers/plans/2026-06-15-story-aware-image-generation.md → CLAUDE.md
- `naked couples.txt — SDXL Prompt Examples` --semantically_similar_to--> `SDXL Prompt Writing for Story Visualization`  [INFERRED] [semantically similar]
  naked couples.txt → docs/superpowers/plans/2026-06-15-story-aware-image-generation.md
- `buildMotionPrompt Function Spec` --rationale_for--> `Scene Picker Service (src/services/scene-picker.js)`  [INFERRED]
  docs/superpowers/plans/2026-06-15-story-aware-image-generation.md → story-lab-a1111-master-knowledge.md
- `pickBestMoment Function Spec` --rationale_for--> `Scene Picker Service (src/services/scene-picker.js)`  [INFERRED]
  docs/superpowers/plans/2026-06-15-story-aware-image-generation.md → story-lab-a1111-master-knowledge.md
- `buildSdxlPrompt Function Spec` --rationale_for--> `Story Enhancer Service (src/services/story-enhancer.js)`  [INFERRED]
  docs/superpowers/plans/2026-06-15-story-aware-image-generation.md → story-lab-a1111-master-knowledge.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Phase 9 Story-Aware Image Generation Stack** — concept_scene_picker_service, concept_story_enhancer_service, concept_image_pipeline_service, concept_ollama_client, concept_narrator_service [EXTRACTED 1.00]
- **Image Generation Pipeline Flow** — concept_config_resolver, concept_prompt_builder, concept_a1111_client, concept_broadcast_ws, concept_scene_images_table [EXTRACTED 1.00]
- **Narrator → Scene Card → Prompt Assembly** — concept_narrator_service, concept_scene_card, concept_turns_table, concept_prompt_builder [EXTRACTED 1.00]

## Communities (30 total, 6 thin omitted)

### Community 0 - "Turn Execution & Clothing"
Cohesion: 0.07
Nodes (49): router, audit(), resetClothing(), resolveClothing(), _buildA1111Payload(), generate(), _locationSlug(), _resolveBackground() (+41 more)

### Community 1 - "Frontend UI Utilities"
Cohesion: 0.10
Nodes (61): getNpcColor(), setImgStatus(), showToast(), avatarHtml(), escapeHtml(), formatStoryContent(), initAuditView(), loadAudit() (+53 more)

### Community 2 - "Character & Audit Routes"
Cohesion: 0.06
Nodes (35): router, router, router, router, router, RELATIONSHIP_TYPES, router, router (+27 more)

### Community 3 - "App Shell & Navigation"
Cohesion: 0.09
Nodes (49): activate(), router(), closeLightbox(), setLoading(), showConfirm(), startStatusPolling(), statusDotsHtml(), imageSrc() (+41 more)

### Community 4 - "Architecture Concepts & Config"
Cohesion: 0.06
Nodes (50): A1111 HTTP Client (src/services/a1111.js), Broadcast WebSocket Singleton (src/broadcast.js), buildTraitsBlock (inlined replacement for Story-lab prompts.js), characters DB Table (global), Config Resolver Service (src/services/config-resolver.js), global_config DB Table, Image Pipeline Service (src/services/image-pipeline.js), Narrator Service (src/services/narrator.js) (+42 more)

### Community 5 - "Client State Management"
Cohesion: 0.18
Nodes (22): applyChatColors(), applyTextPrefs(), saveChatColors(), saveNpcColors(), saveTextPrefs(), getPathHistory(), initSettings(), loadGlobalRules() (+14 more)

### Community 6 - "Image Gallery & Lightbox"
Cohesion: 0.18
Nodes (22): openLightbox(), _assignSelected(), _bindSlotDragEvents(), _galleryImageSrc(), initImages(), _injectStyles(), _loadGallery(), _loadSlotConfig() (+14 more)

### Community 7 - "A1111 API Integration"
Cohesion: 0.14
Nodes (20): _getUrl(), router, _fetch(), getLoras(), getModels(), getOptions(), getProgress(), getSamplers() (+12 more)

### Community 9 - "Style Creation Wizard"
Cohesion: 0.30
Nodes (14): btnBusy(), collectStyleForm(), confirm2(), esc(), injectWizardStylePicker(), loadWizardStylePicker(), refreshWizardStylePicker(), renderStyleForm() (+6 more)

### Community 10 - "Font Painter Tool"
Cohesion: 0.30
Nodes (13): _activate(), _applyFont(), _closestPaintable(), _createToggleButton(), _deactivate(), init(), _initFontLobby(), _injectBaseStyles() (+5 more)

### Community 11 - "Package Manifest"
Cohesion: 0.14
Nodes (13): dependencies, express, ws, description, engines, node, main, name (+5 more)

### Community 12 - "Fantasy Character Seed"
Cohesion: 0.15
Nodes (14): Blue Skin Tone, Brown Eyes, Dark Black Hair, Blue Facial Marking on Forehead, Necklace Jewelry, Nose Piercing, 3D Animated / Stylized Render Art Style, Young Adult Slim Build (+6 more)

### Community 13 - "Style Picker Patch"
Cohesion: 0.30
Nodes (8): escapeHtmlLocal(), fixStylesPage(), _getEditingScenarioId(), injectStyleDropdown(), loadGlobalStyles(), renderGlobalStyleForm(), renderGlobalStylesPage(), showToastGlobal()

### Community 14 - "Debug Console"
Cohesion: 0.27
Nodes (7): _applyFilter(), _buildPanel(), _buildToggleBtn(), _init(), _injectStyles(), _scrollToBottom(), _wireResizer()

### Community 15 - "Style Creator View"
Cohesion: 0.25
Nodes (9): buildEditorHtml(), buildListItem(), buildModalHtml(), DEFAULTS, _loraOpts(), openStyleCreatorModal(), _selectOpts(), SUPPORTED_SAMPLERS (+1 more)

### Community 16 - "Male Character Seed"
Cohesion: 0.33
Nodes (7): 3D Render / Digital Art Style, Brown Wavy Short Hair, Character Seed Image 1, Green Eyes, Male Character Appearance, White Tank Top, Young Adult Male

### Community 17 - "Female Character Seed #4"
Cohesion: 0.33
Nodes (7): Hyper-Realistic 3D Render Style, Character Seed 4 — Blonde Woman, Warm Smiling Expression, Blonde Updo with Loose Waves, Gray Fitted Tank Top, Indoor Living Room Background, Tanned/Medium-Dark Skin Tone

### Community 18 - "Location Picker"
Cohesion: 0.53
Nodes (4): injectLocationPicker(), toast(), updateLocationPreview(), watchForScenarioSetup()

### Community 19 - "Female Character Seed #18"
Cohesion: 0.47
Nodes (6): Blurred Indoor Scene with Warm/Cool Lighting, Character Seed Image 18 — Young Woman (Animated Style), Warm Smiling Expression — Bright Brown Eyes, Brown Upswept Hair with Loose Strands, Blue and White Tank Top with Orange Accent, 3D Animated / CG Render Style

### Community 20 - "ControlNet Pose Reference"
Cohesion: 0.67
Nodes (4): ControlNet Pose Reference, OpenPose Visualization, Standing Pose Skeleton (standing_15), Standing Human Pose

## Knowledge Gaps
- **75 isolated node(s):** `name`, `version`, `description`, `main`, `type` (+70 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `escapeHtml()` connect `Frontend UI Utilities` to `App Shell & Navigation`, `Client State Management`, `Image Gallery & Lightbox`, `Style Creator View`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Frontend UI Utilities` to `App Shell & Navigation`, `Client State Management`, `Image Gallery & Lightbox`, `Style Creator View`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `log()` connect `Turn Execution & Clothing` to `Character & Audit Routes`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _81 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Turn Execution & Clothing` be split into smaller, more focused modules?**
  _Cohesion score 0.0670807453416149 - nodes in this community are weakly interconnected._
- **Should `Frontend UI Utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.09984639016897082 - nodes in this community are weakly interconnected._
- **Should `Character & Audit Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.06393442622950819 - nodes in this community are weakly interconnected._