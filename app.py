"""
AlgoScholar — Research Paper Recommender
Modules:
  M2: Aho-Corasick, Suffix Array + Kasai LCP
  M3: Smith-Waterman, Wagner-Fischer
  M4: Dinic's, Min-Cut, Hopcroft-Karp
  M5: Vertex Cover 2-approx, Greedy Set Cover
  M6: Reservoir Sampling, Blelloch Scan
Base: BM25 + PageRank + RRF
"""
import os, glob, csv, math, random, re
from collections import deque, defaultdict, Counter
from flask import Flask, render_template, request, jsonify

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__,
            template_folder=os.path.join(BASE_DIR, "templates"),
            static_folder=os.path.join(BASE_DIR, "static"))
DATA_DIR = os.path.join(BASE_DIR, "data")


# =========================================================
# DATA
# =========================================================
def load_papers():
    files = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))
    if not files:
        raise RuntimeError("Put papers.csv into data/")
    path = files[0]
    out = []
    with open(path, "r", encoding="utf-8", newline="") as f:
        for i, row in enumerate(csv.DictReader(f)):
            def pick(*keys):
                for k in keys:
                    for rk in row:
                        if rk.lower().replace("_", "").strip() == k.lower().replace("_", ""):
                            return row[rk]
                return None
            pid = pick("paperid", "id", "docid") or i + 1
            try: pid = int(pid)
            except: pid = i + 1
            kw = (pick("keywords") or "").replace(";", ",")
            keywords = [k.strip().lower() for k in kw.split(",") if k.strip()]
            year = pick("year")
            try: year = int(year) if year else None
            except: year = None
            cc = pick("citationcount", "citationscount")
            try: cc = int(cc) if cc else 0
            except: cc = 0
            out.append({
                "id": pid,
                "title": (pick("title") or "Untitled").strip(),
                "authors": (pick("authors") or "Unknown").strip(),
                "abstract": (pick("abstract") or "").strip(),
                "keywords": keywords,
                "year": year,
                "venue": (pick("venue") or "").strip(),
                "citation_count": cc,
            })
    print(f"[data] {len(out)} papers from {os.path.basename(path)}", flush=True)
    return out


PAPERS = load_papers()
BY_ID = {p["id"]: p for p in PAPERS}


# =========================================================
# BM25 with prefix fallback
# =========================================================
TOKEN_RE = re.compile(r"[a-z0-9]+")
STOP = set("a an the and or but if of to in on for with by at from as is are was were be been being this that these those it its we our you your they their he she his her i me my us them will would can could should may might must do does did have has had not no so than then there here when where why how what which who whom all any each few more most other some such only own same too very just also into over under about between through during before after above below".split())

def tokenize(t, rm_stop=True):
    toks = TOKEN_RE.findall((t or "").lower())
    return [x for x in toks if (not rm_stop or (x not in STOP and len(x) > 1))]


class BM25:
    def __init__(self, docs, k1=1.5, b=0.75):
        self.k1, self.b = k1, b
        self.doc_len, self.tf, self.df, self.N = {}, {}, Counter(), 0
        self.ids = []
        for did, text in docs:
            toks = tokenize(text)
            self.ids.append(did)
            self.doc_len[did] = len(toks)
            for term, f in Counter(toks).items():
                self.tf.setdefault(term, {})[did] = f
                self.df[term] += 1
            self.N += 1
        self.avgdl = sum(self.doc_len.values()) / max(1, self.N)

    def _idf(self, t):
        df = self.df.get(t, 0)
        return 0.0 if df == 0 else math.log(1 + (self.N - df + 0.5) / (df + 0.5))

    def search(self, q, k=500):
        """BM25 with prefix fallback — 'learn' matches 'learning', 'learner', etc."""
        scores = {}
        for term in tokenize(q):
            matched_terms = [term] if term in self.tf else []
            if not matched_terms and len(term) >= 3:
                prefix_hits = [t for t in self.tf
                               if t.startswith(term) and len(t) <= len(term) + 6]
                matched_terms = prefix_hits[:25]

            for t in matched_terms:
                if t not in self.tf: continue
                idf = self._idf(t)
                for did, f in self.tf[t].items():
                    dl = self.doc_len[did]
                    scores[did] = scores.get(did, 0) + idf * (f * (self.k1 + 1)) / (
                        f + self.k1 * (1 - self.b + self.b * dl / self.avgdl))
        return sorted(scores.items(), key=lambda x: -x[1])[:k]


BM25_IDX = BM25([(p["id"], f"{p['title']} {p['title']} {' '.join(p['keywords'])} {p['abstract']}") for p in PAPERS])


# =========================================================
# Aho-Corasick
# =========================================================
class AhoCorasick:
    def __init__(self):
        self.goto = [{}]; self.fail = [0]; self.out = [set()]

    def add(self, word, tag):
        n = 0
        for ch in word:
            if ch not in self.goto[n]:
                self.goto[n][ch] = len(self.goto)
                self.goto.append({}); self.fail.append(0); self.out.append(set())
            n = self.goto[n][ch]
        self.out[n].add(tag)

    def build(self):
        q = deque()
        for _, nxt in self.goto[0].items():
            q.append(nxt)
        while q:
            v = q.popleft()
            for ch, u in self.goto[v].items():
                f = self.fail[v]
                while f and ch not in self.goto[f]:
                    f = self.fail[f]
                self.fail[u] = self.goto[f].get(ch, 0)
                self.out[u] |= self.out[self.fail[u]]
                q.append(u)

    def search(self, text):
        n = 0
        for i, ch in enumerate(text):
            while n and ch not in self.goto[n]:
                n = self.fail[n]
            n = self.goto[n].get(ch, 0)
            for tag in self.out[n]:
                yield i, tag


def suffix_array(s):
    n = len(s)
    if n == 0: return []
    k, rank, tmp = 1, list(map(ord, s)), [0] * n
    sa = list(range(n))
    while True:
        sa.sort(key=lambda x: (rank[x], rank[x + k] if x + k < n else -1))
        tmp[sa[0]] = 0
        for i in range(1, n):
            a, b = sa[i - 1], sa[i]
            tmp[b] = tmp[a] + ((rank[a], rank[a + k] if a + k < n else -1) !=
                              (rank[b], rank[b + k] if b + k < n else -1))
        rank, tmp = tmp, rank
        if rank[sa[-1]] == n - 1: break
        k <<= 1
    return sa


def kasai_lcp(s, sa):
    n = len(s)
    if n == 0: return []
    rank = [0] * n
    for i, p in enumerate(sa): rank[p] = i
    lcp, h = [0] * (n - 1), 0
    for i in range(n):
        if rank[i] > 0:
            j = sa[rank[i] - 1]
            while i + h < n and j + h < n and s[i + h] == s[j + h]:
                h += 1
            lcp[rank[i] - 1] = h
            if h: h -= 1
    return lcp


# =========================================================
# Wagner-Fischer + Smith-Waterman
# =========================================================
def wagner_fischer(a, b):
    n, m = len(a), len(b)
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        cur = [i] + [0] * m
        for j in range(1, m + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[m]


def similarity(a, b):
    if not a and not b: return 1.0
    return 1.0 - wagner_fischer(a, b) / max(len(a), len(b), 1)


def smith_waterman(a, b, match=2, mismatch=-1, gap=-1):
    n, m = len(a), len(b)
    if n == 0 or m == 0: return 0
    prev = [0] * (m + 1)
    best = 0
    for i in range(1, n + 1):
        cur = [0] * (m + 1)
        for j in range(1, m + 1):
            s = match if a[i - 1] == b[j - 1] else mismatch
            cur[j] = max(0, prev[j - 1] + s, prev[j] + gap, cur[j - 1] + gap)
            if cur[j] > best: best = cur[j]
        prev = cur
    return best


# =========================================================
# Dinic, Min-Cut, Hopcroft-Karp
# =========================================================
class Dinic:
    def __init__(self, n):
        self.n = n
        self.g = [[] for _ in range(n)]

    def add_edge(self, u, v, cap):
        self.g[u].append([v, cap, len(self.g[v])])
        self.g[v].append([u, 0, len(self.g[u]) - 1])

    def _bfs(self, s, t):
        self.level = [-1] * self.n
        self.level[s] = 0
        q = deque([s])
        while q:
            u = q.popleft()
            for v, cap, _ in self.g[u]:
                if cap > 0 and self.level[v] < 0:
                    self.level[v] = self.level[u] + 1
                    q.append(v)
        return self.level[t] >= 0

    def _dfs(self, u, t, pushed):
        if u == t: return pushed
        while self.it[u] < len(self.g[u]):
            e = self.g[u][self.it[u]]
            v, cap, rev = e
            if cap > 0 and self.level[v] == self.level[u] + 1:
                d = self._dfs(v, t, min(pushed, cap))
                if d > 0:
                    e[1] -= d
                    self.g[v][rev][1] += d
                    return d
            self.it[u] += 1
        return 0

    def max_flow(self, s, t):
        flow = 0
        while self._bfs(s, t):
            self.it = [0] * self.n
            while True:
                pushed = self._dfs(s, t, float("inf"))
                if not pushed: break
                flow += pushed
        return flow

    def min_cut(self, s, t):
        self.max_flow(s, t)
        seen, stack = {s}, [s]
        while stack:
            u = stack.pop()
            for v, cap, _ in self.g[u]:
                if cap > 0 and v not in seen:
                    seen.add(v); stack.append(v)
        return seen, set(range(self.n)) - seen


def hopcroft_karp(left, right, adj):
    INF = float("inf")
    pair_l = {u: None for u in left}
    pair_r = {v: None for v in right}
    dist = {}

    def bfs():
        q = deque()
        for u in left:
            if pair_l[u] is None: dist[u] = 0; q.append(u)
            else: dist[u] = INF
        found = False
        while q:
            u = q.popleft()
            for v in adj.get(u, []):
                pu = pair_r[v]
                if pu is None: found = True
                elif dist[pu] == INF:
                    dist[pu] = dist[u] + 1
                    q.append(pu)
        return found

    def dfs(u):
        for v in adj.get(u, []):
            pu = pair_r[v]
            if pu is None or (dist[pu] == dist[u] + 1 and dfs(pu)):
                pair_l[u] = v; pair_r[v] = u
                return True
        dist[u] = INF
        return False

    matching = 0
    while bfs():
        for u in left:
            if pair_l[u] is None and dfs(u):
                matching += 1
    return matching


# =========================================================
# Vertex Cover + Greedy Set Cover
# =========================================================
def vertex_cover_2approx(edges):
    matched, cover = set(), set()
    for u, v in edges:
        if u not in matched and v not in matched:
            matched.add(u); matched.add(v)
            cover.add(u); cover.add(v)
    return cover


def greedy_set_cover(universe, sets):
    uncovered = set(universe)
    chosen = []
    while uncovered:
        best, gain = None, set()
        for s in sets:
            g = uncovered & s
            if len(g) > len(gain):
                best, gain = s, g
        if not gain: break
        chosen.append(best)
        uncovered -= gain
    return chosen


# =========================================================
# Reservoir + Blelloch
# =========================================================
class Reservoir:
    def __init__(self, k): self.k, self.buf, self.n = k, [], 0
    def add(self, x):
        self.n += 1
        if len(self.buf) < self.k: self.buf.append(x)
        else:
            j = random.randint(0, self.n - 1)
            if j < self.k: self.buf[j] = x


def blelloch_scan(arr, op=lambda a, b: a + b, identity=0):
    n = len(arr)
    if n == 0: return []
    size = 1
    while size < n: size <<= 1
    a = list(arr) + [identity] * (size - n)
    step = 1
    while step < size:
        for i in range(0, size, step * 2):
            a[i + step * 2 - 1] = op(a[i + step - 1], a[i + step * 2 - 1])
        step *= 2
    a[size - 1] = identity
    step = size // 2
    while step >= 1:
        for i in range(0, size, step * 2):
            left = a[i + step - 1]
            a[i + step - 1] = a[i + step * 2 - 1]
            a[i + step * 2 - 1] = op(left, a[i + step * 2 - 1])
        step //= 2
    for i in range(1, n):
        a[i] = op(a[i - 1], arr[i])
    return a[:n]


# =========================================================
# Citation Graph + PageRank
# =========================================================
def build_graph(papers):
    idx = defaultdict(list)
    for p in papers:
        y = p.get("year") or 0
        for kw in p["keywords"]:
            idx[kw].append((p["id"], y))
    g = {p["id"]: set() for p in papers}
    for kw, entries in idx.items():
        entries.sort(key=lambda x: -x[1])
        n = len(entries)
        for i in range(n):
            pid_i, yi = entries[i]
            for j in range(i + 1, min(i + 4, n)):
                pid_j, yj = entries[j]
                if yi == 0 or yj == 0 or yi >= yj:
                    g[pid_i].add(pid_j)
    return {k: list(v) for k, v in g.items()}


def pagerank(g, damp=0.85, iters=30):
    nodes = list(g.keys())
    n = len(nodes)
    if n == 0: return {}
    pr = {v: 1.0 / n for v in nodes}
    deg = {v: max(1, len(g.get(v, []))) for v in nodes}
    for _ in range(iters):
        new = {v: (1 - damp) / n for v in nodes}
        for u in nodes:
            share = damp * pr[u] / deg[u]
            for v in g.get(u, []):
                new[v] = new.get(v, 0) + share
        pr = new
    return pr


GRAPH = build_graph(PAPERS)
PAGERANK = pagerank(GRAPH)
print(f"[graph] {len(GRAPH)} nodes, {sum(len(v) for v in GRAPH.values())} edges", flush=True)


def trend_score(papers):
    cy = max((p.get("year") or 0) for p in papers) or 2026
    out = {}
    for p in papers:
        y = p.get("year") or cy
        age = max(1, cy - y + 1)
        c = p.get("citation_count") or 0
        out[p["id"]] = (c / age) / (1 + age / 5)
    return out


TREND = trend_score(PAPERS)


def subgraph_for_query(q, top_n=200):
    q = (q or "").strip().lower()
    if q:
        hits = BM25_IDX.search(q, k=500)
        matching = {pid for pid, _ in hits if pid in GRAPH}
    else:
        matching = set(GRAPH.keys())

    if len(matching) > top_n:
        ranked = sorted(matching, key=lambda p: -PAGERANK.get(p, 0))
        keep = set(ranked[:top_n])
    else:
        keep = matching

    nodes = [{
        "id": pid,
        "title": BY_ID[pid]["title"],
        "authors": BY_ID[pid]["authors"],
        "year": BY_ID[pid].get("year"),
        "keywords": BY_ID[pid]["keywords"],
        "abstract": BY_ID[pid]["abstract"][:300],
        "pagerank": round(PAGERANK.get(pid, 0), 6),
        "trend": round(TREND.get(pid, 0), 4),
        "degree": len(GRAPH.get(pid, [])),
        "citation_count": BY_ID[pid].get("citation_count") or 0,
    } for pid in keep]

    links = [{"source": u, "target": v}
             for u in keep for v in GRAPH.get(u, []) if v in keep]

    return {
        "nodes": nodes,
        "links": links,
        "query": q or None,
        "total_in_corpus": len(PAPERS),
        "matching_count": len(matching),
        "shown": len(nodes),
    }


# =========================================================
# ROUTES
# =========================================================
@app.route("/")
def index():
    return render_template("index.html", total=len(PAPERS))


@app.route("/api/recommend", methods=["POST"])
def api_recommend():
    q = (request.get_json(force=True).get("query") or "").strip().lower()
    if not q:
        return jsonify({"results": [], "count": 0, "query": ""})

    hits = BM25_IDX.search(q, k=500)
    if not hits:
        return jsonify({"results": [], "count": 0, "query": q})

    cands = [pid for pid, _ in hits]
    bm25_rank = {pid: i + 1 for i, (pid, _) in enumerate(hits)}

    # Aho-Corasick over query tokens
    ac = AhoCorasick()
    for t in tokenize(q):
        ac.add(t, t)
    ac.build()
    ac_hits = set()
    for pid in cands:
        p = BY_ID[pid]
        text = (p["title"] + " " + p["abstract"]).lower()
        for _, _tag in ac.search(text):
            ac_hits.add(pid)
            break

    # Smith-Waterman fuzzy
    sw_scores = {}
    for pid in cands:
        p = BY_ID[pid]
        sw_scores[pid] = smith_waterman(q, (p["title"] + " " + p["abstract"][:200]).lower())
    sw_max = max(sw_scores.values()) or 1
    sw_norm = {pid: sw_scores[pid] / sw_max for pid in sw_scores}

    pr_max = max((PAGERANK.get(pid, 0) for pid in cands), default=1) or 1
    graph_score = {pid: PAGERANK.get(pid, 0) / pr_max for pid in cands}

    trend_max = max((TREND.get(pid, 0) for pid in cands), default=1) or 1
    trend_norm = {pid: TREND.get(pid, 0) / trend_max for pid in cands}

    values = [round(1.0 / bm25_rank[pid] + sw_norm.get(pid, 0), 6) for pid in cands]
    scan = blelloch_scan(values)
    scan_norm = scan[-1] if scan else 1
    blelloch_boost = {cands[i]: (scan[i] / scan_norm if scan_norm else 0) for i in range(len(cands))}

    final = {}
    for pid in cands:
        final[pid] = (
            0.45 * (1.0 / bm25_rank[pid]) +
            0.20 * sw_norm.get(pid, 0) +
            0.20 * graph_score.get(pid, 0) +
            0.10 * trend_norm.get(pid, 0) +
            0.05 * blelloch_boost.get(pid, 0)
        )

    ordered = sorted(final.items(), key=lambda x: -x[1])

    results = []
    for rank, (pid, score) in enumerate(ordered, 1):
        p = BY_ID[pid]
        results.append({
            "paper": p,
            "score": round(score, 4),
            "rank": rank,
            "reasons": [
                f"BM25 #{bm25_rank[pid]}",
                f"SW {sw_scores.get(pid, 0)}",
                f"PR {graph_score.get(pid, 0):.3f}",
                f"Trend {trend_norm.get(pid, 0):.2f}",
            ],
        })

    return jsonify({"results": results, "count": len(results), "query": q})


@app.route("/api/graph")
def api_graph():
    q = request.args.get("query", "")
    top_n = int(request.args.get("n", 200))
    return jsonify(subgraph_for_query(q, top_n))


@app.route("/api/metrics")
def api_metrics():
    q = request.args.get("query", "").strip().lower()
    sub = subgraph_for_query(q, top_n=500)
    nodes = sub["nodes"]
    links = sub["links"]
    n = len(nodes)
    e = len(links)

    if n == 0:
        return jsonify({
            "nodes": 0, "edges": 0, "density": 0, "avg_out_degree": 0,
            "degree_distribution": [], "pagerank_histogram": [],
            "query": q or None,
        })

    sub_ids = {nd["id"] for nd in nodes}
    deg = Counter(len([v for v in GRAPH.get(pid, []) if v in sub_ids]) for pid in sub_ids)
    pr_vals = [PAGERANK.get(pid, 0) for pid in sub_ids]
    mx = max(pr_vals) or 1
    bins = [0] * 10
    for v in pr_vals:
        bins[min(9, int((v / mx) * 10))] += 1

    return jsonify({
        "nodes": n,
        "edges": e,
        "density": round(e / (n * (n - 1)) if n > 1 else 0, 5),
        "avg_out_degree": round(e / n, 3) if n else 0,
        "degree_distribution": [{"degree": d, "count": c} for d, c in sorted(deg.items())[:30]],
        "pagerank_histogram": bins,
        "query": q or None,
    })


@app.route("/api/trends")
def api_trends():
    q = request.args.get("query", "").strip().lower()
    if q:
        hits = BM25_IDX.search(q, k=500)
        allowed = {pid for pid, _ in hits}
    else:
        allowed = set(BY_ID.keys())

    by_year = defaultdict(list)
    for p in PAPERS:
        if p["id"] in allowed and p.get("year"):
            by_year[p["year"]].append(p)

    timeline = []
    for y in sorted(by_year):
        pp = by_year[y]
        tot = sum((x.get("citation_count") or 0) for x in pp)
        timeline.append({"year": y, "papers": len(pp), "total_citations": tot})

    return jsonify({"timeline": timeline, "query": q or None})


@app.route("/api/papers")
def api_papers():
    return jsonify(PAPERS)


@app.route("/api/keywords/top")
def api_keywords_top():
    """Return the most frequent keywords from the actual dataset."""
    n = int(request.args.get("n", 12))
    counter = Counter()
    for p in PAPERS:
        for kw in p["keywords"]:
            counter[kw] += 1
    return jsonify([
        {"keyword": kw, "count": c}
        for kw, c in counter.most_common(n)
    ])


# =========================================================
# ALGORITHM LAB
# =========================================================
@app.route("/api/lab/<algo>", methods=["POST"])
def api_lab(algo):
    b = request.get_json(force=True) or {}

    if algo == "aho-corasick":
        text = b.get("text", "") or ""
        kws = [k.strip().lower() for k in (b.get("keywords", "") or "").split(",") if k.strip()]
        ac = AhoCorasick()
        for k in kws: ac.add(k, k)
        ac.build()
        hits = [{"pos": pos, "keyword": tag} for pos, tag in ac.search(text.lower())]
        return jsonify({"matches": hits[:100], "total": len(hits), "keywords": kws,
                        "complexity": "O(n + m + z)"})

    if algo == "suffix-array":
        text = b.get("text", "") or ""
        sa = suffix_array(text)
        lcp = kasai_lcp(text, sa) if len(text) > 1 else []
        return jsonify({"text": text, "suffix_array": sa[:100], "lcp": lcp[:100],
                        "suffixes": [text[i:] for i in sa[:20]],
                        "complexity": "SA O(n log² n) · LCP O(n)"})

    if algo == "wagner-fischer":
        a = b.get("a", "") or ""
        c = b.get("b", "") or ""
        return jsonify({"a": a, "b": c,
                        "distance": wagner_fischer(a, c),
                        "similarity": round(similarity(a, c), 4),
                        "complexity": "O(nm)"})

    if algo == "smith-waterman":
        a = b.get("a", "") or ""
        c = b.get("b", "") or ""
        match = int(b.get("match", 2))
        mis = int(b.get("mismatch", -1))
        gap = int(b.get("gap", -1))
        return jsonify({"a": a, "b": c, "match": match, "mismatch": mis, "gap": gap,
                        "score": smith_waterman(a, c, match, mis, gap),
                        "complexity": "O(nm) local alignment"})

    if algo in ("dinic", "min-cut"):
        n_nodes = int(b.get("n", 6))
        edges_raw = b.get("edges", "") or ""
        edges = []
        for line in edges_raw.split("\n"):
            line = line.strip()
            if not line: continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) == 3:
                try: edges.append((int(parts[0]), int(parts[1]), int(parts[2])))
                except: pass
        s = int(b.get("source", 0))
        t = int(b.get("sink", n_nodes - 1))

        d = Dinic(n_nodes)
        for u, v, c in edges: d.add_edge(u, v, c)

        if algo == "dinic":
            return jsonify({"nodes": n_nodes, "edges": edges, "source": s, "sink": t,
                            "max_flow": d.max_flow(s, t), "complexity": "O(V²E)"})
        else:
            S, T = d.min_cut(s, t)
            return jsonify({"nodes": n_nodes, "edges": edges, "source": s, "sink": t,
                            "S": sorted(S), "T": sorted(T),
                            "cut_size": d.max_flow(s, t),
                            "note": "max-flow = min-cut"})

    if algo == "hopcroft-karp":
        left = [x.strip() for x in (b.get("left", "") or "").split(",") if x.strip()]
        right = [x.strip() for x in (b.get("right", "") or "").split(",") if x.strip()]
        edges_raw = b.get("edges", "") or ""
        adj = {u: [] for u in left}
        edge_list = []
        for line in edges_raw.split("\n"):
            line = line.strip()
            if not line: continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) == 2 and parts[0] in adj:
                adj[parts[0]].append(parts[1])
                edge_list.append(parts)
        return jsonify({"left": left, "right": right, "edges": edge_list,
                        "matching_size": hopcroft_karp(left, right, adj),
                        "complexity": "O(E√V)"})

    if algo == "vertex-cover":
        edges_raw = b.get("edges", "") or ""
        edges = []
        for line in edges_raw.split("\n"):
            line = line.strip()
            if not line: continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) == 2:
                edges.append((parts[0], parts[1]))
        cover = vertex_cover_2approx(edges)
        valid = all(u in cover or v in cover for u, v in edges)
        return jsonify({"edges": edges, "cover": sorted(cover),
                        "cover_size": len(cover), "valid": valid,
                        "ratio_guarantee": "≤ 2 × optimal"})

    if algo == "set-cover":
        universe_raw = b.get("universe", "") or ""
        universe = [x.strip() for x in universe_raw.split(",") if x.strip()]
        sets_raw = b.get("sets", "") or ""
        sets = []
        for line in sets_raw.split("\n"):
            line = line.strip()
            if not line: continue
            sets.append(set(x.strip() for x in line.split(",") if x.strip()))
        chosen = greedy_set_cover(universe, sets)
        return jsonify({"universe": universe,
                        "sets": [sorted(s) for s in sets],
                        "chosen": [sorted(s) for s in chosen],
                        "num_chosen": len(chosen),
                        "ratio_guarantee": "O(log n)"})

    if algo == "reservoir":
        k = int(b.get("k", 5))
        n = int(b.get("stream_size", 100))
        seed = int(b.get("seed", 42))
        random.seed(seed)
        r = Reservoir(k)
        for i in range(n): r.add(i)
        return jsonify({"k": k, "stream_size": n, "seed": seed,
                        "sample": sorted(r.buf), "complexity": "O(n) single pass"})

    if algo == "blelloch":
        raw = b.get("array", "") or "3,1,4,1,5,9,2,6"
        arr = []
        for x in raw.split(","):
            x = x.strip()
            if not x: continue
            try: arr.append(int(x))
            except: pass
        if not arr: arr = [3, 1, 4, 1, 5, 9, 2, 6]
        scan = blelloch_scan(arr)
        return jsonify({"input": arr, "scan": scan,
                        "serial_verify": [sum(arr[:i + 1]) for i in range(len(arr))],
                        "complexity": "Work O(n) · Span O(log n)"})

    return jsonify({"error": "unknown algorithm"}), 404


if __name__ == "__main__":
    app.run(debug=True, port=5000)