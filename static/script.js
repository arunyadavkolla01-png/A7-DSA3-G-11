const $ = (id) => document.getElementById(id);
let ALL_RESULTS = [];
let VISIBLE_RESULTS = [];

window._activeQuery = "";
window._activeScopeLabel = "full corpus";
window.ALL_RESULTS = ALL_RESULTS;

/* =========================================================
   TABS
   ========================================================= */
function switchTab(name) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  $("tab-" + name)?.classList.add("active");
  document.querySelector('.tab[data-tab="' + name + '"]')?.classList.add("active");

  if (name === "graph" && typeof window.loadGraph === "function") {
    window.loadGraph(parseInt($("graphSize")?.value) || 200, window._activeQuery);
  }
  if (name === "metrics") {
    if (typeof window.loadMetrics === "function") window.loadMetrics(window._activeQuery);
    if (typeof window.loadTrends === "function") window.loadTrends(window._activeQuery);
  }
  if (name === "lab" && !window._labRendered) {
    window._labRendered = true;
    renderLab();
  }
}
window.switchTab = switchTab;

function reloadGraph() {
  if (typeof window.loadGraph === "function") {
    window.loadGraph(parseInt($("graphSize")?.value) || 200, window._activeQuery);
  }
}
window.reloadGraph = reloadGraph;

/* =========================================================
   DYNAMIC QUICK TAGS
   ========================================================= */
async function loadQuickTags() {
  const box = $("quickTags");
  if (!box) return;
  try {
    const res = await fetch("/api/keywords/top?n=12");
    const kws = await res.json();
    const html = `<span class="label">Try:</span>` +
      kws.map(k =>
        `<button class="tag" onclick="setQuery('${escAttr(k.keyword)}')">
           ${esc(k.keyword)} <span class="tag-count">${k.count}</span>
         </button>`
      ).join("");
    box.innerHTML = html;
  } catch (e) {
    console.error("quick tags failed", e);
  }
}

function escAttr(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/* =========================================================
   RECOMMEND
   ========================================================= */
async function recommend() {
  const q = $("query").value.trim();
  if (!q) return;

  const topKRaw = $("topK").value.trim();
  let topK = null;
  if (topKRaw !== "") {
    const parsed = parseInt(topKRaw);
    if (!isNaN(parsed) && parsed > 0) topK = parsed;
  }

  $("results").innerHTML = `<div class="loading">Searching…</div>`;
  const t0 = performance.now();

  try {
    const res = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    });
    const data = await res.json();
    $("latencyLabel").textContent = Math.round(performance.now() - t0) + " ms";

    ALL_RESULTS = data.results || [];
    window.ALL_RESULTS = ALL_RESULTS;
    VISIBLE_RESULTS = topK ? ALL_RESULTS.slice(0, topK) : ALL_RESULTS;

    window._activeQuery = q;
    window._activeScopeLabel = `query: "${q}" (${ALL_RESULTS.length} papers)`;
    $("scopeLabel").textContent = window._activeScopeLabel;

    render(VISIBLE_RESULTS, ALL_RESULTS.length, topK);
    if (typeof window.refreshScope === "function") window.refreshScope(q);
  } catch (e) {
    $("results").innerHTML = `<div class="empty">
      <p class="empty-title">Error</p>
      <p class="empty-sub">${e.message}</p></div>`;
  }
}
window.recommend = recommend;

function setQuery(q) { $("query").value = q; recommend(); }
window.setQuery = setQuery;

function clearSearch() {
  $("query").value = "";
  $("topK").value = "";
  $("results").innerHTML = `<div class="empty">
    <p class="empty-title">Start searching</p>
    <p class="empty-sub">Enter a topic above</p></div>`;
  $("statsBar").classList.remove("show");
  ALL_RESULTS = [];
  VISIBLE_RESULTS = [];
  window.ALL_RESULTS = [];
  window._activeQuery = "";
  window._activeScopeLabel = "full corpus";
  $("scopeLabel").textContent = "full corpus";
  if (typeof window.refreshScope === "function") window.refreshScope("");
}
window.clearSearch = clearSearch;

/* =========================================================
   RENDER
   ========================================================= */
function render(list, totalMatches, topK) {
  if (!list.length) {
    $("results").innerHTML = `<div class="empty">
      <p class="empty-title">No matches</p>
      <p class="empty-sub">Try a different keyword</p></div>`;
    $("statsBar").classList.remove("show");
    return;
  }

  $("statsBar").classList.add("show");
  const cap = topK ? ` (Top-${topK} of ${totalMatches})` : ` (all ${totalMatches})`;
  $("statsBar").innerHTML = `Showing <b>${list.length}</b> matching papers${cap}`;

  $("results").innerHTML = list.map((r, i) => {
    const p = r.paper;
    return `<div class="paper" onclick="openPaper(${p.id})">
      <div class="paper-head">
        <span class="paper-rank">#${i + 1}</span>
        <span class="paper-score">${r.score.toFixed(4)}</span>
      </div>
      <h3 class="paper-title">${esc(p.title)}</h3>
      <div class="paper-authors">${esc(p.authors)}</div>
      <div class="paper-meta">
        ${p.year ? `<span>Year <b>${p.year}</b></span>` : ""}
        ${p.citation_count ? `<span><b>${p.citation_count}</b> citations</span>` : ""}
        <span>ID <b>#${p.id}</b></span>
      </div>
      <div class="paper-abstract">${esc(p.abstract)}</div>
    </div>`;
  }).join("");
}

/* =========================================================
   MODAL
   ========================================================= */
function openPaper(id) {
  const r = ALL_RESULTS.find(x => x.paper.id === id);
  if (!r) return;
  const p = r.paper;
  $("modalContent").innerHTML = `
    <h2>${esc(p.title)}</h2>
    <div class="m-authors">${esc(p.authors)}</div>
    <div class="m-section"><h4>Score</h4>
      <p><b style="font-size:1.3rem;color:var(--accent)">${r.score.toFixed(4)}</b>
         <span style="color:var(--muted);font-size:0.8rem;margin-left:0.5rem">rank #${r.rank}</span></p>
    </div>
    <div class="m-section"><h4>Abstract</h4>
      <p class="m-abstract">${esc(p.abstract)}</p></div>
    <div class="m-section"><h4>Keywords</h4>
      <p>${(p.keywords || []).map(k => `<code>${esc(k)}</code>`).join(" ")}</p></div>
    <div class="m-section"><h4>Signals</h4>
      <p style="font-size:0.8rem;color:var(--muted)">${(r.reasons || []).join(" · ")}</p></div>`;
  $("modal").classList.add("show");
}
window.openPaper = openPaper;

function closeModal(e) {
  if (!e || (e.target && e.target.classList.contains("modal-backdrop")))
    $("modal").classList.remove("show");
}
window.closeModal = closeModal;

/* =========================================================
   ALGORITHM LAB
   ========================================================= */
const LAB_CONFIG = [
  {
    id: "aho-corasick",
    title: "Aho-Corasick Multi-Pattern Matching",
    desc: "One pass over text finds every keyword occurrence.",
    fields: [
      { name: "text", label: "Text", value: "the deep learning model uses neural networks for computer vision", type: "text" },
      { name: "keywords", label: "Keywords (comma-separated)", value: "deep learning, neural networks, computer vision", type: "text" },
    ],
  },
  {
    id: "suffix-array",
    title: "Suffix Array + Kasai LCP",
    desc: "Manber-Myers O(n log² n) suffix array + Kasai O(n) LCP array.",
    fields: [{ name: "text", label: "Text", value: "banana", type: "text" }],
  },
  {
    id: "wagner-fischer",
    title: "Wagner-Fischer Edit Distance",
    desc: "Classic O(nm) Levenshtein distance.",
    fields: [
      { name: "a", label: "String A", value: "kitten", type: "text" },
      { name: "b", label: "String B", value: "sitting", type: "text" },
    ],
  },
  {
    id: "smith-waterman",
    title: "Smith-Waterman Local Alignment",
    desc: "Local substring alignment — finds topic phrases inside text.",
    fields: [
      { name: "a", label: "String A", value: "deep learning neural", type: "text" },
      { name: "b", label: "String B", value: "survey of deep learning neural methods", type: "text" },
      { name: "match", label: "Match score", value: "2", type: "number" },
      { name: "mismatch", label: "Mismatch score", value: "-1", type: "number" },
      { name: "gap", label: "Gap penalty", value: "-1", type: "number" },
    ],
  },
  {
    id: "dinic",
    title: "Dinic's Maximum Flow",
    desc: "Blocking-flow on level graph. O(V²E).",
    fields: [
      { name: "n", label: "Number of nodes", value: "6", type: "number" },
      { name: "source", label: "Source node", value: "0", type: "number" },
      { name: "sink", label: "Sink node", value: "5", type: "number" },
      { name: "edges", label: "Edges (u,v,cap per line)", value: "0,1,16\n0,2,13\n1,2,10\n1,3,12\n2,4,14\n3,5,20\n4,3,7\n4,5,4", type: "textarea" },
    ],
  },
  {
    id: "min-cut",
    title: "Min-Cut from Max-Flow",
    desc: "Residual reachable set from source = S; rest = T.",
    fields: [
      { name: "n", label: "Number of nodes", value: "6", type: "number" },
      { name: "source", label: "Source node", value: "0", type: "number" },
      { name: "sink", label: "Sink node", value: "5", type: "number" },
      { name: "edges", label: "Edges (u,v,cap per line)", value: "0,1,16\n0,2,13\n1,2,10\n1,3,12\n2,4,14\n3,5,20\n4,3,7\n4,5,4", type: "textarea" },
    ],
  },
  {
    id: "hopcroft-karp",
    title: "Hopcroft-Karp Bipartite Matching",
    desc: "O(E√V) max matching in a bipartite graph.",
    fields: [
      { name: "left", label: "Left nodes (comma-sep)", value: "L1,L2,L3", type: "text" },
      { name: "right", label: "Right nodes (comma-sep)", value: "R1,R2,R3", type: "text" },
      { name: "edges", label: "Edges (L,R per line)", value: "L1,R1\nL1,R2\nL2,R1\nL3,R3", type: "textarea" },
    ],
  },
  {
    id: "vertex-cover",
    title: "Vertex Cover 2-Approximation",
    desc: "Maximal matching gives a cover ≤ 2× optimal.",
    fields: [{ name: "edges", label: "Edges (u,v per line)", value: "A,B\nA,C\nB,D\nC,D\nD,E", type: "textarea" }],
  },
  {
    id: "set-cover",
    title: "Greedy Set Cover",
    desc: "O(log n) approximation — pick the set covering most uncovered elements.",
    fields: [
      { name: "universe", label: "Universe (comma-sep)", value: "1,2,3,4,5,6,7", type: "text" },
      { name: "sets", label: "Sets (one per line)", value: "1,2,3\n3,4,5\n5,6,7\n1,4,7", type: "textarea" },
    ],
  },
  {
    id: "reservoir",
    title: "Reservoir Sampling",
    desc: "Uniform random sample of k items from a stream.",
    fields: [
      { name: "k", label: "Sample size k", value: "5", type: "number" },
      { name: "stream_size", label: "Stream length", value: "100", type: "number" },
      { name: "seed", label: "RNG seed", value: "42", type: "number" },
    ],
  },
  {
    id: "blelloch",
    title: "Blelloch Parallel Scan",
    desc: "Work-efficient prefix sum. Work O(n), span O(log n).",
    fields: [{ name: "array", label: "Array (comma-sep)", value: "3,1,4,1,5,9,2,6", type: "text" }],
  },
];

function renderLab() {
  const grid = $("labGrid");
  if (!grid) return;
  grid.innerHTML = LAB_CONFIG.map(cfg => `
    <section class="card lab-card" data-lab="${cfg.id}">
      <h3 class="lab-title">${esc(cfg.title)}</h3>
      <p class="lab-desc">${esc(cfg.desc)}</p>
      <div class="lab-fields">
        ${cfg.fields.map(f => `
          <label class="lab-field">
            <span class="lab-field-label">${esc(f.label)}</span>
            ${f.type === "textarea"
              ? `<textarea data-field="${f.name}" rows="5">${esc(f.value)}</textarea>`
              : `<input data-field="${f.name}" type="${f.type}" value="${esc(f.value)}">`}
          </label>
        `).join("")}
      </div>
      <div class="lab-buttons">
        <button class="btn primary small" onclick="runLab('${cfg.id}')">▶ Run</button>
        <button class="btn ghost small" onclick="resetLab('${cfg.id}')">Reset</button>
      </div>
      <pre class="lab-output" id="lab-out-${cfg.id}">Output will appear here…</pre>
    </section>
  `).join("");
}

function readLabInputs(container) {
  const body = {};
  container.querySelectorAll("[data-field]").forEach(el => {
    body[el.dataset.field] = el.value;
  });
  return body;
}

async function runLab(id) {
  const card = document.querySelector(`.lab-card[data-lab="${id}"]`);
  if (!card) return;
  const out = card.querySelector(".lab-output");
  out.textContent = "Running…";
  try {
    const res = await fetch("/api/lab/" + id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readLabInputs(card)),
    });
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    out.textContent = "Error: " + e.message;
  }
}
window.runLab = runLab;

function resetLab(id) {
  const card = document.querySelector(`.lab-card[data-lab="${id}"]`);
  if (!card) return;
  const cfg = LAB_CONFIG.find(c => c.id === id);
  if (!cfg) return;
  cfg.fields.forEach(f => {
    const el = card.querySelector(`[data-field="${f.name}"]`);
    if (el) el.value = f.value;
  });
  const out = card.querySelector(".lab-output");
  if (out) out.textContent = "Output will appear here…";
}
window.resetLab = resetLab;

/* ---------- Escape ---------- */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ---------- Init ---------- */
window.addEventListener("DOMContentLoaded", () => {
  const q = $("query");
  if (q) q.addEventListener("keydown", e => { if (e.key === "Enter") recommend(); });
  const k = $("topK");
  if (k) k.addEventListener("keydown", e => { if (e.key === "Enter") recommend(); });
  loadQuickTags();
  console.log("[AlgoScholar] ready");
});