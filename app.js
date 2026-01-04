// ===== Default TXT =====
const DEFAULT_TXT = "word_3000.txt";

// ===== Storage =====
const LS = "wordmemo_cards";
let cards = JSON.parse(localStorage.getItem(LS) || "[]");
let showing = false;

const $ = (id) => document.getElementById(id);

function save() {
  localStorage.setItem(LS, JSON.stringify(cards));
}

// ===== TXT Parsing =====
// supported formats (one per line):
// 1) word<TAB>meaning
// 2) word - meaning
// 3) word-meaning  (split once)
function parseText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out = [];

  for (const line of lines) {
    let term = "";
    let meaning = "";

    if (line.includes("\t")) {
      const parts = line.split("\t");
      term = (parts[0] || "").trim();
      meaning = (parts.slice(1).join("\t") || "").trim();
    } else if (line.includes(" - ")) {
      const parts = line.split(" - ");
      term = (parts[0] || "").trim();
      meaning = (parts.slice(1).join(" - ") || "").trim();
    } else if (line.includes("-")) {
      // split only once
      const idx = line.indexOf("-");
      term = line.slice(0, idx).trim();
      meaning = line.slice(idx + 1).trim();
    } else {
      continue;
    }

    if (!term || !meaning) continue;

    out.push({
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2),
      term,
      meaning,
      level: 0,
      due: Date.now() // immediately due
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

// ===== UI =====
function updateUI() {
  $("stat").textContent = `Cards: ${cards.length}`;

  const due = dueCards();
  $("due").textContent = `Due: ${due.length}`;

  if (!due.length) {
    $("prompt").textContent = cards.length ? "No cards due 🎉" : "Import a txt file to start.";
    $("answer").classList.add("hidden");
    $("btnShow").classList.add("hidden");
    $("gradeRow").classList.add("hidden");
    return;
  }

  const card = due[0];

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
  if (cards.length > 0) return; // already have cards

  try {
    const res = await fetch(DEFAULT_TXT, { cache: "no-store" });
    if (!res.ok) return;

    const text = await res.text();
    const parsed = parseText(text);

    if (parsed.length > 0) {
      cards = parsed;
      save();
      showing = false;
      updateUI();
      console.log("Loaded default:", DEFAULT_TXT, parsed.length);
    }
  } catch (e) {
    console.warn("Default txt not loaded:", e);
  }
}

// ===== Events =====
$("btnImport").onclick = async () => {
  const file = $("file").files[0];
  if (!file) return alert("Please choose a .txt file first.");

  const text = await file.text();
  const parsed = parseText(text);

  // optional: de-dup by term (case-insensitive)
  const existing = new Set(cards.map((c) => c.term.toLowerCase()));
  const filtered = parsed.filter((c) => !existing.has(c.term.toLowerCase()));

  cards = cards.concat(filtered);
  save();

  $("file").value = "";
  showing = false;
  updateUI();
};

$("btnClear").onclick = () => {
  if (!confirm("Clear all?")) return;
  cards = [];
  save();
  showing = false;
  updateUI();
};

$("btnShow").onclick = () => {
  showing = true;
  updateUI();
};

$("btnKnew").onclick = () => {
  const c = dueCards()[0];
  if (!c) return;

  c.level = Math.min((c.level || 0) + 1, 5);
  c.due = nextDue(c.level);

  showing = false;
  save();
  updateUI();
};

$("btnForgot").onclick = () => {
  const c = dueCards()[0];
  if (!c) return;

  c.level = 0;
  c.due = nextDue(0);

  showing = false;
  save();
  updateUI();
};

// ===== Service Worker (offline cache) =====
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// ===== Init =====
updateUI();
loadDefaultTxtIfEmpty();
