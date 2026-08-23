/**
 * MT-D* Lite (Moving Target D* Lite)
 * Sun, Yeoh, Koenig — AAMAS 2010
 *
 * ใช้ Map ภายใน → serialize ด้วย Array.from(map.entries())
 * MAX_ITER = 10000 ป้องกัน infinite loop ใน serverless
 */
import type {
  SerializableGraph,
  GraphEdge,
  GraphNode,
  PlannerState,
  PathResult,
  HeapEntry,
  JumpClassification,
  PathJumpTrace,
} from '@/lib/navigation/types';

type Key = [number, number];

function keyLess(a: Key, b: Key): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

// ─── Min-Heap + index map (O(log n) ops) ──────────────────────────────────────
class PQ {
  private h: HeapEntry[] = [];
  private idx = new Map<string, number>();

  constructor(entries?: HeapEntry[]) {
    if (entries?.length) {
      this.h = [...entries];
      for (let i = 0; i < this.h.length; i++) this.idx.set(this.h[i].id, i);
      for (let i = Math.floor(this.h.length / 2) - 1; i >= 0; i--) this.dn(i);
    }
  }

  isEmpty(): boolean { return this.h.length === 0; }
  topKey(): Key { return this.h[0]?.key ?? [Infinity, Infinity]; }
  top(): string { return this.h[0]?.id ?? ''; }
  has(id: string): boolean { return this.idx.has(id); }
  toArray(): HeapEntry[] { return [...this.h]; }

  insert(id: string, key: Key): void {
    const i = this.h.length;
    this.h.push({ id, key });
    this.idx.set(id, i);
    this.up(i);
  }

  update(id: string, key: Key): void {
    const i = this.idx.get(id);
    if (i === undefined) return;
    this.h[i].key = key;
    this.up(i);
    this.dn(i);
  }

  remove(id: string): void {
    const i = this.idx.get(id);
    if (i === undefined) return;
    const last = this.h.length - 1;
    if (i !== last) {
      this.swap(i, last);
      this.h.pop();
      this.idx.delete(id);
      if (i < this.h.length) { this.up(i); this.dn(i); }
    } else {
      this.h.pop();
      this.idx.delete(id);
    }
  }

  private swap(i: number, j: number): void {
    [this.h[i], this.h[j]] = [this.h[j], this.h[i]];
    this.idx.set(this.h[i].id, i);
    this.idx.set(this.h[j].id, j);
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keyLess(this.h[i].key, this.h[p].key)) { this.swap(i, p); i = p; }
      else break;
    }
  }

  private dn(i: number): void {
    const n = this.h.length;
    while (true) {
      let s = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && keyLess(this.h[l].key, this.h[s].key)) s = l;
      if (r < n && keyLess(this.h[r].key, this.h[s].key)) s = r;
      if (s !== i) { this.swap(i, s); i = s; } else break;
    }
  }
}

// ─── Haversine ────────────────────────────────────────────────────────────────
function hav(a: GraphNode, b: GraphNode): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
    Math.cos((b.lat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ─── Haversine for plain lat/lng points (telemetry only) ─────────────────────
function geomDist(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) *
    Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ─── Reverse Adjacency List ───────────────────────────────────────────────────
function buildReverseEdges(graph: SerializableGraph): Record<string, string[]> {
  const rev: Record<string, string[]> = {};
  for (const nodeId of Object.keys(graph.nodes)) rev[nodeId] = [];
  for (const [from, edges] of Object.entries(graph.edges)) {
    for (const e of edges) {
      if (!rev[e.to]) rev[e.to] = [];
      rev[e.to].push(from);
    }
  }
  return rev;
}

// ─── MT-D* Lite Planner ──────────────────────────────────────────────────────
const MAX_ITER = 10_000;

export class MTDStarLitePlanner {
  private readonly graph: SerializableGraph;
  private readonly reverseEdges: Record<string, string[]>;
  private g = new Map<string, number>();
  private rhs = new Map<string, number>();
  private parent = new Map<string, string | null>();
  private OPEN = new PQ();
  private km = 0;
  private sstart = '';
  private sgoal = '';
  private iterCount = 0;

  constructor(graph: SerializableGraph) {
    this.graph = graph;
    this.reverseEdges = buildReverseEdges(graph);
  }

  // ── accessors ──
  private G(id: string): number { return this.g.get(id) ?? Infinity; }
  private RHS(id: string): number { return this.rhs.get(id) ?? Infinity; }

  private H(s: string, goal: string): number {
    const sn = this.graph.nodes[s], gn = this.graph.nodes[goal];
    if (!sn || !gn) return Infinity;
    return hav(sn, gn);
  }

  private cost(u: string, v: string): number {
    const e = (this.graph.edges[u] ?? []).find((e) => e.to === v);
    return e ? e.cost : Infinity;
  }

  private succ(u: string): string[] {
    return (this.graph.edges[u] ?? []).map((e) => e.to);
  }

  private pred(u: string): string[] {
    return this.reverseEdges[u] ?? [];
  }

  private calcKey(s: string): Key {
    const m = Math.min(this.G(s), this.RHS(s));
    return [m + this.H(s, this.sgoal) + this.km, m];
  }

  // ── Pseudocode line 03-12: Initialize ──
  initialize(startId: string, goalId: string): void {
    this.sstart = startId;
    this.sgoal = goalId;
    this.g.clear(); this.rhs.clear(); this.parent.clear();
    this.OPEN = new PQ();
    this.km = 0;
    this.iterCount = 0;

    for (const id of Object.keys(this.graph.nodes)) {
      this.g.set(id, Infinity);
      this.rhs.set(id, Infinity);
      this.parent.set(id, null);
    }
    this.rhs.set(this.sstart, 0);
    this.OPEN.insert(this.sstart, this.calcKey(this.sstart));
  }

  // ── Pseudocode line 13-19: UpdateState ──
  private updateState(u: string): void {
    const gU = this.G(u), rhsU = this.RHS(u), inO = this.OPEN.has(u);
    if (gU !== rhsU && inO) this.OPEN.update(u, this.calcKey(u));
    else if (gU !== rhsU && !inO) this.OPEN.insert(u, this.calcKey(u));
    else if (gU === rhsU && inO) this.OPEN.remove(u);
  }

  // ── Pseudocode line 20-47: ComputePath ──
  computePath(): boolean {
    let it = 0;
    while (
      !this.OPEN.isEmpty() &&
      (keyLess(this.OPEN.topKey(), this.calcKey(this.sgoal)) ||
        this.RHS(this.sgoal) !== this.G(this.sgoal))
    ) {
      if (++it > MAX_ITER) break;
      const u = this.OPEN.top();
      const kOld = this.OPEN.topKey();
      const kNew = this.calcKey(u);

      if (keyLess(kOld, kNew)) {
        this.OPEN.update(u, kNew);
      } else if (this.G(u) > this.RHS(u)) {
        // overconsistent
        this.g.set(u, this.RHS(u));
        this.OPEN.remove(u);
        for (const s of this.succ(u)) {
          if (s !== this.sstart) {
            const t = this.G(u) + this.cost(u, s);
            if (this.RHS(s) > t) {
              this.parent.set(s, u);
              this.rhs.set(s, t);
              this.updateState(s);
            }
          }
        }
      } else {
        // underconsistent
        this.g.set(u, Infinity);
        for (const s of [...this.succ(u), u]) {
          if (s !== this.sstart && this.parent.get(s) === u) {
            const preds = this.pred(s);
            if (preds.length === 0) {
              this.rhs.set(s, Infinity);
              this.parent.set(s, null);
            } else {
              const bc = Math.min(...preds.map((p) => this.G(p) + this.cost(p, s)));
              this.rhs.set(s, bc);
              this.parent.set(s, bc === Infinity ? null :
                preds.reduce((b, p) =>
                  this.G(p) + this.cost(p, s) < this.G(b) + this.cost(b, s) ? p : b));
            }
            this.updateState(s);
          }
        }
      }
    }
    this.iterCount += it;
    return this.RHS(this.sgoal) !== Infinity;
  }

  // ── Pseudocode line 48-60: OptimizedDeletion ──
  private optimizedDeletion(oldStart: string): void {
    const oldSub = this.subtree(oldStart);
    const newSub = this.subtree(this.sstart);
    const del: string[] = [];

    for (const s of oldSub) {
      if (!newSub.has(s)) {
        this.parent.set(s, null);
        this.rhs.set(s, Infinity);
        this.g.set(s, Infinity);
        del.push(s);
      }
    }
    for (const s of del) {
      for (const sp of this.pred(s)) {
        const t = this.G(sp) + this.cost(sp, s);
        if (this.RHS(s) > t) {
          this.rhs.set(s, t);
          this.parent.set(s, sp);
        }
      }
      this.updateState(s);
    }
  }

  private subtree(root: string): Set<string> {
    const vis = new Set<string>();
    const q = [root];
    while (q.length) {
      const c = q.shift()!;
      if (vis.has(c)) continue;
      vis.add(c);
      for (const s of this.succ(c)) {
        if (this.parent.get(s) === c) q.push(s);
      }
    }
    return vis;
  }

  // ── Extract path (goal → start via parent pointers) ──
  // Each edge carries road geometry from corridor builder.
  // MT-D* Lite decides WHICH edges → extractPath maps them to road geometry.
  extractPath(): Array<{ lat: number; lng: number }> {
    const detailedPath: Array<{ lat: number; lng: number }> = [];
    let cur: string | null = this.sgoal;
    const vis = new Set<string>();

    const segments: Array<{ lat: number; lng: number }[]> = [];

    // MAX_STEPS guard to prevent infinite loop from parent cycles
    const MAX_STEPS = Object.keys(this.graph.nodes).length + 10;
    let steps = 0;

    // Telemetry tracking (no behavior change)
    // prevEdgeGeomFirst: geometry[0] of the edge processed in the previous loop iteration.
    // In the forward-concatenated path each edge's last point should ≈ the next edge's first
    // point. Because we unshift (goal→start order), the junction gap to check is:
    //   haversine(current_edge.geometry.last, prevEdgeGeomFirst)
    let prevEdgeGeomFirst: { lat: number; lng: number } | null = null;
    let extractEdgeIndex = 0;
    const pathNodeIds: string[] = [];

    while (cur && cur !== this.sstart && !vis.has(cur)) {
      if (steps > MAX_STEPS) {
        console.warn('[MTDStar] Loop detected in extractPath — exceeded MAX_STEPS');
        return [];
      }
      vis.add(cur);
      steps++;
      pathNodeIds.push(cur);

      const p = this.parent.get(cur);
      if (!p) break;

      // Find the edge from p→cur to get its road geometry
      const edge = (this.graph.edges[p] ?? []).find((e) => e.to === cur);
      if (edge && edge.geometry && edge.geometry.length >= 2) {
        // Telemetry: detect internal geometry gaps and junction gaps between edges.
        // Does NOT affect extractPath output.
        const edgeFirst = edge.geometry[0];
        const edgeLast  = edge.geometry[edge.geometry.length - 1];
        let edgeMaxInternalJumpM = 0;
        for (let gi = 1; gi < edge.geometry.length; gi++) {
          const d = geomDist(edge.geometry[gi - 1], edge.geometry[gi]);
          if (d > edgeMaxInternalJumpM) edgeMaxInternalJumpM = d;
        }
        const gapFromPrevEdgeM = prevEdgeGeomFirst !== null
          ? geomDist(edgeLast, prevEdgeGeomFirst)
          : 0;
        if (edgeMaxInternalJumpM > 50 || (prevEdgeGeomFirst !== null && gapFromPrevEdgeM > 50)) {
          console.warn('[MTDStar] MTDSTAR_EXTRACT_PATH_GAP_TRACE', {
            pathNodeIds:          [...pathNodeIds],
            edgeIndex:            extractEdgeIndex,
            edgeFrom:             p,
            edgeTo:               cur,
            edgeCost:             edge.cost,
            edgeGeometryLen:      edge.geometry.length,
            edgeMaxInternalJumpM: Math.round(edgeMaxInternalJumpM),
            edgeFirst,
            edgeLast,
            prevEdgeLast:         prevEdgeGeomFirst,
            gapFromPrevEdgeM:     Math.round(gapFromPrevEdgeM),
          });
        }
        prevEdgeGeomFirst = edgeFirst;
        extractEdgeIndex++;
        // edge.geometry is ordered from p to cur (road-accurate)
        segments.unshift([...edge.geometry]);
      } else {
        // Missing or invalid edge geometry violates road-only navigation policy.
        // Return [] so the caller (update/route.ts) treats this as planner_failed → Mapbox refetch.
        // Straight-line edges are forbidden: they produce off-road routes that are
        // indistinguishable from real road geometry to the downstream path renderer.
        console.warn('[MTDStar] EXTRACTPATH_MISSING_EDGE_GEOMETRY', {
          from: p,
          to: cur,
          edgeFound: !!(this.graph.edges[p] ?? []).find((e) => e.to === cur),
        });
        return [];
      }
      cur = p;
    }

    // If path didn't reach sstart → broken
    if (cur !== this.sstart) {
      console.warn('[MTDStar] extractPath did not reach sstart — path is broken');
      return [];
    }

    // Add start node
    const sn = this.graph.nodes[this.sstart];
    if (sn) detailedPath.push({ lat: sn.lat, lng: sn.lng });

    // Concatenate segments smoothly (avoid consecutive duplicates)
    for (const seg of segments) {
      for (const pt of seg) {
        if (detailedPath.length > 0) {
          const last = detailedPath[detailedPath.length - 1];
          if (last.lat === pt.lat && last.lng === pt.lng) continue;
        }
        detailedPath.push(pt);
      }
    }

    return detailedPath;
  }

  /** Read-only companion to extractPath() exposing the exact selected edges. */
  extractPathWithEdges(): { path: Array<{ lat: number; lng: number }>; edges: GraphEdge[] } {
    const path = this.extractPath();
    if (path.length < 2) return { path, edges: [] };

    const edges: GraphEdge[] = [];
    let cur: string | null = this.sgoal;
    const visited = new Set<string>();
    const maxSteps = Object.keys(this.graph.nodes).length + 10;
    let steps = 0;

    while (cur && cur !== this.sstart && !visited.has(cur)) {
      if (steps > maxSteps) return { path, edges: [] };
      visited.add(cur);
      steps++;
      const parent = this.parent.get(cur);
      if (!parent) return { path, edges: [] };
      const edge = (this.graph.edges[parent] ?? []).find((candidate) => candidate.to === cur);
      if (!edge || !edge.geometry || edge.geometry.length < 2) return { path, edges: [] };
      edges.unshift(edge);
      cur = parent;
    }

    return cur === this.sstart ? { path, edges } : { path, edges: [] };
  }

  // ── Pseudocode line 61-92: Incremental Step ──
  step(
    newStartId: string,
    newGoalId: string,
    costChanges: Array<{ u: string; v: string; oldCost: number; newCost: number }> = [],
  ): PathResult {
    const oldStart = this.sstart;
    const oldGoal = this.sgoal;
    this.sstart = newStartId;
    this.sgoal = newGoalId;

    // km += H(goal_new, goal_old) — adjust for moving target
    if (oldGoal !== newGoalId) {
      this.km += this.H(newGoalId, oldGoal);
    }
    // OptimizedDeletion when agent moved
    if (oldStart !== newStartId) {
      this.optimizedDeletion(oldStart);
    }

    // Handle edge cost changes
    for (const { u, v, oldCost, newCost } of costChanges) {
      const es = this.graph.edges[u];
      if (es) {
        const e = es.find((e) => e.to === v);
        if (e) e.cost = newCost;
      }

      if (oldCost > newCost) {
        if (v !== this.sstart) {
          const t = this.G(u) + newCost;
          if (this.RHS(v) > t) {
            this.parent.set(v, u);
            this.rhs.set(v, t);
            this.updateState(v);
          }
        }
      } else if (v !== this.sstart && this.parent.get(v) === u) {
        const preds = this.pred(v);
        if (preds.length === 0) {
          this.rhs.set(v, Infinity);
          this.parent.set(v, null);
        } else {
          const bc = Math.min(...preds.map((p) => this.G(p) + this.cost(p, v)));
          this.rhs.set(v, bc);
          this.parent.set(v, bc === Infinity ? null :
            preds.reduce((b, p) =>
              this.G(p) + this.cost(p, v) < this.G(b) + this.cost(b, v) ? p : b));
        }
        this.updateState(v);
      }
    }

    const success = this.computePath();
    const path = success ? this.extractPath() : [];
    const { pathUsesSparseGeometry, sparseGeometryMaxJumpM, sparseGeometryEdgeCount } =
      this.scanSparseGeometry(path.length);
    const jumpTrace = this.inspectPathJumpTrace({
      pathUsesSparseGeometry,
      sparseGeometryMaxJumpM,
      sparseGeometryEdgeCount,
    });

    return {
      success,
      path,
      totalCost: this.RHS(this.sgoal),
      pathUsesSparseGeometry,
      sparseGeometryMaxJumpM,
      sparseGeometryEdgeCount,
      jumpClassification: jumpTrace.jumpClassification,
      jumpTrace,
    };
  }

  // ── Read-only sparse geometry scan ───────────────────────────────────────────
  // Walk the current parent chain (same traversal as extractPath) and report
  // which edges are flagged sparseGeometry=true.  Safe to call after computePath()
  // or step() — does NOT modify g, rhs, parent, OPEN, or km.
  scanSparseGeometry(pathLen: number): {
    pathUsesSparseGeometry: boolean;
    sparseGeometryMaxJumpM: number | null;
    sparseGeometryEdgeCount: number;
  } {
    let pathUsesSparseGeometry = false;
    let sparseGeometryMaxJumpM: number | null = null;
    let sparseGeometryEdgeCount = 0;
    if (pathLen >= 2) {
      let scanCur: string | null = this.sgoal;
      const scanVis = new Set<string>();
      const MAX_SCAN = Object.keys(this.graph.nodes).length + 10;
      let scanSteps = 0;
      while (scanCur && scanCur !== this.sstart && !scanVis.has(scanCur) && scanSteps < MAX_SCAN) {
        scanVis.add(scanCur);
        scanSteps++;
        const scanParent = this.parent.get(scanCur);
        if (!scanParent) break;
        const scanEdge = (this.graph.edges[scanParent] ?? []).find((e) => e.to === scanCur);
        if (scanEdge?.sparseGeometry) {
          pathUsesSparseGeometry = true;
          sparseGeometryEdgeCount++;
          if (scanEdge.geometry && scanEdge.geometry.length >= 2) {
            for (let gi = 1; gi < scanEdge.geometry.length; gi++) {
              const d = geomDist(scanEdge.geometry[gi - 1], scanEdge.geometry[gi]);
              if (sparseGeometryMaxJumpM === null || d > sparseGeometryMaxJumpM) {
                sparseGeometryMaxJumpM = d;
              }
            }
          }
        }
        scanCur = scanParent;
      }
    }
    return { pathUsesSparseGeometry, sparseGeometryMaxJumpM, sparseGeometryEdgeCount };
  }

  // ── Read-only jump classification scan ────────────────────────────────────────
  // Walks the same parent chain used by extractPath(), but only records telemetry.
  // Does NOT modify g/rhs/parent/OPEN/km and does NOT affect path acceptance.
  inspectPathJumpTrace(input: {
    pathUsesSparseGeometry: boolean;
    sparseGeometryMaxJumpM: number | null;
    sparseGeometryEdgeCount: number;
  }): PathJumpTrace {
    let best: PathJumpTrace = {
      maxJumpM: 0,
      jumpClassification: input.pathUsesSparseGeometry ? 'sparse_geometry' : 'unknown',
      edgeId: null,
      edgeSource: null,
      pathUsesSparseGeometry: input.pathUsesSparseGeometry,
      sparseGeometryMaxJumpM: input.sparseGeometryMaxJumpM,
      sparseGeometryEdgeCount: input.sparseGeometryEdgeCount,
      geometryPointCount: null,
      allowed: false,
    };

    let cur: string | null = this.sgoal;
    const vis = new Set<string>();
    const MAX_SCAN = Object.keys(this.graph.nodes).length + 10;
    let scanSteps = 0;
    let prevEdgeGeomFirst: { lat: number; lng: number } | null = null;

    while (cur && cur !== this.sstart && !vis.has(cur) && scanSteps < MAX_SCAN) {
      vis.add(cur);
      scanSteps++;
      const parent = this.parent.get(cur);
      if (!parent) break;

      const edge = (this.graph.edges[parent] ?? []).find((e) => e.to === cur);
      const edgeId = `${parent}->${cur}`;
      if (!edge || !edge.geometry || edge.geometry.length === 0) {
        best = pickStrongerJumpTrace(best, {
          maxJumpM: Infinity,
          jumpClassification: 'missing_geometry',
          edgeId,
          edgeSource: edge?.edgeSource ?? null,
          pathUsesSparseGeometry: input.pathUsesSparseGeometry,
          sparseGeometryMaxJumpM: input.sparseGeometryMaxJumpM,
          sparseGeometryEdgeCount: input.sparseGeometryEdgeCount,
          geometryPointCount: edge?.geometry?.length ?? 0,
          allowed: false,
        });
        break;
      }

      best = pickStrongerJumpTrace(best, classifyEdgeInternalJump(edge, edgeId, input));

      const edgeLast = edge.geometry[edge.geometry.length - 1];
      if (prevEdgeGeomFirst !== null) {
        best = pickStrongerJumpTrace(best, {
          maxJumpM: geomDist(edgeLast, prevEdgeGeomFirst),
          jumpClassification: 'junction_gap',
          edgeId,
          edgeSource: edge.edgeSource ?? edge.edgeGeomSource ?? null,
          pathUsesSparseGeometry: input.pathUsesSparseGeometry,
          sparseGeometryMaxJumpM: input.sparseGeometryMaxJumpM,
          sparseGeometryEdgeCount: input.sparseGeometryEdgeCount,
          geometryPointCount: edge.geometry.length,
          allowed: false,
        });
      }

      prevEdgeGeomFirst = edge.geometry[0];
      cur = parent;
    }

    if (best.maxJumpM === Infinity) return best;
    return { ...best, maxJumpM: Math.round(best.maxJumpM * 10) / 10 };
  }

  // ── Serialization: Map → Array.from(map.entries()) ──
  serialize(): PlannerState {
    return {
      g: Array.from(this.g.entries()),
      rhs: Array.from(this.rhs.entries()),
      parent: Array.from(this.parent.entries()),
      openHeap: this.OPEN.toArray(),
      km: this.km,
      sstart: this.sstart,
      sgoal: this.sgoal,
      iterationCount: this.iterCount,
    };
  }

  static deserialize(graph: SerializableGraph, state: PlannerState): MTDStarLitePlanner {
    const p = new MTDStarLitePlanner(graph);
    p.g = new Map(state.g);
    p.rhs = new Map(state.rhs);
    p.parent = new Map(state.parent);
    p.OPEN = new PQ(state.openHeap);
    p.km = state.km;
    p.sstart = state.sstart;
    p.sgoal = state.sgoal;
    p.iterCount = state.iterationCount;
    return p;
  }

  getStartId(): string { return this.sstart; }
  getGoalId(): string { return this.sgoal; }
  getIterationCount(): number { return this.iterCount; }
}

function classifyEdgeInternalJump(edge: GraphEdge, edgeId: string, input: {
  pathUsesSparseGeometry: boolean;
  sparseGeometryMaxJumpM: number | null;
  sparseGeometryEdgeCount: number;
}): PathJumpTrace {
  let maxJumpM = 0;
  if (edge.geometry) {
    for (let i = 1; i < edge.geometry.length; i++) {
      const d = geomDist(edge.geometry[i - 1], edge.geometry[i]);
      if (d > maxJumpM) maxJumpM = d;
    }
  }

  return {
    maxJumpM,
    jumpClassification: classifyEdge(edge, input.pathUsesSparseGeometry),
    edgeId,
    edgeSource: edge.edgeSource ?? edge.edgeGeomSource ?? null,
    pathUsesSparseGeometry: input.pathUsesSparseGeometry,
    sparseGeometryMaxJumpM: input.sparseGeometryMaxJumpM,
    sparseGeometryEdgeCount: input.sparseGeometryEdgeCount,
    geometryPointCount: edge.geometry?.length ?? null,
    allowed: false,
  };
}

function classifyEdge(edge: GraphEdge, pathUsesSparseGeometry: boolean): JumpClassification {
  if (edge.sparseGeometry || pathUsesSparseGeometry) return 'sparse_geometry';
  if (edge.isBoundaryEdge || edge.edgeSource === 'boundary_edge' || edge.edgeGeomSource === 'boundary_connector') {
    return 'boundary_edge';
  }
  if (!edge.geometry || edge.geometry.length === 0) return 'missing_geometry';
  if (edge.geometry.length === 2) return 'unknown_two_point';
  return 'unknown';
}

function pickStrongerJumpTrace(current: PathJumpTrace, candidate: PathJumpTrace): PathJumpTrace {
  if (candidate.maxJumpM === Infinity) return candidate;
  if (current.maxJumpM === Infinity) return current;
  return candidate.maxJumpM > current.maxJumpM ? candidate : current;
}
