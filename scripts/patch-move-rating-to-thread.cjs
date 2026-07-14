const fs = require("fs");

const playPath = "E:/TheHub/projects/Story-lab-A111/public/js/views/play.js";
let play = fs.readFileSync(playPath, "utf8");

const re1 = /          '<div class="prompt-result" id="prompt-result" style="display:none">' \+\r?\n            '<img id="prompt-result-img" class="prompt-result-img" alt="Generated image">' \+\r?\n            '<div id="prompt-rating-slot"><\/div>' \+\r?\n          '<\/div>' \+\r?\n/;
if (!re1.test(play)) { console.error("re1 fail"); process.exit(1); }
play = play.replace(re1, "");
console.log("removed prompt-result");

const re2 = /  setImgStatus\(null\);\r?\n}\r?\n\r?\nfunction handleVideoStatus\(data\) \{/;
if (!re2.test(play)) { console.error("re2 fail"); process.exit(1); }
play = play.replace(re2, [
  "  setImgStatus(null);",
  "  if (imageId) {",
  "    onPromptPanelImageReady({ turnId: turnId, imageId: imageId, filename: filename, scenarioId: state.currentScenario.id });",
  "  }",
  "  scrollThreadToBottom();",
  "}",
  "",
  "function handleVideoStatus(data) {"
].join("\n"));
fs.writeFileSync(playPath, play);
console.log("play.js ok");

const panelPath = "E:/TheHub/projects/Story-lab-A111/public/js/play/prompt-panel.js";
let panel = fs.readFileSync(panelPath, "utf8");
const re3 = /export function onPromptPanelImageReady\(data\) \{[\s\S]*?\n\}/;
const newFn = `export function onPromptPanelImageReady(data) {
  if (!data || !data.imageId || !data.turnId) return;

  var turnEl = document.querySelector('[data-turn-id="' + data.turnId + '"]');
  if (!turnEl) return;

  var card = turnEl.querySelector('.turn-image[data-image-id="' + data.imageId + '"]');
  if (!card) card = turnEl.querySelector('.turn-image-slot .turn-image');
  if (!card || card.querySelector('.turn-image-rating-slot')) return;

  var ratingHost = document.createElement('div');
  ratingHost.className = 'turn-image-rating-slot';
  ratingHost.innerHTML = _buildRatingHtml(data.imageId);
  card.appendChild(ratingHost);
  _wireRating(ratingHost, data.imageId);
}`;
if (!re3.test(panel)) { console.error("re3 fail"); process.exit(1); }
panel = panel.replace(re3, newFn);
fs.writeFileSync(panelPath, panel);
console.log("prompt-panel ok");

const cssPath = "E:/TheHub/projects/Story-lab-A111/public/css/main.css";
let css = fs.readFileSync(cssPath, "utf8");
const re4 = /\.prompt-result \{[\s\S]*?margin-bottom: 10px;\r?\n\}/;
const newCss = `.turn-image-rating-slot {
  max-width: 520px;
  margin: 8px auto 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-raised);
}`;
if (!re4.test(css)) { console.error("re4 fail"); process.exit(1); }
css = css.replace(re4, newCss);
fs.writeFileSync(cssPath, css);
console.log("css ok");
