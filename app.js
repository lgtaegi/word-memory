/*
  Word Memo
  Version: 1.05
  Changes:
  - No logic changes
  - UI layout fully restored to original positions
*/

const DEFAULT_TXT = "words.txt";
const LS_FORGOT_STATS = "wordmemo_forgot_stats_v1";

let cards = [];
let sessionAllIds = [];
let sessionUnknownSet = new Set();

let showing = false;

// Top10 mode
let top10ModeOn = false;
let top10Set = new Set();

const $ = (id) => document.getElementById(id);

// ---------- Date ----------
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ---------- Forgot stats ----------
function loadForgotStats() {
  try { return JSON.parse(localStorage.getItem(LS_FORGOT_STATS) || "{}"); }
  catch { return {}; }
}
function saveForgotStats(s) {
  localStorage.setItem(LS_FORGOT_STATS, JSON.stringify(s));
}
function bumpForgotCount(id) {
  const k = todayKey();
  const s = loadForgotStats();
  if (!s[k]) s[k] = {};
  s[k][id] = (s[k][id] || 0) + 1;
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
  return text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(line=>{
    let t="",m="";
    if (line.includes("\t")) [t,m]=line.split("\t");
    else if (line.includes(" - ")) [t,m]=line.split(" - ");
    else return null;
    return { id:Math.random().toString(36).slice(2), term:t.trim(), meaning:m.trim(), level:0, due:Date.now() };
  }).filter(Boolean);
}

// ---------- SRS ----------
function nextDue(l){ return l===0?Date.now()+600000:Date.now()+[1,3,7,14,30][l-1]*86400000; }
function getQueue(){
  const n=Date.now();
  return top10ModeOn
    ? cards.filter(c=>top10Set.has(c.id)&&c.due<=n)
    : cards.filter(c=>c.due<=n);
}

// ---------- UI ----------
function updateUI(){
  $("stat").textContent=`Cards: ${cards.length}`;
  $("due").textContent=`Due: ${getQueue().length}`;
  $("unknownCount").textContent=`Unknown: ${sessionUnknownSet.size}`;

  const q=getQueue();
  if(!q.length){
    $("prompt").textContent="No cards due 🎉";
    $("answer").style.display="none";
    $("btnShow").style.display="none";
    $("gradeRow").style.display="none";
    return;
  }
  const c=q[0];
  $("prompt").textContent=c.term;

  if(showing){
    $("answer").textContent=c.meaning;
    $("answer").style.display="block";
    $("gradeRow").style.display="block";
    $("btnShow").style.display="none";
  }else{
    $("answer").style.display="none";
    $("gradeRow").style.display="none";
    $("btnShow").style.display="inline-block";
  }
}

// ---------- Actions ----------
$("btnShow").onclick=()=>{ showing=true; updateUI(); };

$("btnForgot").onclick=()=>{
  const c=getQueue()[0]; if(!c)return;
  bumpForgotCount(c.id);
  sessionAllIds.push(c.id);
  sessionUnknownSet.add(c.id);
  c.level=0; c.due=nextDue(0);
  showing=false; updateUI();
};

$("btnKnew").onclick=()=>{
  const c=getQueue()[0]; if(!c)return;
  sessionAllIds.push(c.id);
  sessionUnknownSet.delete(c.id);
  c.level=Math.min(c.level+1,5);
  c.due=nextDue(c.level);
  showing=false; updateUI();
};

$("btnRepeatAll").onclick=()=>{
  if(!sessionAllIds.length) return;
  if(!confirm("Repeat all (session)?")) return;
  const n=Date.now();
  sessionAllIds.forEach(id=>{ const c=cards.find(x=>x.id===id); if(c)c.due=n; });
  top10ModeOn=false; top10Set.clear();
  showing=false; updateUI();
};

$("btnRepeatUnknown").onclick=()=>{
  if(!sessionUnknownSet.size) return;
  const n=Date.now();
  sessionUnknownSet.forEach(id=>{ const c=cards.find(x=>x.id===id); if(c)c.due=n; });
  top10ModeOn=false; top10Set.clear();
  showing=false; updateUI();
};

$("btnTop10Forgot").onclick=()=>{
  const ids=getTop10ForgotIdsToday();
  if(!ids.length) return alert("No 'I forgot' records for today yet.");
  top10ModeOn=true; top10Set=new Set(ids);
  const n=Date.now();
  ids.forEach(id=>{ const c=cards.find(x=>x.id===id); if(c)c.due=n; });
  showing=false; updateUI();
};

// ---------- Import ----------
$("btnImport").onclick=async()=>{
  const f=$("file").files[0]; if(!f)return;
  cards=cards.concat(parseText(await f.text()));
  $("currentFile").textContent=f.name;
  top10ModeOn=false; top10Set.clear();
  showing=false; updateUI();
};

$("btnClear").onclick=async()=>{
  cards=[]; sessionAllIds=[]; sessionUnknownSet.clear();
  top10ModeOn=false; top10Set.clear();
  updateUI(); await loadDefault();
};

// ---------- Init ----------
loadDefault();
