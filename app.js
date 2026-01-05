// ===== Default TXT =====
const DEFAULT_TXT = "words.txt";

// ===== Storage =====
const LS_CARDS = "wordmemo_cards_v2";
const LS_UNKNOWN = "wordmemo_unknown_ids_v2"; // 누적 unknown

let cards = JSON.parse(localStorage.getItem(LS_CARDS) || "[]");
let unknownIds = JSON.parse(localStorage.getItem(LS_UNKNOWN) || "[]");

let showing = false;

// ===== Session tracking (Repeat/Export for current session) =====
let sessionAllIds = [];
let sessionUnknownIds = [];

const $ = (id) => document.getElementById(id);

function saveCards() {
  localStorage.setItem(LS_CARDS, JSON.stringify(cards));
}
function saveUnknown() {
  localStorage.setItem(LS_UNKNOWN, JSON.stringify(unknownIds));
}
function pushUnique(arr, id) {
  if (!arr.includes(id)) arr.push(id);
}
function resetSession() {
  sessionAllIds = [];
  sessionUnknownIds = [];
}

// ===== Robust UTF-8 decoding helpers =====
async function responseToTextUTF8(res) {
  const buf = await res.arrayBuffer();
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}
async function fileToTextUTF8(file) {
  const buf = await file.arrayBuffer();
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

// ===== Parse optional leading number =====
// Accepts: "1000. accept", "1000) accept", "1000: accept", "1000 - accept"
function stripLeadingNumber(s) {
  const m = s.match(/^\s*(\d{1,5})\s*(?:[.)：:]\s*|-\s+)\s*(.+)$/);
  if (!m) return { num: null, rest: s.trim() };
  return { num: m[1], rest: (m[2] || "").trim() };
}

// ===== TXT Parsing =====
// supported formats (one per line):
// 1) [optional number] word<TAB>meaning
// 2) [optional number] word - meaning
// 3) [optional number] word-meaning  (split once)
function parseText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out = [];
  for (const rawLine of lines) {
    const { num, rest } = stripLeadingNumber(rawLine);

    let term = "";
    let meaning = "";

    if (rest.includes("\t")) {
      const parts = rest.split("\t");
      term = (parts[0] || "").trim();
      meaning = (parts.slice(1).join("\t") || "").trim();
    } else if (rest.includes(" - ")) {
      const parts = rest.split(" - ");
      term = (parts[0] || "").trim();
      meaning = (parts.slice(1).join(" - ") || "").trim();
    } else if (rest.includes("-")) {
      const idx = rest.indexOf("-");
      term = rest.slice(0, idx).trim();
      meaning = rest.slice(idx + 1).trim();
    } else {
      continue;
    }

    if (!term || !meaning) continue;

    out.push({
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2),
      num, // optional
      term,
      meaning,
      level: 0,
      due: Date.now()
    });
  }
  return out;
}

// ===== SRS =====
function dueCards() {
  return cards.filter((c) => (c.due || 0) <= Date.now());
}
function nextDue(level) {
  const days = [0, 1, 3, 7, 14, 30];
  const lvl = Math.max(0, Math.min(5, level));
  if (lvl === 0) return Date.now() + 10 * 60 * 1000; // +10 min
  return Date.now() + days[lvl] * 86400000; // +days
}

// ===== Repeat helpers (session) =====
function repeatAllSession() {
  if (sessionAllIds.length === 0) return;

  const now = Date.now();
  for (const id of sessionAllIds) {
    const idx = cards.findIndex((c) => c.id === id);
    if (idx >= 0) cards[idx].due = now;
  }
  saveCards();
  showing = false;
  updateUI();
}

function repeatUnknownSession() {
  if (sessionUnknownIds.length === 0) return;

  const now = Date.now();
  for (const id of sessionUnknownIds) {
    const idx = cards.findIndex((c) => c.id === id);
    if (idx >= 0) cards[idx].due = now;
  }
  saveCards();
  showing = false;
  updateUI();
}

// ===== Unknown export helpers =====
function getCardsByIds(ids) {
  return ids.map((id) => cards.find((c) => c.id === id)).filter(Boolean);
}

function buildTxt(cardsArr) {
  return cardsArr
    .map((c) => {
      const prefix = c.num ? `${c.num}. ` : "";
      return `${prefix}${c.term}\t${c.meaning}`;
    })
    .join("\n");
}

function downloadTextFile(filename, text) {
  const blob = new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Export: session unknown
function exportUnknownSessionTxt() {
  if (sessionUnknownIds.length === 0) {
    alert("No unknown words in this session yet.");
    return;
  }
  const list = getCardsByIds(sessionUnknownIds);
  if (!list.length) return alert("Unknown words not found (maybe cleared).");

  downloadTextFile(`unknown_session_${dateStamp()}.txt`, buildTxt(list));
}

// Export: cumulative unknown
function exportUnknownAllTxt() {
  if (unknownIds.length === 0) {
    alert("Unknown list is empty.");
    return;
  }
  const list = getCardsByIds(unknownIds);
  if (!list.length) return alert("Unknown words not found (maybe cleared).");

  downloadTextFile(`unknown_ALL_${dateStamp()}.txt`, buildTxt(list));
}

// Share (iPhone Save to Files via share sheet when supported)
async function shareUnknownAll() {
  if (unknownIds.length === 0) {
    alert("Unknown list is empty.");
    return;
  }

  const list = getCardsByIds(unknownIds);
  if (!list.length) return alert("Unknown words not found (maybe cleared).");

  const filename = `unknown_ALL_${dateStamp()}.txt`;
  const text = buildTxt(list);
  const blob = new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" });

  if (navigator.share && window.File) {
    try {
      const file = new File([blob], filename, { type: "text/plain" });
      await navigator.share({ files: [file], title: filename, text: "Unknown words" });
      return;
    } catch (e) {
      // cancelled / not allowed in this context -> fallback
    }
  }

  downloadTextFile(filename, text);
}

function clearUnknownAll() {
  if (!confirm("Clear ALL unknown words list?")) return;
  unknownIds = [];
  saveUnknown();
  updateUI();
  alert("Unknown list cleared.");
}

// ===== UI =====
function updateButtons() {
  if ($("btnRepeatAll")) $("btnRepeatAll").disabled = sessionAllIds.length === 0;
  if ($("btnRepeatUnknown")) $("btnRepeatUnknown").disabled = sessionUnknownIds.length === 0;

  if ($("btnExportUnknownSession"))
    $("btnExportUnknownSession").disabled = sessionUnknownIds.length === 0;

  if ($("btnExportUnknownAll")) $("btnExportUnknownAll").disabled = unknownIds.length === 0;
  if ($("btnShareUnknownAll")) $("btnShareUnknownAll").disabled = unknownIds.length === 0;
  if ($("btnClearUnknownAll")) $("btnClearUnknownAll").disabled = unknownIds.length === 0;
}

function updateUI() {
  $("stat").textContent = `Cards: ${cards.length}`;

  const due = dueCards();
  $("due").textContent = `Due: ${due.length}`;

  // ✅ Unknown 카운트는 항상(리턴 전에) 업데이트
  if ($("unknownCount")) {
    $("unknownCount").textContent = `Unknown: ${unknownIds.length}`;
  }

  updateButtons();

  const badge = $("numBadge");

  if (!due.length) {
    $("prompt").textContent = cards.length ? "No cards due 🎉" : "Import a txt file to start.";
    $("answer").classList.add("hidden");
    $("btnShow").classList.add("hidden");
    $("gradeRow").classList.add("hidden");
    if (badge) badge.classList.add("hidden");
    return;
  }

  const card = due[0];

  // number badge
  if (badge) {
    if (card.num) {
      badge.textContent = `#${card.num}`;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  $("prompt").textContent = card.term;

  if (showing) {
    $("answer").textContent = card.meaning;
    $("answer").classList.remove("hidden");
    $("gradeRow").classList.remove("hidden");
    $("btnShow").classList.add("hidden");
  } else {
    $("answer").classList.add("hidden");
    $("gradeRow").classList.add("hidden");
    $("btnShow").classList.remove("hidden");
  }
}

// ===== Default auto-load (only if empty) =====
async function loadDefaultTxtIfEmpty() {
  if (cards.length > 0) return;

  try {
    const res = await fetch(DEFAULT_TXT, { cache: "no-store" });
    if (!res.ok) return;

    const text = await responseToTextUTF8(res);
    const parsed = parseText(text);

    if (parsed.length > 0) {
      cards = parsed;
      saveCards();
      showing = false;
      resetSession();
      updateUI();
    }
  } catch (e) {
    console.warn("Default txt not loaded:", e);
  }
}

// ===== Events =====
$("btnImport").onclick = async () => {
  const file = $("file").files[0];
  if (!file) return alert("Please choose a .txt file first.");

  const text = await fileToTextUTF8(file);
  const parsed = parseText(text);

  // de-dup by term (case-insensitive)
  const existing = new Set(cards.map((c) => c.term.toLowerCase()));
  const filtered = parsed.filter((c) => !existing.has(c.term.toLowerCase()));

  cards = cards.concat(filtered);
  saveCards();

  $("file").value = "";
  showing = false;
  resetSession();
  updateUI();
};

$("btnClear").onclick = () => {
  if (!confirm("Clear all cards?")) return;

  cards = [];
  saveCards();

  showing = false;
  resetSession();
  updateUI();

  loadDefaultTxtIfEmpty();
};

$("btnShow").onclick = () => {
  showing = true;
  updateUI();
};

function gradeCurrent(knew) {
  const due = dueCards();
  const c = due[0];
  if (!c) return;

  // Track session
  pushUnique(sessionAllIds, c.id);

  if (!knew) {
    // Track session unknown
    pushUnique(sessionUnknownIds, c.id);

    // Track cumulative unknown
    pushUnique(unknownIds, c.id);
    saveUnknown();
  }

  // Apply SRS
  if (knew) {
    c.level = Math.min((c.level || 0) + 1, 5);
    c.due = nextDue(c.level);
  } else {
    c.level = 0;
    c.due = nextDue(0);
  }

  showing = false;
  saveCards();
  updateUI();
}

$("btnKnew").onclick = () => gradeCurrent(true);
$("btnForgot").onclick = () => gradeCurrent(false);

// Repeat buttons
if ($("btnRepeatAll")) $("btnRepeatAll").onclick = () => repeatAllSession();
if ($("btnRepeatUnknown")) $("btnRepeatUnknown").onclick = () => repeatUnknownSession();

// Export/Share buttons
if ($("btnExportUnknownSession")) $("btnExportUnknownSession").onclick = () => exportUnknownSessionTxt();
if ($("btnExportUnknownAll")) $("btnExportUnknownAll").onclick = () => exportUnknownAllTxt();
if ($("btnShareUnknownAll")) $("btnShareUnknownAll").onclick = () => shareUnknownAll();
if ($("btnClearUnknownAll")) $("btnClearUnknownAll").onclick = () => clearUnknownAll();

// ===== Service Worker (offline cache) =====
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// ===== Init =====
updateUI();
loadDefaultTxtIfEmpty();

