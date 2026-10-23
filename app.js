const ACCESS_CODE = "CPTEORAL9000";
const CASE_SECONDS = 15 * 60;
const STORE = "cpteoral_state_v1";

const AREA_LABELS = {
  msk: "Musculoskeletal", neu: "Neurological", cvr: "Cardiovascular-Respiratory",
  oth: "Other Systems", pro: "Professional Practice and Ethics", skills: "Skills and Frameworks",
};
const DOMAIN_LABELS = {
  assessment_diagnosis: "Assessment and Diagnosis",
  care_planning: "Care Planning",
  safety_client_centred: "Client Safety and Client-Centred Care",
  professional_responsibilities: "Professional Responsibilities",
  collaboration: "Collaboration",
  communication: "Communication",
  practice_management: "Practice Management",
};
const SCALE_POINTS = { 1: 0, 2: 2 / 3, 3: 4 / 3, 4: 2 };

let CASES = [];
let MCQS = [];
let currentCase = null;
let timerInterval = null;
let timerRemaining = CASE_SECONDS;
let timerRunning = false;
let timerFinished = false;
let mockQueue = null;     // array of case objects when in full-mock mode
let mockIndex = 0;
let mockNumber = 0;

let mcqFiltered = [];
let mcqIndex = 0;
let mcqAnswered = {};

function $(id) { return document.getElementById(id); }
function showScreen(id) {
  ["gate-screen", "mode-screen", "list-screen", "mockpick-screen", "case-screen",
   "mockreview-screen", "mcq-screen"].forEach(s => { $(s).style.display = s === id ? "" : "none"; });
  window.scrollTo(0, 0);
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

// ---------- persistent state (scores, practised cases) ----------
function loadState() {
  try { return JSON.parse(localStorage.getItem(STORE)) || { cases: {} }; }
  catch (e) { return { cases: {} }; }
}
function saveState(st) {
  try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) { /* private mode */ }
}
function caseRecord(id) { return loadState().cases[id] || { checks: {}, scale: {} }; }
function saveCaseRecord(id, rec) {
  const st = loadState();
  st.cases[id] = rec;
  saveState(st);
}
function scoreFor(c, rec) {
  let total = 0;
  const per = c.questions.map(q => {
    const n = q.checklist.length;
    const ticked = q.checklist.filter((_, i) => rec.checks[`${q.n}_${i}`]).length;
    const sc = rec.scale[q.n];
    const pts = (n ? 3 * ticked / n : 0) + (sc ? SCALE_POINTS[sc] : 0);
    total += pts;
    return { ticked, n, sc: sc || null, pts };
  });
  const started = Object.keys(rec.checks).some(k => rec.checks[k]) || Object.keys(rec.scale).length > 0;
  return { total, per, started };
}

// ---------- access gate ----------
function checkAccessCode() {
  const val = $("access-code-input").value.trim().toUpperCase();
  if (val === ACCESS_CODE) {
    try { sessionStorage.setItem("cpteoral_access", "1"); } catch (e) {}
    showScreen("mode-screen");
  } else {
    $("gate-error").textContent = "Incorrect access code. Please check your book or listing for the code.";
  }
}
$("gate-submit").addEventListener("click", checkAccessCode);
$("access-code-input").addEventListener("keydown", e => { if (e.key === "Enter") checkAccessCode(); });

// ---------- mode select ----------
$("mode-cases").addEventListener("click", () => loadCases(false));
$("mode-mock").addEventListener("click", () => loadCases(true));
$("mode-mcq").addEventListener("click", () => loadMcq());
$("back-to-mode-from-list").addEventListener("click", e => { e.preventDefault(); showScreen("mode-screen"); });
$("back-to-mode-from-mockpick").addEventListener("click", () => showScreen("mode-screen"));
$("back-to-mode-from-mcq").addEventListener("click", () => showScreen("mode-screen"));
$("back-to-mode-from-review").addEventListener("click", () => showScreen("mode-screen"));

async function ensureCases() {
  if (CASES.length === 0) {
    const res = await fetch("cases.json");
    CASES = await res.json();
    buildCaseFilters();
  }
}
async function loadCases(mockMode) {
  try {
    await ensureCases();
    if (mockMode) { buildMockButtons(); showScreen("mockpick-screen"); }
    else { renderList(); showScreen("list-screen"); }
  } catch (e) {
    alert("Could not load the cases. Please refresh and try again.");
  }
}

function buildCaseFilters() {
  const mockSel = $("filter-mock");
  [...new Set(CASES.map(c => c.mock))].sort((a, b) => a - b).forEach(m => {
    const o = document.createElement("option");
    o.value = m; o.textContent = `Mock ${m}`; mockSel.appendChild(o);
  });
  const areaSel = $("filter-area");
  [...new Set(CASES.map(c => c.area))].forEach(a => {
    const o = document.createElement("option");
    o.value = a; o.textContent = AREA_LABELS[a] || a; areaSel.appendChild(o);
  });
}

function renderList() {
  const mockF = $("filter-mock").value, areaF = $("filter-area").value;
  const st = loadState();
  const filtered = CASES.filter(c => (!mockF || String(c.mock) === mockF) && (!areaF || c.area === areaF));
  $("case-count").textContent = `${filtered.length} case${filtered.length === 1 ? "" : "s"}`;
  const box = $("case-list");
  box.innerHTML = "";
  filtered.forEach(c => {
    const rec = st.cases[c.id];
    const sc = rec ? scoreFor(c, rec) : null;
    const card = document.createElement("div");
    card.className = "station-card" + (sc && sc.started ? " done" : "");
    card.innerHTML = `
      <div class="num">Case ${c.id} &middot; Mock ${c.mock}, case ${c.position}${sc && sc.started ? ` <span class="done-check">&#10003; ${sc.total.toFixed(1)} / 15</span>` : ""}</div>
      <div class="title">${escapeHtml(c.setting)}</div>
      <div class="tags"><span class="tag">${AREA_LABELS[c.area] || c.area}</span></div>`;
    card.addEventListener("click", () => { mockQueue = null; openCase(c); });
    box.appendChild(card);
  });
}
$("filter-mock").addEventListener("change", renderList);
$("filter-area").addEventListener("change", renderList);

// ---------- case screen ----------
function openCase(c, opts) {
  opts = opts || {};
  currentCase = c;
  const inMock = !!mockQueue;
  $("case-title-header").textContent = inMock ? `Mock ${mockNumber}: Case ${mockIndex + 1} of 10`
                                              : `Case ${c.id}`;
  $("case-area-badge").textContent = AREA_LABELS[c.area] || c.area;
  $("case-mock-badge").textContent = `Mock ${c.mock}, case ${c.position}`;
  $("case-profile").textContent = c.client_profile;
  $("case-scenario").textContent = c.clinical_scenario;
  $("case-questions").innerHTML = c.questions.map(q =>
    `<p><strong>Question ${q.n}.</strong> ${escapeHtml(q.prompt)}</p>`).join("");
  $("case-notes").value = "";
  $("mock-progress").textContent = inMock ? `Case ${mockIndex + 1} of 10` : "";
  $("answer-section").style.display = "none";
  $("reveal-panel").style.display = opts.review || !inMock ? "" : "none";
  $("candidate-resource").classList.remove("hidden");
  $("next-case-btn").classList.add("hidden");
  $("timer-start").classList.remove("hidden");
  $("timer-reset").classList.toggle("hidden", inMock);
  $("back-to-list").textContent = inMock ? "← End mock" : "← All Cases";
  resetTimer();
  if (opts.review) {
    $("timer-howto").textContent = "Review mode. Reveal the checklist and model answer below and score yourself.";
    $("timer-display").parentElement.classList.add("hidden");
    revealAnswers(true);
    $("reveal-panel").style.display = "none";
  } else {
    $("timer-display").parentElement.classList.remove("hidden");
    $("timer-howto").innerHTML = inMock
      ? "Full mock mode. Click <strong>Start 15-Minute Clock</strong>. Reading, planning and speaking all happen inside the 15 minutes. When the clock ends the case closes and you move on. Nothing is revealed until the whole mock is finished."
      : "Read the case below, then click <strong>Start 15-Minute Clock</strong>. The 15 minutes include reading, planning and speaking. Answer the three questions aloud, in order. The examiners give no time warnings, but this clock does turn amber at 3 minutes and red at 1 minute.";
  }
  showScreen("case-screen");
}

$("back-to-list").addEventListener("click", () => {
  if (mockQueue && !confirm("End this mock now? Your place in it will be lost.")) return;
  stopTimer();
  if (mockQueue) { mockQueue = null; showScreen("mode-screen"); return; }
  renderList();
  showScreen("list-screen");
});

// ---------- timer ----------
function fmt(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerRunning = false;
}
function resetTimer() {
  stopTimer();
  timerRemaining = CASE_SECONDS;
  timerFinished = false;
  $("timer-display").textContent = fmt(timerRemaining);
  $("timer-display").className = "big";
  $("timer-label").textContent = "Ready";
  $("timer-start").textContent = "Start 15-Minute Clock";
  $("timer-start").disabled = false;
}
function tick() {
  timerRemaining--;
  $("timer-display").textContent = fmt(Math.max(timerRemaining, 0));
  if (timerRemaining <= 60) $("timer-display").className = "big warning";
  else if (timerRemaining <= 180) $("timer-display").className = "big amber";
  if (timerRemaining <= 0) finishTimer();
}
function finishTimer() {
  stopTimer();
  timerFinished = true;
  $("timer-display").textContent = "0:00";
  $("timer-display").className = "big done";
  $("timer-label").textContent = "Case complete. Stop speaking.";
  $("timer-start").classList.add("hidden");
  if (mockQueue) {
    $("candidate-resource").classList.add("hidden");
    $("next-case-btn").classList.remove("hidden");
    $("next-case-btn").textContent = mockIndex < mockQueue.length - 1 ? "Next Case →" : "Finish Mock";
  }
}
$("timer-start").addEventListener("click", () => {
  if (timerRunning) return;
  timerRunning = true;
  $("timer-start").disabled = true;
  $("timer-label").textContent = "Running";
  timerInterval = setInterval(tick, 1000);
});
$("timer-reset").addEventListener("click", () => { resetTimer(); $("timer-start").classList.remove("hidden"); });
$("next-case-btn").addEventListener("click", () => {
  if (mockIndex < mockQueue.length - 1) { mockIndex++; openCase(mockQueue[mockIndex]); }
  else showMockReview();
});

// ---------- reveal and self-scoring ----------
function revealAnswers(skipConfirm) {
  const c = currentCase;
  if (!c) return;
  if (!skipConfirm && !timerFinished) {
    if (!confirm("You have not finished a full 15-minute clock. On the real exam you get no feedback until the Oral Section is over. Reveal the answers now anyway?")) return;
  }
  const rec = caseRecord(c.id);
  const box = $("review-container");
  box.innerHTML = "";
  c.questions.forEach(q => {
    const div = document.createElement("div");
    div.className = "q-block";
    const items = q.checklist.map((it, i) => `
      <li class="${it.critical ? "crit" : ""}">
        <input type="checkbox" data-q="${q.n}" data-i="${i}" ${rec.checks[`${q.n}_${i}`] ? "checked" : ""}>
        <span class="txt">${escapeHtml(it.point)}${it.critical ? '<span class="crit-tag">critical</span>' : ""}</span>
      </li>`).join("");
    const scaleRadios = [4, 3, 2, 1].map(n => `
      <label><input type="radio" name="scale_${q.n}" value="${n}" ${rec.scale[q.n] === n ? "checked" : ""}> <span>${n}</span></label>`).join("");
    const scaleDesc = [4, 3, 2, 1].map(n => `<p class="scale-desc"><strong>${n}:</strong> ${escapeHtml(q.scale[n])}</p>`).join("");
    const paras = String(q.model_answer).split("\n").filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join("");
    div.innerHTML = `
      <h3>Question ${q.n}: ${escapeHtml(DOMAIN_LABELS[q.domain] || q.domain)}</h3>
      <p><strong>${escapeHtml(q.prompt)}</strong></p>
      <h4>Examiner checklist (tick what you said)</h4>
      <ul class="check-list">${items}</ul>
      <h4>Performance scale (choose one)</h4>
      <div class="scale-row">${scaleRadios}</div>
      ${scaleDesc}
      <details><summary><strong>Model spoken answer</strong></summary>${paras}</details>`;
    box.appendChild(div);
  });
  box.querySelectorAll("input[type=checkbox]").forEach(el => el.addEventListener("change", () => {
    const r = caseRecord(c.id);
    r.checks[`${el.dataset.q}_${el.dataset.i}`] = el.checked;
    saveCaseRecord(c.id, r);
    updateCaseScore();
  }));
  box.querySelectorAll("input[type=radio]").forEach(el => el.addEventListener("change", () => {
    const r = caseRecord(c.id);
    r.scale[el.name.split("_")[1]] = Number(el.value);
    saveCaseRecord(c.id, r);
    updateCaseScore();
  }));
  $("safety-point-text").textContent = c.safety_or_ethics_point || "";
  $("common-errors-text").textContent = c.common_errors || "";
  $("examiner-notes-text").textContent = c.examiner_notes || "";
  $("answer-section").style.display = "";
  $("reveal-panel").style.display = "none";
  updateCaseScore();
}
function updateCaseScore() {
  const c = currentCase;
  const s = scoreFor(c, caseRecord(c.id));
  const parts = s.per.map((p, i) =>
    `Q${i + 1}: ${p.ticked}/${p.n} checklist, scale ${p.sc || "-"} = ${p.pts.toFixed(1)} / 5`).join(" &nbsp;|&nbsp; ");
  $("case-score").innerHTML = `Case score: ${s.total.toFixed(1)} / 15<br><span class="note">${parts}</span>`;
}
$("reveal-btn").addEventListener("click", () => revealAnswers(false));

// ---------- full mock ----------
function buildMockButtons() {
  const box = $("mock-buttons");
  box.innerHTML = "";
  [...new Set(CASES.map(c => c.mock))].sort((a, b) => a - b).forEach(m => {
    const b = document.createElement("button");
    b.className = "btn btn-primary";
    b.textContent = `Start Mock ${m}`;
    b.addEventListener("click", () => startMock(m));
    box.appendChild(b);
  });
}
function startMock(m) {
  mockNumber = m;
  mockQueue = CASES.filter(c => c.mock === m).sort((a, b) => a.position - b.position);
  mockIndex = 0;
  openCase(mockQueue[0]);
}
function showMockReview() {
  const list = $("mock-case-list");
  const queue = mockQueue;
  mockQueue = null;
  $("mockreview-title").textContent = `Mock ${mockNumber} Review`;
  function refresh() {
    const st = loadState();
    let total = 0, scored = 0;
    list.innerHTML = "";
    queue.forEach(c => {
      const rec = st.cases[c.id];
      const s = rec ? scoreFor(c, rec) : { total: 0, started: false };
      if (s.started) { total += s.total; scored++; }
      const card = document.createElement("div");
      card.className = "station-card" + (s.started ? " done" : "");
      card.innerHTML = `<div class="num">Case ${c.position} of 10 &middot; ${AREA_LABELS[c.area] || c.area}${s.started ? ` <span class="done-check">&#10003; ${s.total.toFixed(1)} / 15</span>` : ""}</div>
        <div class="title">${escapeHtml(c.setting)}</div>`;
      card.addEventListener("click", () => {
        mockQueue = null;
        openCase(c, { review: true });
        $("back-to-list").onclick = () => { showMockReview2(queue); };
      });
      list.appendChild(card);
    });
    $("mock-total").innerHTML = `Total so far: ${total.toFixed(1)} / 150 (${scored} of 10 cases scored)<br>
      <span class="note">CAPR publishes no pass percentage. Use this number to track your own progress between mocks.</span>`;
  }
  window.__refreshMock = refresh;
  refresh();
  showScreen("mockreview-screen");
}
function showMockReview2(queue) {
  $("back-to-list").onclick = null;
  mockQueue = queue;
  showMockReview();
}

// ---------- supplementary MCQ ----------
async function loadMcq() {
  try {
    if (MCQS.length === 0) {
      const res = await fetch("questions.json");
      MCQS = await res.json();
      const sel = $("mcq-filter-area");
      [...new Set(MCQS.map(q => q.area))].forEach(a => {
        const o = document.createElement("option");
        o.value = a; o.textContent = AREA_LABELS[a] || a; sel.appendChild(o);
      });
    }
    applyMcqFilter();
    showScreen("mcq-screen");
  } catch (e) {
    alert("Could not load questions. Please refresh and try again.");
  }
}
$("mcq-filter-area").addEventListener("change", applyMcqFilter);
function applyMcqFilter() {
  const f = $("mcq-filter-area").value;
  mcqFiltered = MCQS.filter(q => !f || q.area === f);
  mcqIndex = 0;
  renderMcq();
}
function renderMcq() {
  if (mcqFiltered.length === 0) {
    $("mcq-question").textContent = "No questions match this filter.";
    $("mcq-options-container").innerHTML = "";
    return;
  }
  const q = mcqFiltered[mcqIndex];
  $("mcq-progress").textContent = `Question ${mcqIndex + 1} of ${mcqFiltered.length}`;
  $("mcq-question").textContent = q.question;
  $("mcq-explanation").style.display = "none";
  const container = $("mcq-options-container");
  container.innerHTML = "";
  const letters = ["A", "B", "C", "D"];
  const prior = mcqAnswered[q.id];
  q.options.forEach((opt, i) => {
    const letter = letters[i];
    const div = document.createElement("div");
    div.className = "mcq-option";
    div.innerHTML = `<span class="opt-letter">${letter}.</span> <span>${escapeHtml(opt)}</span>`;
    if (prior) {
      div.classList.add("disabled");
      if (letter === q.correct) div.classList.add("correct");
      else if (letter === prior.selected) div.classList.add("incorrect");
    } else {
      div.addEventListener("click", () => { mcqAnswered[q.id] = { selected: letter, correct: letter === q.correct }; renderMcq(); });
    }
    container.appendChild(div);
  });
  if (prior) {
    $("mcq-explanation").style.display = "";
    $("mcq-explanation-text").textContent = q.explanation;
  }
  const ids = Object.keys(mcqAnswered);
  const ok = ids.filter(id => mcqAnswered[id].correct).length;
  $("mcq-score").textContent = ids.length ? `Score so far: ${ok} of ${ids.length} correct` : "";
}
$("mcq-next").addEventListener("click", () => { if (mcqIndex < mcqFiltered.length - 1) { mcqIndex++; renderMcq(); } });
$("mcq-prev").addEventListener("click", () => { if (mcqIndex > 0) { mcqIndex--; renderMcq(); } });

// ---------- init ----------
try {
  if (sessionStorage.getItem("cpteoral_access") === "1") showScreen("mode-screen");
} catch (e) {}
