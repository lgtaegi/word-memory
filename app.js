/*
  Word Memo
  Version: 1.01
  Changes:
  - Confirm dialog for "Repeat all (session)"
  - Track today's "I forgot" counts and provide "Top 10 forgot (today)" study mode
  - When Top10 mode finishes, it auto-closes (no Done popup)
*/

const DEFAULT_TXT = "words.txt";

// 저장 (기존 v1.0은 메모리-only였지만, Top10 카운트는 저장해야 해서 추가)
const LS_FORGOT_STATS = "wordmemo_forgot_stats_v1";

let cards = [];
let sessionAllIds = [];
let sessionUnknownSet = new Set();

let showing = false;

// ===== Top10 mode =====
let top10ModeOn = false;
let top10Set = new Set();

const $ = (id) => document.getElementById(id);

// =========================
// Date key (local date)
// =========================
function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// =========================
// Forgot stats store
// stats = { "YYYY-MM-DD": { [cardId]: count, ... }, ... }
// =========================
function loadForgotStats() {
  try {
    return JSON.parse(localStorage.getItem(LS_FORGOT_STATS) || "{}");
  } catch {
    return {};
  }
}
function saveForgotStats(stats) {
  localStorage.setItem(LS_FORGOT_STATS, JSON.stringify(stats));
}

function bumpForgotCount(cardId) {
  const key = todayKey();
  const stats = loadForgotStats();
  if (!stats[key]) stats[key] = {};
  stats[key][cardId] = (stats[key][cardId] || 0) + 1;
  saveForgotStats(stats);
}

function getTop10ForgotIdsToday() {
  const key = todayKey();
  const stats = loadForgotStats();
  const day = stats[key] || {};
  const entries = Object.entries(day); // [id, count]

  // count desc
  entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));

  // top 10 ids that still exist in cards
  const existing = new Set(cards.map(c => c.id));
  const ids = [];
  for (const [id] of entries) {
    if (existing.has(id)) ids.push(id);
    if (ids.length >= 10) break;
  }
  return ids;
}

// =========================
// Load default words.txt
// =========================
async function loadDefault() {
  if (cards.length > 0) return;

  try {
    const res = await fetch(DEFAULT_TXT);
    if (!res.ok) throw new Error("fetch failed");

    const text = await res.text();
    cards = parseText(text);

    $("currentFile").textContent = DEFAULT_TXT;
    updateUI();
  } catch (e) {
    $("prompt").textContent = "Failed to load words.txt";
  }
}

// =========================
// Parse text
// =========================
function parseText(text) {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      let term = "", meaning = "";

      if (line.includes("\t")) {
        [term, meaning] = line.split("\t");
      } else if (line.includes(" - ")) {
        [term, meaning] = line.split(" - ");
      } else {
        return null;
      }

      return {
        id: Math.random().toString(36).slice(2),
        term: term.trim(),
        meaning: meaning.trim(),
        level: 0,
        due: Date.now()
      };
    })
    .filter(Boolean);
}

// =========================
// SRS
// =========================
function nextDue(level) {
  if (level === 0) return Date.now() + 10 * 60 * 1000;
  const days = [1, 3, 7, 14, 30];
  return Date.now() + days[level - 1] * 86400000;
}

// ✅ 큐: Top10 모드면 Top10만
function getQueue() {
  const now = Date.now();
  if (top10ModeOn) {
    return cards.filter(c => top10Set.has(c.id) && c.due <= now);
  }
  return cards.filter(c => c.due <= now);
}

// Top10 mode가 끝나면(큐 0) 자동으로 그냥 종료
function autoCloseTop10IfFinished() {
  if (!top10ModeOn) return;
  const q = getQueue();
  if (q.length === 0) {
    top10ModeOn = false;
    top10Set = new Set();
    showing = false;
  }
}

// =========================
// UI
// =========================
function updateUI() {
  $("stat").textContent = `Cards: ${cards.length}`;

  // Due: Top10 모드에서는 "Top10 남은 개수"가 due처럼 보이게
  $("due").textContent = `Due: ${getQueue().length}`;

  // Unknown: v1.0처럼 세션 unknown 유지
  $("unknownCount").textContent = `Unknown: ${sessionUnknownSet.size}`;

  const queue = getQueue();

  if (!queue.length) {
    // Top10 모드였고 다 끝났으면, 팝업 없이 자동 종료 후 다시 UI 갱신
    if (top10ModeOn) {
      autoCloseTop10IfFinished();
      // 종료되었으니 일반 큐 기준으로 다시 그리기
      $("due").textContent = `Due: ${getQueue().length}`;
    }

    const q2 = getQueue();
    if (!q2.length) {
      $("prompt").textContent = "No cards due 🎉";
      $("answer").style.display = "none";
      $("btnShow").style.display = "none";
      $("gradeRow").style.display = "none";
      return;
    }
  }

  const card = getQueue()[0];
  if (!card) {
    $("prompt").textContent = "No cards due 🎉";
    $("answer").style.display = "none";
    $("btnShow").style.display = "none";
    $("gradeRow").style.display = "none";
    return;
  }

  $("prompt").textContent = card.term;

  if (showing) {
    $("answer").textContent = card.meaning;
    $("answer").style.display = "block";
    $("gradeRow").style.display = "block";
    $("btnShow").style.display = "none";
  } else {
    $("answer").style.display = "none";
    $("gradeRow").style.display = "none";
    $("btnShow").style.display = "inline-block";
  }
}

// =========================
// Actions
// =========================
$("btnShow").onclick = () => {
  showing = true;
  updateUI();
};

$("btnForgot").onclick = () => {
  const card = getQueue()[0];
  if (!card) return;

  // ✅ 오늘 forgot 카운트 +1
  bumpForgotCount(card.id);

  sessionAllIds.push(card.id);
  sessionUnknownSet.add(card.id);

  card.level = 0;
  card.due = nextDue(0);

  showing = false;
  updateUI();
};

$("btnKnew").onclick = () => {
  const card = getQueue()[0];
  if (!card) return;

  sessionAllIds.push(card.id);
  sessionUnknownSet.delete(card.id);

  card.level = Math.min(card.level + 1, 5);
  card.due = nextDue(card.level);

  showing = false;
  updateUI();
};

// ✅ Repeat all: 실수 방지 확인창
$("btnRepeatAll").onclick = () => {
  if (sessionAllIds.length === 0) return;

  const ok = confirm("Repeat all (session)?");
  if (!ok) return;

  const now = Date.now();
  sessionAllIds.forEach(id => {
    const c = cards.find(x => x.id === id);
    if (c) c.due = now;
  });

  // repeat all을 누르면 Top10 모드는 끄는 게 안전(실수 방지)
  top10ModeOn = false;
  top10Set = new Set();

  showing = false;
  updateUI();
};

$("btnRepeatUnknown").onclick = () => {
  if (sessionUnknownSet.size === 0) return;

  const now = Date.now();
  sessionUnknownSet.forEach(id => {
    const c = cards.find(x => x.id === id);
    if (c) c.due = now;
  });

  // repeat unknown도 Top10 모드는 끔
  top10ModeOn = false;
  top10Set = new Set();

  showing = false;
  updateUI();
};

// ✅ NEW: Top 10 forgot (today)
$("btnTop10Forgot").onclick = () => {
  const ids = getTop10ForgotIdsToday();
  if (ids.length === 0) {
    alert("No 'I forgot' records for today yet.");
    return;
  }

  // Top10 모드 ON
  top10ModeOn = true;
  top10Set = new Set(ids);

  // Top10만 지금 바로 복습되게 due를 now로 당김
  const now = Date.now();
  ids.forEach(id => {
    const c = cards.find(x => x.id === id);
    if (c) c.due = now;
  });

  showing = false;
  updateUI();
};

// =========================
// Import
// =========================
$("btnImport").onclick = async () => {
  const file = $("file").files[0];
  if (!file) return;

  const text = await file.text();
  const parsed = parseText(text);

  cards = cards.concat(parsed);
  $("currentFile").textContent = file.name;

  // 새 단어 임포트하면 모드들 정리
  top10ModeOn = false;
  top10Set = new Set();

  showing = false;
  updateUI();
};

$("btnClear").onclick = async () => {
  cards = [];
  sessionAllIds = [];
  sessionUnknownSet.clear();

  // 모드 정리
  top10ModeOn = false;
  top10Set = new Set();

  updateUI();
  await loadDefault();
};

// =========================
// Init
// =========================
loadDefault();
