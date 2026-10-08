window._graphData = null;
window._metricsLoaded = false;
window._trendsLoaded = false;
let pathEndpoints = { source: null, target: null };
let selectedNode = null;

function _el(id) { return document.getElementById(id); }

/* =========================================================
   REFRESH
   ========================================================= */
function refreshScope(query) {
  const label = query ? `query: "${query}"` : "full corpus";
  if (_el("graphScope")) _el("graphScope").textContent = label;
  if (_el("metricsScope")) _el("metricsScope").textContent = label;

  if (_el("tab-graph")?.classList.contains("active")) {
    loadGraph(parseInt(_el("graphSize")?.value) || 200, query);
  }
  if (_el("tab-metrics")?.classList.contains("active")) {
    loadMetrics(query);
    loadTrends(query);
  }
}
window.refreshScope = refreshScope;

/* =========================================================
   GRAPH
   ========================================================= */
async function loadGraph(n, query) {
  n = n || 200;
  query = query !== undefined ? query : (window._activeQuery || "");
  const wrap = _el("graphSvgWrap");
  if (!wrap) return;
  wrap.innerHTML = `<div class="graph-loading">Loading ${query ? `"${query}" subgraph` : "full citation graph"}…</div>`;

  try {
    const url = `/api/graph?n=${n}` + (query ? `&query=${encodeURIComponent(query)}` : "");
    const res = await fetch(url);
    const data = await res.json();
    window._graphData = data;
    drawGraph(data);
    updateStats(data);
  } catch (e) {
    wrap.innerHTML = `<div class="graph-loading">Error: ${e.message}</div>`;
  }
}
window.loadGraph = loadGraph;

function drawGraph(data) {
  const wrap = _el("graphSvgWrap");
  wrap.innerHTML = "";

  if (!data.nodes || !data.nodes.length) {
    wrap.innerHTML = `<div class="graph-loading">No nodes match this query.</div>`;
    return;
  }

  const W = wrap.clientWidth || 900, H = 620;

  const svg = d3.select(wrap).append("svg")
    .attr("viewBox", [0, 0, W, H])
    .attr("class", "graph-svg")
    .style("width", "100%").style("height", "100%");

  svg.append("defs").append("marker")
    .attr("id", "arrow").attr("viewBox", "0 -5 10 10")
    .attr("refX", 18).attr("refY", 0)
    .attr("markerWidth", 5).attr("markerHeight", 5)
    .attr("orient", "auto")
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#b0b0b5");

  const g = svg.append("g");
  const zoom = d3.zoom().scaleExtent([0.2, 6])
    .on("zoom", (e) => g.attr("transform", e.transform));
  svg.call(zoom);

  const prMax = Math.max.apply(null, data.nodes.map(d => d.pagerank || 0)) || 1;
  const rScale = d3.scaleSqrt().domain([0, prMax]).range([4, 20]);

  const nodes = data.nodes.map(d => Object.assign({}, d));
  const links = data.links.map(d => Object.assign({}, d));

  const link = g.append("g").selectAll("line").data(links).join("line")
    .attr("stroke", "#c9c9d0").attr("stroke-width", 1)
    .attr("marker-end", "url(#arrow)");

  const node = g.append("g").selectAll("circle").data(nodes).join("circle")
    .attr("r", d => rScale(d.pagerank || 0))
    .attr("fill", "#0066cc").attr("stroke", "#fff")
    .attr("stroke-width", 1.2).attr("opacity", 0.9)
    .style("cursor", "pointer");

  let tip = d3.select("body").select(".graph-tooltip");
  if (tip.empty()) tip = d3.select("body").append("div").attr("class", "graph-tooltip");

  node
    .on("mouseover", (e, d) => {
      tip.style("opacity", 1).html(`
        <div class="tip-title">${esc(d.title).slice(0, 90)}</div>
        <div class="tip-meta">${esc(d.authors).slice(0, 60)}</div>
        <div class="tip-meta">${d.year || "—"} · PR ${(d.pagerank || 0).toFixed(4)} · Deg ${d.degree || 0}</div>
        <div class="tip-meta">${(d.keywords || []).slice(0, 4).join(" · ")}</div>
      `).style("left", (e.pageX + 14) + "px").style("top", (e.pageY + 14) + "px");
    })
    .on("mousemove", (e) => {
      tip.style("left", (e.pageX + 14) + "px").style("top", (e.pageY + 14) + "px");
    })
    .on("mouseout", () => tip.style("opacity", 0))
    .on("click", (e, d) => { e.stopPropagation(); selectNode(d, node, link); });

  // Gentler physics — dragging doesn't disturb the rest
  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(70).strength(0.25))
    .force("charge", d3.forceManyBody().strength(-120).distanceMax(400))
    .force("center", d3.forceCenter(W / 2, H / 2).strength(0.05))
    .force("collide", d3.forceCollide().radius(d => rScale(d.pagerank || 0) + 4))
    .alphaDecay(0.03)
    .velocityDecay(0.5)
    .on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      node.attr("cx", d => d.x).attr("cy", d => d.y);
    });

  // Drag: freeze the node in place, redraw only its edges
  node.call(d3.drag()
    .on("start", function (event, d) {
      d.fx = d.x;
      d.fy = d.y;
      d3.select(this).raise().attr("stroke", "#1d1d1f").attr("stroke-width", 2.5);
    })
    .on("drag", function (event, d) {
      d.fx = event.x;
      d.fy = event.y;
      link.filter(l => (l.source.id ?? l.source) === d.id || (l.target.id ?? l.target) === d.id)
        .attr("x1", l => l.source.x).attr("y1", l => l.source.y)
        .attr("x2", l => l.target.x).attr("y2", l => l.target.y);
      d3.select(this).attr("cx", d.x).attr("cy", d.y);
    })
    .on("end", function (event, d) {
      // Node stays frozen where dropped — double-click to release
    }));

  // Double-click releases a frozen node
  node.on("dblclick", (event, d) => {
    event.stopPropagation();
    d.fx = null;
    d.fy = null;
    sim.alpha(0.3).restart();
  });

  window._refs = { node, link, nodes, sim };

  const btnPath = _el("btnFindPath");
  const btnReset = _el("btnResetPath");
  const btnRelease = _el("btnReleaseNodes");

  if (btnPath) btnPath.onclick = () => findPath(data);
  if (btnReset) btnReset.onclick = () => resetPath(node, link);
  if (btnRelease) btnRelease.onclick = () => {
    nodes.forEach(n => { n.fx = null; n.fy = null; });
    sim.alpha(0.5).restart();
  };
}

function selectNode(d, node, link) {
  selectedNode = d;
  node.attr("stroke", n => n.id === d.id ? "#1d1d1f" : "#fff")
      .attr("stroke-width", n => n.id === d.id ? 2.5 : 1.2);

  if (!pathEndpoints.source) {
    pathEndpoints.source = d.id;
    _el("pathResult").textContent = `Source: ${d.title.slice(0, 50)} — now click target.`;
  } else if (!pathEndpoints.target && d.id !== pathEndpoints.source) {
    pathEndpoints.target = d.id;
    _el("pathResult").textContent = `Target set. Click "Find Path".`;
  }

  _el("nodeInspector").innerHTML = `
    <h3 class="insp-title">${esc(d.title)}</h3>
    <div class="insp-authors">${esc(d.authors)}</div>
    <div class="insp-grid">
      <div><span class="insp-lbl">Year</span><b>${d.year || "—"}</b></div>
      <div><span class="insp-lbl">Citations</span><b>${d.citation_count || 0}</b></div>
      <div><span class="insp-lbl">PageRank</span><b>${(d.pagerank || 0).toFixed(5)}</b></div>
      <div><span class="insp-lbl">Trend</span><b>${(d.trend || 0).toFixed(2)}</b></div>
      <div><span class="insp-lbl">Out-Degree</span><b>${d.degree || 0}</b></div>
      <div><span class="insp-lbl">Paper ID</span><b>#${d.id}</b></div>
    </div>
    <div class="insp-kws">${(d.keywords || []).slice(0, 6).map(k => `<span class="insp-kw">${esc(k)}</span>`).join("")}</div>
    <p class="insp-abstract">${esc(d.abstract || "—")}</p>
  `;
}

function findPath(data) {
  if (!pathEndpoints.source || !pathEndpoints.target) {
    _el("pathResult").textContent = "Click two nodes first (source then target).";
    return;
  }
  const adj = {};
  data.links.forEach(l => {
    (adj[l.source] = adj[l.source] || []).push(l.target);
    (adj[l.target] = adj[l.target] || []).push(l.source);
  });
  const prev = { [pathEndpoints.source]: null };
  const q = [pathEndpoints.source];
  while (q.length) {
    const u = q.shift();
    if (u === pathEndpoints.target) break;
    for (const v of adj[u] || []) if (!(v in prev)) { prev[v] = u; q.push(v); }
  }
  if (!(pathEndpoints.target in prev)) {
    _el("pathResult").textContent = "No path found within this subgraph.";
    return;
  }
  const path = [];
  let cur = pathEndpoints.target;
  while (cur !== null) { path.push(cur); cur = prev[cur]; }
  path.reverse();

  const pathSet = new Set();
  for (let i = 0; i < path.length - 1; i++) {
    pathSet.add(path[i] + "|" + path[i + 1]);
    pathSet.add(path[i + 1] + "|" + path[i]);
  }
  const { node, link } = window._refs;
  link.attr("stroke", l => {
    const k = (l.source.id ?? l.source) + "|" + (l.target.id ?? l.target);
    return pathSet.has(k) ? "#ff2d55" : "#e5e5ea";
  }).attr("stroke-width", l => {
    const k = (l.source.id ?? l.source) + "|" + (l.target.id ?? l.target);
    return pathSet.has(k) ? 3 : 1;
  }).attr("opacity", 1);
  node.attr("opacity", n => path.indexOf(n.id) >= 0 ? 1 : 0.12);

  _el("pathResult").textContent =
    `Path length: ${path.length - 1} hop${path.length - 1 !== 1 ? "s" : ""}`;
}

function resetPath(node, link) {
  pathEndpoints = { source: null, target: null };
  link.attr("stroke", "#c9c9d0").attr("stroke-width", 1).attr("opacity", 1);
  node.attr("stroke", "#fff").attr("stroke-width", 1.2).attr("opacity", 0.9);
  _el("pathResult").textContent = "";
}

function updateStats(data) {
  const n = data.nodes.length, e = data.links.length;
  _el("graphStats").innerHTML = `
    <div><span>Nodes</span><b>${n}</b></div>
    <div><span>Edges</span><b>${e}</b></div>
    <div><span>Density</span><b>${(n > 1 ? e / (n * (n - 1)) : 0).toFixed(5)}</b></div>
    <div><span>Matching</span><b>${data.matching_count ?? n}</b></div>
    <div><span>Corpus</span><b>${data.total_in_corpus ?? "—"}</b></div>`;
}

/* =========================================================
   METRICS
   ========================================================= */
async function loadMetrics(query) {
  query = query !== undefined ? query : (window._activeQuery || "");
  try {
    const url = "/api/metrics" + (query ? `?query=${encodeURIComponent(query)}` : "");
    const res = await fetch(url);
    const d = await res.json();
    _el("metricsGrid").innerHTML = `
      <div class="metric-card"><div class="metric-big">${d.nodes}</div><div class="metric-lbl">Papers</div></div>
      <div class="metric-card"><div class="metric-big">${d.edges}</div><div class="metric-lbl">Edges</div></div>
      <div class="metric-card"><div class="metric-big">${d.density}</div><div class="metric-lbl">Density</div></div>
      <div class="metric-card"><div class="metric-big">${d.avg_out_degree}</div><div class="metric-lbl">Avg Degree</div></div>`;
    drawHist("degreeHistogram", d.degree_distribution || [], "degree", "count", "#0066cc");
    drawHist("prHistogram", (d.pagerank_histogram || []).map((v, i) => ({ x: i, y: v })), "x", "y", "#30b0c7");
  } catch (e) { console.error(e); }
}
window.loadMetrics = loadMetrics;

function drawHist(id, data, xKey, yKey, color) {
  const el = _el(id);
  if (!el) return;
  el.innerHTML = "";
  if (!data.length) { el.innerHTML = `<div class="empty"><p class="empty-sub">No data for this scope</p></div>`; return; }
  const W = el.clientWidth || 320, H = 180;
  const P = { t: 10, r: 10, b: 26, l: 34 };
  const svg = d3.select(el).append("svg").attr("viewBox", [0, 0, W, H]);
  const x = d3.scaleBand().domain(data.map(d => d[xKey])).range([P.l, W - P.r]).padding(0.15);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d[yKey])]).nice().range([H - P.b, P.t]);
  svg.append("g").attr("transform", `translate(0,${H - P.b})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((_, i) => i % 2 === 0))).attr("font-size", 9);
  svg.append("g").attr("transform", `translate(${P.l},0)`)
    .call(d3.axisLeft(y).ticks(4)).attr("font-size", 9);
  svg.selectAll("rect").data(data).join("rect")
    .attr("x", d => x(d[xKey])).attr("width", x.bandwidth())
    .attr("y", d => y(d[yKey])).attr("height", d => H - P.b - y(d[yKey]))
    .attr("fill", color).attr("rx", 2);
}

/* =========================================================
   TRENDS
   ========================================================= */
async function loadTrends(query) {
  query = query !== undefined ? query : (window._activeQuery || "");
  try {
    const url = "/api/trends" + (query ? `?query=${encodeURIComponent(query)}` : "");
    const res = await fetch(url);
    const d = await res.json();
    const el = _el("trendChart");
    if (!el) return;
    el.innerHTML = "";
    if (!d.timeline.length) {
      el.innerHTML = `<div class="empty"><p class="empty-sub">No timeline for this scope</p></div>`;
      return;
    }
    const W = el.clientWidth || 640, H = 240;
    const P = { t: 20, r: 20, b: 30, l: 44 };
    const svg = d3.select(el).append("svg").attr("viewBox", [0, 0, W, H]);
    const x = d3.scaleLinear().domain(d3.extent(d.timeline, t => t.year)).range([P.l, W - P.r]);
    const y = d3.scaleLinear().domain([0, d3.max(d.timeline, t => t.total_citations)]).nice().range([H - P.b, P.t]);
    svg.append("g").attr("transform", `translate(0,${H - P.b})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d"))).attr("font-size", 10);
    svg.append("g").attr("transform", `translate(${P.l},0)`)
      .call(d3.axisLeft(y).ticks(5)).attr("font-size", 10);
    const area = d3.area().x(t => x(t.year)).y0(H - P.b).y1(t => y(t.total_citations)).curve(d3.curveMonotoneX);
    svg.append("path").datum(d.timeline).attr("fill", "rgba(0,102,204,0.10)").attr("d", area);
    const line = d3.line().x(t => x(t.year)).y(t => y(t.total_citations)).curve(d3.curveMonotoneX);
    svg.append("path").datum(d.timeline).attr("fill", "none").attr("stroke", "#0066cc")
      .attr("stroke-width", 2).attr("d", line);
    svg.selectAll("circle").data(d.timeline).join("circle")
      .attr("cx", t => x(t.year)).attr("cy", t => y(t.total_citations))
      .attr("r", 3).attr("fill", "#0066cc");
  } catch (e) { console.error(e); }
}
window.loadTrends = loadTrends;

/* =========================================================
   INIT
   ========================================================= */
async function initGraphTab() {
  if (typeof d3 === "undefined") return;
  if (!window._graphData) {
    await loadGraph(200, window._activeQuery || "");
  }
  if (!window._metricsLoaded) { window._metricsLoaded = true; loadMetrics(window._activeQuery || ""); }
  if (!window._trendsLoaded) { window._trendsLoaded = true; loadTrends(window._activeQuery || ""); }
}
window.initGraphTab = initGraphTab;

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}