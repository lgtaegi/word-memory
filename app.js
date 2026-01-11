/*
  Word Memo
  Version: 1.10
  Base: 1.09
  Changelog:
  - Word number rendering updated:
    - Always display number with trailing "."
    - Visual style handled via .word-num CSS class
*/

const DEFAULT_TXT = "words.txt";

const LS_REVERSE = "wordmemo_reverse_v1";
const LS_MEANING = "wordmemo_meaning_v1";

let cards = [];
let sessionUnknownSet = new Set();
let showing = false;

let reverseMode = false;
let meaningMode = false;

const $ = (id) => document.getElementById(id);

/* ---------- number helpers ---------- */
function stripLeadingNumber(s) {
  const m = s.match(/^\s*(\d+)[.)]?\s+(.*)$/);
  if (!m) return { num: null, rest: s.trim() };
  return { num: parseInt(m[1], 10), rest: (m[2] || "").trim() };
}

function renderNumber(num) {
  if (num === null || num === undefined) return "";
  return `<span class="word-num">${num}.</span>`;
}

/* ---------- parse ---------- */
function parseText(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const { num, rest } = stripLeadingNumber(line);

    let term = "", meaning = "";
    if (rest.includes("\t")) [term, meaning] =
