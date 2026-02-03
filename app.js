/*
  Word Memo
  Version: 1.11
  Base: 1.10
  Update Notes (lgtaegi):
  - Study flow is now LINEAR (file line order). No SRS due scheduling.
  - Prevents "jumping back" mid-study (e.g., around #974) caused by due-queue reshuffling.
  - Leading numbers are optional; app won't error if missing.
  - Duplicate words are allowed (no dedupe / no hiding).
  - "Due" counter element now shows Remaining count (items left in current run).
  - Keeps existing UI/IDs/buttons and features: Repeat all/unknown, Top10, Stats, Unknown exports.
*/

const DEFAULT_TXT = "words.txt";

// persisted stats
const LS_FORGOT_STATS = "wordmemo_forgot_stats_v1";
const LS_TODAY_STATS = "wordmemo_today_stats_v1"; // { "YYYY-MM-DD": { seen, forgot, knew } }

// modes
const LS_REVERSE = "wordmemo_reverse_v1"; // "1" | "0"  (order only)
const LS_MEANING = "wordmemo_meaning_v1"; // "1" | "0"  (meaning-first)

// unknown all
const LS_UNKNOWN_ALL = "wordmemo_unknown_all_v1"; // array of {num,term,meaning,addedAt}

let cards = [];
let sessionAllIds = [];
let sessionUnknownSet = new Set();

let showing = false;

// Top10 mode
let top10ModeOn = false;
let top10Set = new Set();

// Repeat-Unknown mode (snapshot at click time)
let repeatUnknownModeOn = false;
let repeatUnknownSet = new Set();

// Modes
let reverseMode = false; // order only
let meaningMode = false; // meaning-first

// LINEAR run controller
let runQueue = []; // current list of ids in order
let runIndex = 0;  // pointer
let resumeMain = null; // { queue, index } when entering Top10 or RepeatUnknown

const $ = (id) => document.getElementById(id);

// ---------- Date ----------
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ---------- Safe leading number parse ----------
function stripLeadingNumber(s) {
  // "1234 apple\t사과" or "1234. apple\t사과" or "1234) apple\t사과"
  const m = s.match(/^\s*(\d+)[)\.\-:]?\s+(.*)$/);
  if (!m) return { num: null, rest: s.trim() };
  return { num: parseInt(m[1], 10), rest: (m[2] || "").trim() };
}

/**
 * number prefix rendered as HTML span, always with dot.
 * - If num is missing: returns ""
 * - If num exists: returns `<span class="word-num">123.</span> `
 */
function numPrefixHtml(num) {
  if (num === null || num === undefined || Number.isNaN(num)) return "";
  return `<span class="word-num">${num}.</span> `;
}

// Simple HTML escape for safe innerHTML usage
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- Today stats ----------
function loadTodayStatsAll() {
  try { return JSON.parse(localStorage.getItem(LS_TODAY_STATS) || "{}"); }
  catch { return {}; }
}
function saveTodayStatsAll(all) {
  localStorage.setItem(LS_TODAY_STATS, JSON.stringify(all));
}
function getTodayStats() {
  const key = todayKey();
  const all = loadTodayStatsAll();
  if (!all[key]) all[key] = { seen: 0, forgot: 0, knew: 0 };
  return { key, all, stats: all[key] };
}
function bumpToday(field) {
  const { key, all, stats } = getTodayStats();
  stats[field] = (stats[field] || 0) + 1;
  all[key] = stats;
  saveTodayStatsAll(all);
}
function updateStatsUI() {
  const { stats } = getTodayStats();
  if ($("statTodaySeen")) $("statTodaySeen").textContent = `Today Seen: ${stats.seen || 0}`;
  if ($("statTodayForgot")) $("statTodayForgot").textContent = `Forgot: ${stats.forgot || 0}`;
  if ($("statTodayKnew")) $("statTodayKnew").textContent = `Knew: ${stats.knew || 0}`;
}

// seen (once per card per day)
function ensureSeenCountedOncePerCard(cardId) {
  const c = cards.find(x => x.id === cardId);
  if (!c) return;
  if (c.__seenTodayKey !== todayKey()) {
    c.__seenTodayKey = todayKey();
    bumpToday("seen");
  }
}

// ---------- Forgot stats (Top10) ----------
function loadForgotStats() {
  try { return JSON.parse(localStorage.getItem(LS_FORGOT_STATS) || "{}"); }
  catch { return {}; }
}
function saveForgotStats(s) {
  localStorage.setItem(LS_FORGOT_STATS, JSON.stringify(s));
}
function bumpForgotCount(cardId) {
  const k = todayKey();
  const s = loadForgotStats();
  if (!s[k]) s[k] = {};
  s[k][cardId] = (s[k][cardId] || 0) + 1;
  saveForgotStats(s);
}
function getTop10ForgotIdsToday() {
  const day = loadForgotStats()[todayKey()] || {};
  return Object.entries(day)
    .sort((a,b)=>b[1]-a[1])
    .map(e=>e[0])
    .filter(id=>cards.some(c=>c.id===id))
    .slice(0,10);
}

// ---------- Unknown ALL ----------
function loadUnknownAll() {
  try { return JSON.parse(localStorage.getItem(LS_UNKNOWN_ALL) || "[]"); }
  catch { return []; }
}
function saveUnknownAll(list) {
  localStorage.setItem(LS_UNKNOWN_ALL, JSON.stringify(list));
}
function addToUnknownAll(card) {
  const list = loadUnknownAll();
  const key = `${card.num ?? ""}||${card.term}||${card.meaning}`;
  const exists = list.some(x => `${x.num ?? ""}||${x.term}||${x.meaning}` === key);
  if (exists) return;

  list.push({
    num: (card.num ?? null),
    term: card.term,
    meaning: card.meaning,
    addedAt: Date.now(),
  });
  saveUnknownAll(list);
}

// ---------- Mode persistence ----------
function loadBool(key) {
  try { return localStorage.getItem(key) === "1"; }
  catch { return false; }
}
function saveBool(key, on) {
  localStorage.setItem(key, on ? "1" : "0");
}

// Show button label based on Meaning mode
function updateShowButtonLabel() {
  const btn = $("btnShow");
  if (!btn) return;
  btn.textContent = meaningMode ? "Show word" : "Show meaning";
}

// ---------- Parse ----------
function parseText(text) {
  // LINEAR: keep file order exactly.
  return text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(lineRaw=>{
    const { num, rest } = stripLeadingNumber(lineRaw);

    let t="",m="";
    if (rest.includes("\t")) [t,m]=rest.split("\t");
    else if (rest.includes(" - ")) [t,m]=rest.split(" - ");
    else return null;

    return {
      id: Math.random().toString(36).slice(2),
      num: num, // may be null (safe)
      term: (t||"").trim(),
      meaning: (m||"").trim(),
      __seenTodayKey: null,
    };
  }).filter(Boolean);
}

// ---------- Build MAIN queue (order only) ----------
function buildMainQueueIds() {
  let ids = cards.map(c => c.id);
  if (reverseMode) ids = ids.slice().reverse();
  return ids;
}

// ---------- Current run queue ----------
function getCurrentRunQueueIds() {
  // Priority: RepeatUnknown > Top10 > Main
  if (repeatUnknownModeOn) {
    const mainOrder = buildMainQueueIds();
    return mainOrder.filter(id => repeatUnknownSet.has(id));
  }
  if (top10ModeOn) {
    const mainOrder = buildMainQueueIds();
    return mainOrder.filter(id => top10Set.has(id));
  }
  return buildMainQueueIds();
}

function syncRunQueueKeepCurrent() {
  const currentId = runQueue[runIndex] || null;
  runQueue = getCurrentRunQueueIds();

  if (!currentId) {
    runIndex = 0;
    return;
  }
  const idx = runQueue.indexOf(currentId);
  runIndex = idx >= 0 ? idx : 0;
}

function remainingCount() {
  const r = runQueue.length - runIndex;
  return r < 0 ? 0 : r;
}

function currentCard() {
  const id = runQueue[runIndex];
  if (!id) return null;
  return cards.find(c => c.id === id) || null;
}

// ---------- Prompt/Answer builders ----------
function buildPromptHtml(card) {
  const prefix = numPrefixHtml(card.num);
  const body = meaningMode ? card.meaning : card.term;
  return prefix + escapeHtml(body);
}
function buildAnswerText(card) {
  return meaningMode ? card.term : card.meaning;
}

// ---------- Auto-exit special runs when finished ----------
function autoExitSpecialRunIfFinished() {
  if (runIndex < runQueue.length) return;

  // finished current special run -> return to main
  if (repeatUnknownModeOn || top10ModeOn) {
    repeatUnknownModeOn = false;
    repeatUnknownSet = new Set();
    top10ModeOn = false;
    top10Set = new Set();

    // restore main
    if (resumeMain) {
      runQueue = resumeMain.queue;
      runIndex = resumeMain.index;
      resumeMain = null;
    } else {
      runQueue = buildMainQueueIds();
      runIndex = 0;
    }
  }
}

// ---------- UI ----------
function updateUI(){
  // keep show label in sync
  updateShowButtonLabel();

  // rebuild queue if needed (e.g., reverse toggled)
  if (!runQueue.length) runQueue = getCurrentRunQueueIds();
  $("stat").textContent = `Cards: ${cards.length}`;

  // "Due" element is used as Remaining
  $("due").textContent  = `Remaining: ${remainingCount()}`;
  $("unknownCount").textContent = `Unknown: ${sessionUnknownSet.size}`;

  updateStatsUI();

  // finished?
  autoExitSpecialRunIfFinished();

  if (!runQueue.length) {
    $("prompt").textContent = "Import a txt file to start.";
    $("answer").style.display = "none";
    $("btnShow").style.display = "inline-block";
    $("gradeRow").style.display = "none";
    return;
  }

  if (runIndex >= runQueue.length) {
    $("prompt").textContent = "No cards 🎉";
    $("answer").style.display = "none";
    $("btnShow").style.display = "none";
    $("gradeRow").style.display = "none";
    return;
  }

  const c = currentCard();
  if (!c) {
    runIndex += 1;
    showing = false;
    updateUI();
    return;
  }

  ensureSeenCountedOncePerCard(c.id);

  $("prompt").innerHTML = buildPromptHtml(c);

  if (showing) {
    $("answer").textContent = buildAnswerText(c);
    $("answer").style.display = "block";
    $("gradeRow").style.display = "block";
    $("btnShow").style.display = "none";
  } else {
    $("answer").style.display = "none";
    $("gradeRow").style.display = "none";
    $("btnShow").style.display = "inline-block";
  }

  $("due").textContent = `Remaining: ${remainingCount()}`;
}

// ---------- Actions ----------
function goNext() {
  runIndex += 1;
  showing = false;
  updateUI();
}

$("btnShow").onclick = () => { showing = true; updateUI(); };

$("btnForgot").onclick = () => {
  const c = currentCard(); if (!c) return;

  bumpToday("forgot");
  bumpForgotCount(c.id);

  sessionAllIds.push(c.id);
  sessionUnknownSet.add(c.id);
  addToUnknownAll(c);

  goNext();
};

$("btnKnew").onclick = () => {
  const c = currentCard(); if (!c) return;

  bumpToday("knew");

  sessionAllIds.push(c.id);
  sessionUnknownSet.delete(c.id);

  goNext();
};

// Repeat all (session) — keep confirm (prevents misclick)
$("btnRepeatAll").onclick = () => {
  if (!sessionAllIds.length) return;
  if (!confirm("Repeat all (session)?")) return;

  // Exit special runs
  top10ModeOn = false; top10Set = new Set();
  repeatUnknownModeOn = false; repeatUnknownSet = new Set();
  resumeMain = null;

  // Build queue from sessionAllIds in order, restart at 0
  runQueue = sessionAllIds.slice();
  runIndex = 0;

  showing = false;
  updateUI();
};

$("btnRepeatUnknown").onclick = () => {
  if (!sessionUnknownSet.size) return;

  // save main resume
  if (!resumeMain) resumeMain = { queue: runQueue.slice(), index: runIndex };

  repeatUnknownModeOn = true;
  repeatUnknownSet = new Set(Array.from(sessionUnknownSet));

  runQueue = getCurrentRunQueueIds();
  runIndex = 0;

  // leave top10
  top10ModeOn = false; top10Set = new Set();

  showing = false;
  updateUI();
};

$("btnTop10Forgot").onclick = () => {
  const ids = getTop10ForgotIdsToday();
  if (!ids.length) return alert("No 'I forgot' records for today yet.");

  // save main resume
  if (!resumeMain) resumeMain = { queue: runQueue.slice(), index: runIndex };

  top10ModeOn = true;
  top10Set = new Set(ids);

  runQueue = getCurrentRunQueueIds();
  runIndex = 0;

  // leave repeat-unknown
  repeatUnknownModeOn = false; repeatUnknownSet = new Set();

  showing = false;
  updateUI();
};

// ---------- Controls ----------
$("btnStats").onclick = () => {
  const panel = $("statsPanel");
  if (!panel) return;
  const isOpen = panel.style.display !== "none";
  panel.style.display = isOpen ? "none" : "block";
  updateStatsUI();
};

$("toggleMeaning").onchange = (e) => {
  meaningMode = !!e.target.checked;
  saveBool(LS_MEANING, meaningMode);

  updateShowButtonLabel();

  showing = false;
  updateUI();
};

$("toggleReverse").onchange = (e) => {
  reverseMode = !!e.target.checked;
  saveBool(LS_REVERSE, reverseMode);

  // Rebuild queue, keep current card if possible
  syncRunQueueKeepCurrent();

  showing = false;
  updateUI();
};

// ---------- Unknown buttons ----------
function makeUnknownSessionText() {
  const lines = [];
  sessionUnknownSet.forEach(id => {
    const c = cards.find(x => x.id === id);
    if (!c) return;
    const prefix = (c.num !== null && c.num !== undefined) ? `${c.num}\t` : "";
    lines.push(`${prefix}${c.term}\t${c.meaning}`);
  });
  return lines.join("\n");
}

function makeUnknownAllText() {
  const list = loadUnknownAll().slice().sort((a,b) => (a.addedAt||0) - (b.addedAt||0));
  return list.map(x => {
    const prefix = (x.num !== null && x.num !== undefined) ? `${x.num}\t` : "";
    return `${prefix}${x.term}\t${x.meaning}`;
  }).join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

$("btnDlUnknownSession").onclick = () => {
  downloadText(`unknown_session_${todayKey()}.txt`, makeUnknownSessionText() || "");
};

$("btnDlUnknownAll").onclick = () => {
  downloadText(`unknown_all_${todayKey()}.txt`, makeUnknownAllText() || "");
};

$("btnShareUnknownSession").onclick = async () => {
  const txt = makeUnknownSessionText() || "";
  const filename = `unknown_session_${todayKey()}.txt`;

  if (navigator.share && navigator.canShare) {
    try {
      const file = new File([txt], filename, { type: "text/plain" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Unknown (session)" });
        return;
      }
    } catch {}
  }
  downloadText(filename, txt);
};

$("btnClearUnknownSession").onclick = () => {
  if (!sessionUnknownSet.size) return;
  if (!confirm("Clear unknown list (session)?")) return;
  sessionUnknownSet.clear();
  updateUI();
};

// ---------- Import / Clear ----------
async function loadDefault() {
  if (cards.length) return;
  try {
    const r = await fetch(DEFAULT_TXT);
    if (!r.ok) throw 0;

    cards = parseText(await r.text());
    $("currentFile").textContent = DEFAULT_TXT;

    // Start main run from top
    runQueue = getCurrentRunQueueIds();
    runIndex = 0;

    showing = false;
    updateUI();
  } catch (e) {
    console.error("Failed to load words.txt:", e);
    $("prompt").textContent = "Failed to load words.txt";
  }
}

$("btnImport").onclick = async () => {
  const f = $("file").files[0];
  if (!f) return;

  const added = parseText(await f.text());
  cards = cards.concat(added);

  $("currentFile").textContent = f.name;

  // restart main run for predictability
  top10ModeOn = false; top10Set = new Set();
  repeatUnknownModeOn = false; repeatUnknownSet = new Set();
  resumeMain = null;

  runQueue = getCurrentRunQueueIds();
  runIndex = 0;

  showing = false;
  updateUI();
};

$("btnClear").onclick = async () => {
  cards = [];
  sessionAllIds = [];
  sessionUnknownSet.clear();

  top10ModeOn = false; top10Set = new Set();
  repeatUnknownModeOn = false; repeatUnknownSet = new Set();
  resumeMain = null;

  runQueue = [];
  runIndex = 0;

  showing = false;
  updateUI();

  await loadDefault();
};

// ---------- Init ----------
(function init(){
  meaningMode = loadBool(LS_MEANING);
  reverseMode = loadBool(LS_REVERSE);

  if ($("toggleMeaning")) $("toggleMeaning").checked = meaningMode;
  if ($("toggleReverse")) $("toggleReverse").checked = reverseMode;

  updateShowButtonLabel();
  updateStatsUI();

  loadDefault();
})();
