import { TEXT_PREF_DEFAULTS, CHAT_COLOR_DEFAULTS, NPC_COLOR_PALETTE } from './constants.js';

export var state = {
  currentScenario:    null,
  currentCharacter:   null,
  turns:              [],
  playLayout:         localStorage.getItem('story-lab-layout') || 'split',
  sidebarOpen:        localStorage.getItem('story-lab-sidebar') !== 'false',
  portraitPanelOpen:  localStorage.getItem('story-lab-portraits') !== 'false',
  currentSidebarTab:  'memory',
  currentImageId:     null,
  currentImageData:   null,   // full scene_image object for the currently displayed image
  _sceneImageCache:   {},     // id -> scene_image object, for WS event lookup
  cleanupFns:         [],
  wizardStep:         1,
  wizardData:         {},
  wizardCast:         [],
  allCharacters:      [],
  editingScenarioId:  null,
  imagecoreOk:        null,
  ollamaOk:           null,
  libraryOk:          null,
  availableLoRAs:     [],
  allLocations:       [],
  characterStates:    {},   // charId -> { moodcurrent, arousalcurrent } — live mood state
};

// Font preferences - persisted in localStorage
export var fontPrefs = { story: null, ui: null };
(function initFontPrefs() {
  try { fontPrefs.story = JSON.parse(localStorage.getItem('story-lab-story-font')); } catch (e) {}
  try { fontPrefs.ui    = JSON.parse(localStorage.getItem('story-lab-ui-font'));    } catch (e) {}
  if (fontPrefs.story) document.documentElement.style.setProperty('--font-story', fontPrefs.story.cssValue);
  if (fontPrefs.ui)    document.documentElement.style.setProperty('--font-ui',    fontPrefs.ui.cssValue);
}());

// Text / reading preferences - persisted in localStorage
export var textPrefs = Object.assign({}, TEXT_PREF_DEFAULTS);
(function initTextPrefs() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('story-lab-text-prefs')); } catch (e) {}
  if (saved) Object.assign(textPrefs, saved);
  applyTextPrefs();
}());

export function applyTextPrefs() {
  var r = document.documentElement.style;
  r.setProperty('--story-font-size',       textPrefs.fontSize + 'px');
  r.setProperty('--story-line-height',      String(textPrefs.lineHeight));
  r.setProperty('--story-letter-spacing',   textPrefs.letterSpacing.toFixed(2) + 'em');
  r.setProperty('--story-paragraph-space',  textPrefs.paragraphSpace.toFixed(1) + 'em');
  r.setProperty('--story-max-width',        textPrefs.maxWidth + 'px');
}

export function saveTextPrefs() {
  localStorage.setItem('story-lab-text-prefs', JSON.stringify(textPrefs));
  applyTextPrefs();
}

export var chatColors = Object.assign({}, CHAT_COLOR_DEFAULTS);
(function initChatColors() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('story-lab-chat-colors')); } catch (e) {}
  if (saved) Object.assign(chatColors, saved);
  applyChatColors();
}());

export function applyChatColors() {
  var r = document.documentElement.style;
  r.setProperty('--turn-user-text-color',     chatColors.userText);
  r.setProperty('--turn-narrator-text-color', chatColors.narratorText);
}

export function saveChatColors() {
  localStorage.setItem('story-lab-chat-colors', JSON.stringify(chatColors));
  applyChatColors();
}

export var npcColors = {};
(function initNpcColors() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('story-lab-npc-colors')); } catch (e) {}
  if (saved && typeof saved === 'object') npcColors = saved;
}());

export function getNpcColor(charId, charIndex) {
  var stored = npcColors[String(charId)];
  return stored || NPC_COLOR_PALETTE[charIndex % NPC_COLOR_PALETTE.length];
}

export function saveNpcColors() {
  localStorage.setItem('story-lab-npc-colors', JSON.stringify(npcColors));
}
