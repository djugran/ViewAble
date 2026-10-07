const BAD_HOSTS_FOR_READER = [
'google.',
'bing.com',
'search.yahoo.',
'duckduckgo.com',
'yandex.',
'baidu.'
];

let currentElevenLabsAudio = null;

function isSearchLikeHost(hostname) {
return BAD_HOSTS_FOR_READER.some(part => hostname.includes(part));
}
function looksLikeCode(text) {
if (!text) return false;
const trimmed = text.trim();
if (trimmed.length < 80) return false;
const codeKeywords = [
'function ',
'var ',
'let ',
'const ',
'=>',
'{',
'}',
'window.',
'document.',
'google.kEI',
'navigator.',
'performance.',
'new Image'
];
let hits = 0;
for (const key of codeKeywords) {
if (trimmed.includes(key)) hits++;
}
return hits >= 2;
}
function getMainContentNodeSafe() {
let article = document.querySelector('article');
if (article) return article;
let main = document.querySelector('main');
if (main) return main;
const candidates = Array.from(document.body.querySelectorAll('div, section'));
let bestNode = null;
let bestScore = 0;
for (const node of candidates) {
const text = node.innerText || '';
const t = text.trim();
if (t.length < 300) continue;
if (looksLikeCode(t)) continue;
if (node.querySelector('script')) continue;
const id = (node.id || '').toLowerCase();
const cls = (node.className || '').toString().toLowerCase();
if (id.includes('nav') || id.includes('footer') || id.includes('header')) continue;
if (cls.includes('nav') || cls.includes('footer') || cls.includes('header')) continue;
const score = t.length;
if (score > bestScore) {
bestScore = score;
bestNode = node;
}
}
return bestNode;
}
function extractMainText() {
const node = getMainContentNodeSafe();
if (!node) {
if (isSearchLikeHost(location.hostname)) {
return 'This appears to be a search or app-style page. ViewAble works best on article or blog pages.';
}
return 'ViewAble could not find a main article on this page.';
}
const text = (node.innerText || '').trim();
if (!text || looksLikeCode(text)) {
return 'ViewAble could not find clean readable text on this page.';
}
return text;
}
function buildCleanDocument() {
const mainNode = getMainContentNodeSafe();
if (!mainNode) {
const root = document.createElement('div');
root.className = 'viewable-reader-root';
const title = document.createElement('h1');
title.textContent = 'No main article found';
root.appendChild(title);
const p = document.createElement('p');
p.textContent =
'This page does not look like a normal article. Try ViewAble on a blog post, news article, or documentation page.';
root.appendChild(p);
return root;
}
const cloned = mainNode.cloneNode(true);
const removeSelectors = [
'nav',
'header',
'footer',
'aside',
'form',
'button',
'input',
'textarea',
'script',
'style',
'iframe',
'video',
'audio',
'[role="navigation"]',
'[aria-label="sidebar"]',
'[aria-label="breadcrumbs"]'
];
removeSelectors.forEach(sel => {
cloned.querySelectorAll(sel).forEach(el => el.remove());
});
const root = document.createElement('div');
root.className = 'viewable-reader-root';
let titleText = document.title || '';
const h1El = cloned.querySelector('h1');
if (h1El && h1El.innerText.trim().length > 0) {
titleText = h1El.innerText.trim();
}
if (titleText) {
const title = document.createElement('h1');
title.textContent = titleText;
root.appendChild(title);
}
const walker = document.createTreeWalker(
cloned,
NodeFilter.SHOW_ELEMENT,
null,
false
);
while (walker.nextNode()) {
const node = walker.currentNode;
if (node.tagName === 'P' || node.tagName === 'H2' || node.tagName === 'H3') {
const text = (node.innerText || '').trim();
if (!text) continue;
if (looksLikeCode(text)) continue;
if (text.length < 20) continue;
const p = document.createElement(node.tagName.toLowerCase());
p.textContent = text;
root.appendChild(p);
}
if (node.tagName === 'IMG') {
const src = node.getAttribute('src');
if (!src) continue;
const img = document.createElement('img');
img.src = src;
const alt = node.getAttribute('alt');
if (alt) img.alt = alt;
root.appendChild(img);
}
}
return root;
}
function showReaderOverlay(cleanRoot) {
const existing = document.getElementById('viewable-overlay');
if (existing) {
const panel = existing.querySelector('.viewable-panel');
if (panel) {
const oldRoot = panel.querySelector('.viewable-reader-root');
if (oldRoot) oldRoot.remove();
panel.appendChild(cleanRoot);
}
return;
}
const overlay = document.createElement('div');
overlay.id = 'viewable-overlay';
const backdrop = document.createElement('div');
backdrop.className = 'viewable-backdrop';
const panel = document.createElement('div');
panel.className = 'viewable-panel';
const closeBtn = document.createElement('button');
closeBtn.className = 'viewable-close';
closeBtn.textContent = 'Close';
closeBtn.addEventListener('click', () => {
sendTtsStop();
overlay.remove();
});
backdrop.addEventListener('click', () => {
sendTtsStop();
overlay.remove();
});
panel.appendChild(closeBtn);
panel.appendChild(cleanRoot);
overlay.appendChild(backdrop);
overlay.appendChild(panel);
document.body.appendChild(overlay);
}
function applyTranslatedTextToRoot(root, translatedText, language) {
// Split translated text into lines (translated paragraphs/headings in order)
const lines = translatedText.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
let lineIndex = 0;
// Walk all direct children of root; replace text nodes (p/h2/h3) with
// translated lines in sequence, leaving img and h1 elements in place.
const children = Array.from(root.childNodes);
for (const child of children) {
if (!(child instanceof Element)) continue;
const tag = child.tagName;
if (tag === 'H1') {
// Keep the title as-is (it was already set from the original page title)
continue;
}
if (tag === 'P' || tag === 'H2' || tag === 'H3') {
if (lineIndex < lines.length) {
child.textContent = lines[lineIndex++];
} else {
// No more translated lines; remove the leftover node
child.remove();
}
}
// IMG nodes are left completely untouched, preserving their position
}
// If there are leftover translated lines (more lines than text nodes),
// append them at the end so no content is lost.
while (lineIndex < lines.length) {
const p = document.createElement('p');
p.textContent = lines[lineIndex++];
root.appendChild(p);
}
}
function activateReaderMode() {
const cleanRoot = buildCleanDocument();
// Show immediately with a translating indicator if language isn't English
chrome.storage.sync.get(['viewableLanguage'], data => {
const language = (data && data.viewableLanguage) || 'English';
if (!language || language === 'English') {
showReaderOverlay(cleanRoot);
return;
}
// Add a subtle "Translating…" notice while we wait
const notice = document.createElement('p');
notice.id = 'viewable-translating-notice';
notice.style.cssText = 'color:#6b7280;font-style:italic;font-size:13px;margin-bottom:8px;';
notice.textContent = `Translating to ${language}…`;
cleanRoot.insertBefore(notice, cleanRoot.firstChild);
showReaderOverlay(cleanRoot);
// Extract the readable text from the clean root to send for translation
    const textToTranslate = Array.from(cleanRoot.querySelectorAll('h1, h2, h3, p'))
      .map(el => el.textContent.trim())
      .filter(t => t.length > 0)
      .join('\n');
    chrome.runtime.sendMessage(
      { type: 'VIEWABLE_AI_TRANSLATE', text: textToTranslate },
      res => {
        console.log('Translation response:', res);
        // Remove the notice regardless of outcome - search within the overlay
        const overlay = document.getElementById('viewable-overlay');
        if (overlay) {
          const n = overlay.querySelector('#viewable-translating-notice');
          if (n) n.remove();
        }
        if (res && res.ok && res.translated) {
          console.log('Applying translation:', res.translated.substring(0, 100));
          applyTranslatedTextToRoot(cleanRoot, res.translated, language);
        } else {
          console.error('Translation failed:', res);
        }
        // If translation fails, the original text is already showing — silently keep it
      }
    );
});
}
let viewableTextScale = 1;
function applyTextScale() {
document.documentElement.style.setProperty(
'--viewable-text-scale',
String(viewableTextScale)
);
}
function toggleDyslexicFont() {
document.documentElement.classList.toggle('viewable-dyslexic-font');
}
function toggleHighContrast() {
document.documentElement.classList.toggle('viewable-high-contrast');
}
function handleTextSize(action) {
if (action === 'INCREASE') {
viewableTextScale = Math.min(viewableTextScale + 0.1, 1.6);
} else if (action === 'DECREASE') {
viewableTextScale = Math.max(viewableTextScale - 0.1, 0.7);
} else if (action === 'RESET') {
viewableTextScale = 1;
}
applyTextScale();
}
function getOverlayTextOrFallback() {
  const overlayRoot = document.querySelector('#viewable-overlay .viewable-reader-root');
  if (overlayRoot) {
    return (overlayRoot.innerText || '').trim();
  }
  // Build a clean document in memory to extract clean text
  const cleanDoc = buildCleanDocument();
  return (cleanDoc.innerText || '').trim();
}
function sendTtsStart() {
const text = getOverlayTextOrFallback();
chrome.runtime.sendMessage(
{ type: 'VIEWABLE_TTS_START', text },
() => {}
);
}
function sendTtsStop() {
chrome.runtime.sendMessage(
{ type: 'VIEWABLE_TTS_STOP' },
() => {}
);
}
function queryTtsStatus(callback) {
chrome.runtime.sendMessage(
{ type: 'VIEWABLE_TTS_STATUS' },
res => {
callback(!!(res && res.speaking));
}
);
}
function localSummarize(text) {
if (!text || text.trim().length === 0) {
return 'No readable text found on this page.';
}
const cleaned = text.replace(/\s+/g, ' ').trim();
if (!cleaned) return 'No readable text found on this page.';
let sentences = cleaned
.split(/(?<=[.!?])\s+/)
.map(s => s.trim())
.filter(s => s.length > 0);
if (sentences.length <= 2 && cleaned.length <= 220) {
return sentences.slice(0, 2).join(' ');
}
let summary = sentences.slice(0, 2).join(' ');
const MAX_CHARS = 200;
if (summary.length > MAX_CHARS) {
summary = summary.slice(0, MAX_CHARS).trim();
const lastPunct = summary.lastIndexOf('.');
if (lastPunct > 60) {
summary = summary.slice(0, lastPunct + 1);
} else {
summary += '…';
}
}
return summary;
}
function closeQuizOverlay() {
const overlay = document.getElementById('viewable-quiz-overlay');
if (overlay) overlay.remove();
}
function showMcqQuizOverlay(questions) {
if (!questions || questions.length === 0) {
alert('No quiz questions available for this page.');
return;
}
closeQuizOverlay();
let currentIndex = 0;
let score = 0;
const overlay = document.createElement('div');
overlay.id = 'viewable-quiz-overlay';
const backdrop = document.createElement('div');
backdrop.className = 'quiz-backdrop';
const panel = document.createElement('div');
panel.className = 'quiz-panel';
const title = document.createElement('h2');
title.textContent = 'Quick understanding check';
panel.appendChild(title);
const questionEl = document.createElement('p');
questionEl.className = 'quiz-question';
panel.appendChild(questionEl);
const optionsContainer = document.createElement('div');
optionsContainer.className = 'quiz-options';
panel.appendChild(optionsContainer);
const footer = document.createElement('div');
footer.className = 'quiz-footer';
const statusEl = document.createElement('span');
footer.appendChild(statusEl);
const controls = document.createElement('div');
const closeBtn = document.createElement('button');
closeBtn.className = 'quiz-close-btn';
closeBtn.textContent = 'Close';
closeBtn.addEventListener('click', closeQuizOverlay);
controls.appendChild(closeBtn);
const nextBtn = document.createElement('button');
nextBtn.className = 'quiz-next-btn';
nextBtn.textContent = 'Next';
controls.appendChild(nextBtn);
footer.appendChild(controls);
panel.appendChild(footer);
overlay.appendChild(backdrop);
overlay.appendChild(panel);
document.body.appendChild(overlay);
backdrop.addEventListener('click', closeQuizOverlay);
function renderQuestion() {
const q = questions[currentIndex];
questionEl.textContent = q.question;
optionsContainer.innerHTML = '';
statusEl.textContent = `Question ${currentIndex + 1} of ${questions.length}`;
q.options.forEach((opt, idx) => {
const btn = document.createElement('button');
btn.className = 'quiz-option';
btn.textContent = opt;
btn.addEventListener('click', () => {
const all = optionsContainer.querySelectorAll('.quiz-option');
all.forEach(o => (o.disabled = true));
if (idx === q.correctIndex) {
btn.classList.add('correct');
score++;
statusEl.textContent = `Correct! (${score}/${questions.length})`;
} else {
btn.classList.add('incorrect');
statusEl.textContent = `Not quite. (${score}/${questions.length})`;
all[q.correctIndex].classList.add('correct');
}
});
optionsContainer.appendChild(btn);
});
nextBtn.textContent = currentIndex === questions.length - 1 ? 'Finish' : 'Next';
}
nextBtn.addEventListener('click', () => {
if (currentIndex < questions.length - 1) {
currentIndex++;
renderQuestion();
} else {
alert(`You answered ${score} out of ${questions.length} correctly.`);
closeQuizOverlay();
}
});
renderQuestion();
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAY_ELEVENLABS_AUDIO') {
    // Stop any currently playing audio
    if (currentElevenLabsAudio) {
      currentElevenLabsAudio.pause();
      currentElevenLabsAudio = null;
    }
    
    // Convert base64 to blob and play
    const audioData = atob(message.audioData);
    const arrayBuffer = new ArrayBuffer(audioData.length);
    const view = new Uint8Array(arrayBuffer);
    for (let i = 0; i < audioData.length; i++) {
      view[i] = audioData.charCodeAt(i);
    }
    const audioBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    const audioUrl = URL.createObjectURL(audioBlob);
    
    currentElevenLabsAudio = new Audio(audioUrl);
    currentElevenLabsAudio.volume = message.volume || 1;
    currentElevenLabsAudio.playbackRate = message.rate || 1;
    
    currentElevenLabsAudio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      currentElevenLabsAudio = null;
    };
    
    currentElevenLabsAudio.play();
    sendResponse?.({ ok: true });
    return true;
  }
  
  if (message.type === 'STOP_ELEVENLABS_AUDIO') {
    // Immediately stop and cleanup audio
    if (currentElevenLabsAudio) {
      currentElevenLabsAudio.pause();
      currentElevenLabsAudio.currentTime = 0;
      currentElevenLabsAudio = null;
    }
    sendResponse?.({ ok: true });
    return true;
  }
  
  if (message.type === 'VIEWABLE_SIMPLIFY') {
    activateReaderMode();
    sendResponse?.({ ok: true });
  }
if (message.type === 'VIEWABLE_GET_TEXT') {
const text = getOverlayTextOrFallback();
sendResponse?.({ text });
}
if (message.type === 'VIEWABLE_DYSLEXIC_TOGGLE') {
toggleDyslexicFont();
}
if (message.type === 'VIEWABLE_CONTRAST_TOGGLE') {
toggleHighContrast();
}
if (message.type === 'VIEWABLE_TEXT_SIZE') {
handleTextSize(message.action);
}
if (message.type === 'VIEWABLE_TOGGLE_READ_ALOUD') {
queryTtsStatus(isOn => {
if (isOn) {
sendTtsStop();
sendResponse?.({ speaking: false });
} else {
sendTtsStart();
sendResponse?.({ speaking: true });
}
});
return true;
}
  if (message.type === 'VIEWABLE_SUMMARIZE') {
    const text = getOverlayTextOrFallback();
    chrome.runtime.sendMessage(
      { type: 'VIEWABLE_AI_SUMMARIZE', text },
      res => {
        console.log('Summary response:', res);
        if (res && res.ok) {
          sendResponse?.({ summary: res.summary });
        } else {
          console.error('AI summarize failed, using fallback. Error:', res?.error);
          const fallback = localSummarize(text);
          sendResponse?.({ summary: fallback });
        }
      }
    );
    return true;
  }
  if (message.type === 'VIEWABLE_START_QUIZ') {
    const baseText = getOverlayTextOrFallback();
    console.log('Starting quiz generation with text length:', baseText.length);
    chrome.runtime.sendMessage(
      { type: 'VIEWABLE_AI_QUIZ', text: baseText },
      res => {
        console.log('Quiz response:', res);
        if (!res || !res.ok) {
          console.error('AI quiz error:', res && res.error);
          alert('Could not generate quiz for this page.');
          return;
        }
        console.log('Got questions:', res.questions);
        showMcqQuizOverlay(res.questions);
      }
    );
  }
return true;
});