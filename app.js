// ===== Default TXT =====
const DEFAULT_TXT = "words.txt";

// ===== Storage =====
const LS_CARDS = "wordmemo_cards_v2";
const LS_UNKNOWN = "wordmemo_unknown_ids_v2";     // 누적 unknown (ALL)
const LS_WORDS_SIG = "wordmemo_words_sig_v1";     // words.txt 변경 감지용 (오픈 시 1회)
const LS_CURRENT_FILE = "wordmemo_current_file";  // 현재 로드된(표시할) 파일명

let cards = JSON.parse(localStorage.getItem(LS_CARDS) || "[]");
let unknownIds = JSON.parse(localStorage.getItem(LS_UNKNOWN) || "[]");

let showing = false;

// ===== Session tracking =====
let sessionAllIds = [];
let sessionUnknownIds = [];

const $ = (id) => document.getElementById(id);

function saveCards() { localStorage.setItem(LS_CARDS, JSON.stringify(cards)); }
function saveUnknown() { localStorage.setItem(LS_UNKNOWN, JSON.stringify(unknownIds)); }
function pushUnique(arr, id) { if (!arr.includes(id)) arr.push(id); }
function resetSession() { sessionAllIds = []; sessionUnknownIds = []; }

// ===== Current file label =====
function setCurrentFile(name) {
  localStorage.setItem(LS_CURRENT_FILE, name);
  if ($("currentFile")) $("currentFile").textContent = name;
}
function getCurrentFile() {
  return localStorage.getItem(LS_CURRENT_FILE) || "";
}
function loadCurrentFileLabel() {
  const name = getCurrentFile();
  if ($("currentFile")) $("currentFile").textContent = name || "–";
}

// ===== DONE popup =====
function donePopup() {
  alert("Done!");
}

// ===== Robust UTF-8 decoding =====
async function responseToTextUTF8(res) {
  const buf = await res.arrayBuffer();
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}
async function fileToTextUTF8(file) {
  const buf = await file.arrayBuffer();
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

// ===== Parse optional leading number =====
function stripLeadingNumber(s) {
  const m = s.match(/^\s*(\d{1,5})\s*(?:[.)：:]\s*|-\s+)\s*(.+)$/);
  if (!m) return { num: null, rest: s.trim() };
  return { num: m[1], rest: (m[2] || "").trim() };
}

// ===== TXT Parsing =====
function parseText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

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
      num,
      term,
      meaning,
      level: 0,
      due: Date.now()
    });
  }
  return out;
}

// ===== SRS =====
function nextDue(level) {
  const days = [0, 1, 3, 7, 14, 30];
  const lvl = Math.max(0, Math.min(5, level));
  if (lvl === 0) return Date.now() + 10 * 60 * 1000;
  return Date.now() + days[lvl] * 86400000;
}

// =====================================================
// ✅ Unknown-only 반복을 “모드 UI 없이” 구현: FILTER 방식
// =====================================================
let unknownFilterOn = false;
let unknownFilterSet = new Set();   // 남아있는 unknown(실시간 감소)
let unknownFilterIds = [];          // 순서 유지용(필요시)

function setStudyHintVisible(on) {
  const el = $("studyHint");
  if (!el) return;
  el.classList.toggle("hidden", !on);
}

function clearUnknownFilter(silent = false) {
  unknownFilterOn = false;
  unknownFilterSet = new Set();
  unknownFilterIds = [];
  setStudyHintVisible(false);
  if (!silent) updateUI();
}

function startUnknownFilterFromSession() {
  if (sessionUnknownIds.length === 0) return;

  unknownFilterOn = true;
  unknownFilterIds = [...sessionUnknownIds];
  unknownFilterSet = new Set(unknownFilterIds);

  // 이 unknown들만 바로 복습되도록 due를 당김
  const now = Date.now();
  for (const id of unknownFilterIds) {
    const idx = cards.findIndex(c => c.id === id);
    if (idx >= 0) cards[idx].due = now;
  }
  saveCards();

  setStudyHintVisible(true);
  showing = false;
  updateUI();
}

function getQueue() {
  const now = Date.now();

  if (unknownFilterOn) {
    // 남은 게 0이면 Done + 필터 자동 해제
    if (unknownFilterSet.size === 0) {
      donePopup();
      clearUnknownFilter(true);
      return [];
    }
    return cards.filter(c => unknownFilterSet.has(c.id) && (c.due || 0) <= now);
  }

  return cards.filter(c => (c.due || 0) <= now);
}

// ===== Repeat helpers =====
function repeatAllSession() {
  if (sessionAllIds.length === 0) return;

  // repeat all 하면 전체로 돌아가기
  clearUnknownFilter(true);

  const now = Date.now();
  for (const id of sessionAllIds) {
    const idx = cards.findIndex(c => c.id === id);
    if (idx >= 0) cards[idx].due = now;
  }
  saveCards();

  showing = false;
  updateUI();
}

// ===== Unknown export helpers =====
function getCardsByIds(ids) {
  return ids.map(id => cards.find(c => c.id === id)).filter(Boolean);
}

function buildTxt(cardsArr) {
  return cardsArr.map(c => {
    const prefix = c.num ? `${c.num}. ` : "";
    return `${prefix}${c.term}\t${c.meaning}`;
  }).join("\n");
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

function exportUnknownSessionTxt() {
  if (sessionUnknownIds.length === 0) {
    alert("No unknown words in this session yet.");
    return;
  }
  const list = getCardsByIds(sessionUnknownIds);
  if (!list.length) return alert("Unknown words not found (maybe cleared).");
  downloadTextFile(`unknown_session_${dateStamp()}.txt`, buildTxt(list));
}

function exportUnknownAllTxt() {
  if (unknownIds.length === 0) {
    alert("Unknown list is empty.");
    return;
  }
  const list = getCardsByIds(unknownIds);
  if (!list.length) return alert("Unknown words not found (maybe cleared).");
  downloadTextFile(`unknown_ALL_${dateStamp()}.txt`, buildTxt(list));
}

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
    } catch (e) {}
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

// ===== words.txt update check (open/visible only) =====
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function fetchWordsSignature() {
  const bust = `?v=${Date.now()}`;
  const res = await fetch(DEFAULT_TXT + bust, { cache: "no-store" });
  if (!res.ok) throw new Error(`words fetch failed: ${res.status}`);
  const text = await responseToTextUTF8(res);
  const hash = await sha256Hex(text);
  return { sig: `B:${hash}`, text };
}

function mergePreserveProgress(freshCards) {
  const oldMap = new Map(cards.map(c => [c.term.toLowerCase(), c]));

  const merged = freshCards.map(nc => {
    const key = nc.term.toLowerCase();
    const old = oldMap.get(key);
    if (old) {
      return { ...old, num: nc.num ?? old.num ?? null, term: nc.term, meaning: nc.meaning };
    }
    return nc;
  });

  cards = merged;
  saveCards();

  const existingIds = new Set(cards.map(c => c.id));
  unknownIds = unknownIds.filter(id => existingIds.has(id));
  saveUnknown();

  // 필터 중이면, 사라진 id 제거
  if (unknownFilterOn) {
    unknownFilterIds = unknownFilterIds.filter(id => existingIds.has(id));
    unknownFilterSet = new Set([...unknownFilterSet].filter(id => existingIds.has(id)));
  }

  resetSession();
  showing = false;
  updateUI();
}

async function checkWordsUpdateOnOpen() {
  try {
    const currentFile = getCurrentFile();
    if (currentFile && currentFile !== DEFAULT_TXT) return;

    const prevSig = localStorage.getItem(LS_WORDS_SIG);
    const { sig, text } = await fetchWordsSignature();

    if (!prevSig) {
      localStorage.setItem(LS_WORDS_SIG, sig);
      return;
    }

    if (sig !== prevSig) {
      const fresh = parseText(text);
      if (fresh.length === 0) return;

      localStorage.setItem(LS_WORDS_SIG, sig);
      mergePreserveProgress(fresh);

      // currentFile 표시 잠깐 UPDATED
      const el = $("currentFile");
      if (el) {
        el.textContent = `${DEFAULT_TXT}  ✅ UPDATED`;
        setTimeout(() => { el.textContent = DEFAULT_TXT; }, 1800);
      }
    }
  } catch (e) {
    console.warn("checkWordsUpdateOnOpen error:", e);
  }
}

// ===== UI =====
function updateButtons() {
  if ($("btnRepeatAll")) $("btnRepeatAll").disabled = sessionAllIds.length === 0;
  if ($("btnRepeatUnknown")) $("btnRepeatUnknown").disabled = sessionUnknownIds.length === 0;

  if ($("btnExportUnknownSession")) $("btnExportUnknownSession").disabled = sessionUnknownIds.length === 0;
  if ($("btnExportUnknownAll")) $("btnExportUnknownAll").disabled = unknownIds.length === 0;
  if ($("btnShareUnknownAll")) $("btnShareUnknownAll").disabled = unknownIds.length === 0;
  if ($("btnClearUnknownAll")) $("btnClearUnknownAll").disabled = unknownIds.length === 0;
}

function updateUI() {
  $("stat").textContent = `Cards: ${cards.length}`;

  const queue = getQueue();
  const dueShown = unknownFilterOn ? unknownFilterSet.size : cards.filter(c => (c.due || 0) <= Date.now()).length;
  $("due").textContent = `Due: ${dueShown}`;

  // ✅ Unknown 카운트도 “현재 공부 대상” 기준으로 실시간
  if (unknownFilterOn) {
    $("unknownCount").textContent = `Unknown: ${unknownFilterSet.size}`;
  } else {
    $("unknownCount").textContent = `Unknown: ${unknownIds.length}`;
  }

  setStudyHintVisible(unknownFilterOn);
  updateButtons();

  const badge = $("numBadge");

  if (!queue.length) {
    $("prompt").textContent = cards.length ? "No cards due 🎉" : "Import a txt file to start.";
    $("answer").classList.add("hidden");
    $("btnShow").classList.add("hidden");
    $("gradeRow").classList.add("hidden");
    if (badge) badge.classList.add("hidden");
    return;
  }

  const card = queue[0];

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

// ===== Default auto-load =====
async function loadDefaultTxtIfEmpty() {
  if (cards.length > 0) return;

  try {
    const res = await fetch(DEFAULT_TXT + `?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      $("prompt").textContent = `Default file not found: ${DEFAULT_TXT} (HTTP ${res.status})`;
      $("answer").classList.add("hidden");
      $("btnShow").classList.add("hidden");
      $("gradeRow").classList.add("hidden");
      return;
    }

    const text = await responseToTextUTF8(res);
    const parsed = parseText(text);

    if (parsed.length === 0) {
      $("prompt").textContent =
        `Loaded ${DEFAULT_TXT}, but 0 lines parsed. Check format: word<TAB>meaning or word - meaning`;
      return;
    }

    cards = parsed;
    saveCards();
    setCurrentFile(DEFAULT_TXT);

    try {
      const sigHash = await sha256Hex(text);
      localStorage.setItem(LS_WORDS_SIG, `B:${sigHash}`);
    } catch (e) {}

    showing = false;
    resetSession();
    updateUI();
  } catch (e) {
    $("prompt").textContent = `Failed to load ${DEFAULT_TXT}: ${String(e)}`;
  }
}

// ===== Events =====
$("btnImport").onclick = async () => {
  const file = $("file").files[0];
  if (!file) return alert("Please choose a .txt file first.");

  const text = await fileToTextUTF8(file);
  const parsed = parseText(text);

  if (parsed.length === 0) {
    alert("0 words parsed. Check format: word<TAB>meaning or word - meaning");
    return;
  }

  const existing = new Set(cards.map(c => c.term.toLowerCase()));
  const filtered = parsed.filter(c => !existing.has(c.term.toLowerCase()));

  cards = cards.concat(filtered);
  saveCards();

  setCurrentFile(file.name);

  // import하면 unknown-only 필터 해제
  clearUnknownFilter(true);

  $("file").value = "";
  showing = false;
  resetSession();
  updateUI();
};

$("btnClear").onclick = async () => {
  if (!confirm("Clear all cards?")) return;

  cards = [];
  saveCards();

  clearUnknownFilter(true);
  resetSession();

  showing = false;
  updateUI();

  await loadDefaultTxtIfEmpty();
};

$("btnShow").onclick = () => {
  showing = true;
  updateUI();
};

function gradeCurrent(knew) {
  const queue = getQueue();
  const c = queue[0];
  if (!c) return;

  pushUnique(sessionAllIds, c.id);

  if (!knew) {
    pushUnique(sessionUnknownIds, c.id);
    pushUnique(unknownIds, c.id);
    saveUnknown();
  }

  if (knew) {
    c.level = Math.min((c.level || 0) + 1, 5);
    c.due = nextDue(c.level);

    // ✅ unknown-only 필터 중이면: I knew → 남은 목록에서 제거(실시간 감소)
    if (unknownFilterOn && unknownFilterSet.has(c.id)) {
      unknownFilterSet.delete(c.id);
      unknownFilterIds = unknownFilterIds.filter(id => id !== c.id);

      if (unknownFilterSet.size === 0) {
        saveCards();
        showing = false;
        donePopup();
        clearUnknownFilter(true);
        updateUI();
        return;
      }
    }
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
if ($("btnRepeatUnknown")) $("btnRepeatUnknown").onclick = () => startUnknownFilterFromSession();

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
(async function init() {
  updateUI();
  loadCurrentFileLabel();

  // cards가 있는데 current file이 비어 있으면 기본 파일로 보정
  if (cards.length > 0 && !getCurrentFile()) {
    setCurrentFile(DEFAULT_TXT);
  }

  await loadDefaultTxtIfEmpty();
  await checkWordsUpdateOnOpen();

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      await checkWordsUpdateOnOpen();
    }
  });
})();
