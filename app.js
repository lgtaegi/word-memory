/*
  Word Memo
  Version: 1.08
  Base: 1.07
  Changelog:
  - Reverse mode changed: Reverse = reverse ORDER only (bottom -> top), not meaning-first
  - Meaning mode added: prompt shows meaning(KR), answer reveals term(EN)
  - Number parsing added:
    - If a line starts with a number, store it in card.num and keep term clean
    - If no number exists, card.num = null (safe; no errors)
    - Number is always displayed (if present), even in Meaning mode
  - Unknown buttons restored:
    1) Download unknown (session)
    2) Download unknown (ALL)
    3) Share / Save unknown (session)
    4) Clear unknown list (session)
  - Keeps 1.07 repeat-unknown behavior (Due becomes unknown-based in that mode)
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

// Repeat-Unknown mode (from v1.07)
let repeatUnknownModeOn = false;
let repeatUnknownSet = new Set(); // snapshot at click time

// Modes
let reverseMode = false; // order only
let meaningMode = false; // meaning-first

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
function numPrefix(num) {
  return (num === null || num === undefined || Number.isNaN(num)) ? "" : `${num} `;
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

// ---------- Load default ----------
async function loadDefault() {
  if (cards.length) return;
  try {
    const r = await fetch(DEFAULT_TXT);
    if (!r.ok) throw 0;
    cards = parseText(await r.text());
    $("currentFile").textContent = DEFAULT_TXT;
    updateUI();
  } catch {
    $("prompt").textContent = "Failed to load words.txt";
  }
}

// ---------- Parse ----------
function parseText(text) {
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
      level: 0,
      due: Date.now(),
    };
  }).filter(Boolean);
}

// ---------- SRS ----------
function nextDue(l){
  return l===0 ? Date.now()+600000 : Date.now()+[1,3,7,14,30][l-1]*86400000;
}

// ✅ Queue priority: RepeatUnknownMode > Top10Mode > Normal
function getQueue(){
  const n = Date.now();

  let list;
  if (repeatUnknownModeOn) {
    list = cards.filter(c => repeatUnknownSet.has(c.id) && c.due <= n);
  } else if (top10ModeOn) {
    list = cards.filter(c => top10Set.has(c.id) && c.due <= n);
  } else {
    list = cards.filter(c => c.due <= n);
  }

  // ✅ Reverse = reverse ORDER only (bottom -> top)
  if (reverseMode) list = list.slice().reverse();

  return list;
}

// ---------- Repeat-unknown auto-exit ----------
function autoExitRepeatUnknownIfFinished() {
  if (!repeatUnknownModeOn) return;
  if (getQueue().length === 0) {
    repeatUnknownModeOn = false;
    repeatUnknownSet = new Set();
    showing = false;
  }
}

// ---------- Prompt/Answer builders ----------
function buildPrompt(card) {
  const prefix = numPrefix(card.num);

  // Meaning mode: show Korean first
  if (meaningMode) return prefix + card.meaning;

  // Normal: show English term
  return prefix + card.term;
}
function buildAnswer(card) {
  // show the other side
  return meaningMode ? card.term : card.meaning;
}

// ---------- UI ----------
function updateUI(){
  autoExitRepeatUnknownIfFinished();

  $("stat").textContent = `Cards: ${cards.length}`;
  $("due").textContent  = `Due: ${getQueue().length}`;
  $("unknownCount").textContent = `Unknown: ${sessionUnknownSet.size}`;

  updateStatsUI();

  const q = getQueue();
  if (!q.length) {
    $("prompt").textContent = "No cards due 🎉";
    $("answer").style.display = "none";
    $("btnShow").style.display = "none";
    $("gradeRow").style.display = "none";
    return;
  }

  const c = q[0];
  ensureSeenCountedOncePerCard(c.id);

  $("prompt").textContent = buildPrompt(c);

  if (showing) {
    $("answer").textContent = buildAnswer(c);
    $("answer").style.display = "block";
    $("gradeRow").style.display = "block";
    $("btnShow").style.display = "none";
  } else {
    $("answer").style.display = "none";
    $("gradeRow").style.display = "none";
    $("btnShow").style.display = "inline-block";
  }
}

// ---------- Actions ----------
$("btnShow").onclick = () => { showing = true; updateUI(); };

$("btnForgot").onclick = () => {
  const c = getQueue()[0]; if (!c) return;

  bumpToday("forgot");
  bumpForgotCount(c.id);

  sessionAllIds.push(c.id);
  sessionUnknownSet.add(c.id);
  addToUnknownAll(c);

  c.level = 0;
  c.due = nextDue(0);

  showing = false;
  updateUI();
};

$("btnKnew").onclick = () => {
  const c = getQueue()[0]; if (!c) return;

  bumpToday("knew");

  sessionAllIds.push(c.id);
  sessionUnknownSet.delete(c.id);

  c.level = Math.min(c.level + 1, 5);
  c.due = nextDue(c.level);

  showing = false;
  updateUI();
};

$("btnRepeatAll").onclick = () => {
  if (!sessionAllIds.length) return;
  if (!confirm("Repeat all (session)?")) return;

  const n = Date.now();
  sessionAllIds.forEach(id => {
    const c = cards.find(x => x.id === id);
    if (c) c.due = n;
  });

  // leave special modes
  top10ModeOn = false; top10Set.clear();
  repeatUnknownModeOn = false; repeatUnknownSet.clear();

  showing = false;
  updateUI();
};

$("btnRepeatUnknown").onclick = () => {
  if (!sessionUnknownSet.size) return;

  // enter repeat-unknown mode using snapshot
  repeatUnknownModeOn = true;
  repeatUnknownSet = new Set(Array.from(sessionUnknownSet));

  // make them due now
  const n = Date.now();
  repeatUnknownSet.forEach(id => {
    const c = cards.find(x => x.id === id);
    if (c) c.due = n;
  });

  // leave top10
  top10ModeOn = false; top10Set.clear();

  showing = false;
  updateUI();
};

$("btnTop10Forgot").onclick = () => {
  const ids = getTop10ForgotIdsToday();
  if (!ids.length) return alert("No 'I forgot' records for today yet.");

  top10ModeOn = true;
  top10Set = new Set(ids);

  const n = Date.now();
  ids.forEach(id => {
    const c = cards.find(x => x.id === id);
    if (c) c.due = n;
  });

  // leave repeat-unknown
  repeatUnknownModeOn = false; repeatUnknownSet.clear();

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
  showing = false;
  updateUI();
};

$("toggleReverse").onchange = (e) => {
  reverseMode = !!e.target.checked;
  saveBool(LS_REVERSE, reverseMode);
  showing = false;
  updateUI();
};

// ---------- Unknown buttons (restored) ----------
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

  // fallback: download
  downloadText(filename, txt);
};

$("btnClearUnknownSession").onclick = () => {
  if (!sessionUnknownSet.size) return;
  if (!confirm("Clear unknown list (session)?")) return;
  sessionUnknownSet.clear();
  updateUI();
};

// ---------- Import ----------
$("btnImport").onclick = async () => {
  const f = $("file").files[0];
  if (!f) return;

  cards = cards.concat(parseText(await f.text()));
  $("currentFile").textContent = f.name;

  // exit modes
  top10ModeOn = false; top10Set.clear();
  repeatUnknownModeOn = false; repeatUnknownSet.clear();

  showing = false;
  updateUI();
};

$("btnClear").onclick = async () => {
  cards = [];
  sessionAllIds = [];
  sessionUnknownSet.clear();

  top10ModeOn = false; top10Set.clear();
  repeatUnknownModeOn = false; repeatUnknownSet.clear();

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

  updateStatsUI();
  loadDefault();
})();
