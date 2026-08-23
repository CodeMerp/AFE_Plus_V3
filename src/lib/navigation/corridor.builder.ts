/**
 * Corridor Builder
 * Mapbox Directions → Corridor Graph
 *
 * ใช้เฉพาะ intersections จาก steps (ไม่ใช่ทุกจุดใน polyline)
 * Merge จุดที่ใกล้กัน <15m เพื่อลด node ซ้ำซ้อน
 * สร้าง edges เชื่อมตามลำดับ step พร้อม geometry ของถนนจริง
 * MT-D* Lite ตัดสินใจเส้นทาง → extractPath() map กลับไปยัง edge geometry
 */
import type {
  Coordinate,
  GraphNode,
  GraphEdge,
  SerializableGraph,
  MapboxDirectionsResponse,
} from '@/lib/navigation/types';
import { createLogger } from './logger';
import { haversine } from './gps.smooth';
import { decode } from '@mapbox/polyline';

const log = createLogger('corridor-builder');

const CORRIDOR_THRESHOLD_M = 500;
const MERGE_THRESHOLD_M = 15;
// Boundary edges longer than this are penalised (cost × 10) to discourage
// MT-D* shortcuts. Edges are still pushed to preserve graph connectivity.
const MAX_SAFE_BOUNDARY_EDGE_M = 50;

export interface CorridorBuildOptions {
  /** Responses at and after this index are target-centered rays, not voice guidance roads. */
  targetRayResponseStartIndex?: number;
}

const COMPLEX_MANEUVER_TYPES = new Set([
  'roundabout',
  'rotary',
  'roundabout turn',
  'exit roundabout',
  'exit rotary',
  'fork',
  'merge',
  'on ramp',
  'off ramp',
]);

function isComplexManeuverType(type: string | undefined): boolean {
  return COMPLEX_MANEUVER_TYPES.has((type ?? '').trim().toLowerCase());
}

// ─── Slice geometry between two intersection points ───────────────────────────
/**
 * Given the full step geometry and two intersection coordinates,
 * extract the sub-polyline between them.
 * Uses nearest-point matching with tolerance to handle coordinate precision.
 */
function sliceGeometry(
  stepGeom: Coordinate[],
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
): Coordinate[] {
  if (stepGeom.length < 2) return stepGeom;

  // Find the nearest point index for 'from' and 'to'
  let bestFromIdx = 0, bestFromDist = Infinity;
  let bestToIdx = stepGeom.length - 1, bestToDist = Infinity;

  for (let i = 0; i < stepGeom.length; i++) {
    const dFrom = haversine(fromLat, fromLng, stepGeom[i].lat, stepGeom[i].lng);
    const dTo = haversine(toLat, toLng, stepGeom[i].lat, stepGeom[i].lng);
    if (dFrom < bestFromDist) { bestFromDist = dFrom; bestFromIdx = i; }
    if (dTo < bestToDist) { bestToDist = dTo; bestToIdx = i; }
  }

  // Ensure from < to (forward direction)
  if (bestFromIdx > bestToIdx) {
    [bestFromIdx, bestToIdx] = [bestToIdx, bestFromIdx];
  }

  // Extract sub-polyline (inclusive)
  const slice = stepGeom.slice(bestFromIdx, bestToIdx + 1);
  return slice.length >= 2 ? slice : [
    { lat: fromLat, lng: fromLng },
    { lat: toLat, lng: toLng },
  ];
}

// ─── Within-step slice metadata ───────────────────────────────────────────────
// Telemetry-only companion to sliceGeometry.
// The actual slice is produced by calling sliceGeometry() directly — no
// behavior divergence is possible. This function re-runs the index search
// in read-only mode to expose which indices were chosen and how far off
// the nearest geometry points are from the intersection coordinates.
interface SliceMeta {
  bestFromIdx:       number;
  bestToIdx:         number;
  bestFromDistanceM: number;  // haversine(fromCoord, stepGeom[bestFromIdx])
  bestToDistanceM:   number;  // haversine(toCoord,   stepGeom[bestToIdx])
  sliceStartIdx:     number;  // min(bestFromIdx, bestToIdx) after swap
  sliceEndIdx:       number;  // max(bestFromIdx, bestToIdx) after swap
  sliceLen:          number;  // sliceEndIdx - sliceStartIdx + 1 (raw, before fallback)
  edgeGeomSource:    'slice' | 'fallback_direct';
  // 'slice':           rawSliceLen >= 2 → real road geometry used
  // 'fallback_direct': rawSliceLen < 2  → sliceGeometry fell back to [fromCoord, toCoord]
}

function nearestGeometryPoint(
  coord: Coordinate,
  stepGeom: Coordinate[] | undefined,
): { index: number | null; distanceM: number | null } {
  if (!stepGeom || stepGeom.length === 0) return { index: null, distanceM: null };
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < stepGeom.length; i++) {
    const d = haversine(coord.lat, coord.lng, stepGeom[i].lat, stepGeom[i].lng);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return { index: bestIdx, distanceM: bestDist };
}

function sliceGeometryWithMeta(
  stepGeom: Coordinate[],
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
): { slice: Coordinate[]; meta: SliceMeta } {
  // Delegate actual slice to the canonical function — identical result guaranteed.
  const slice = sliceGeometry(stepGeom, fromLat, fromLng, toLat, toLng);

  // Re-run the index search (read-only) to capture telemetry.
  let bestFromIdx = 0, bestFromDist = Infinity;
  let bestToIdx   = stepGeom.length > 0 ? stepGeom.length - 1 : 0, bestToDist = Infinity;
  for (let i = 0; i < stepGeom.length; i++) {
    const dFrom = haversine(fromLat, fromLng, stepGeom[i].lat, stepGeom[i].lng);
    const dTo   = haversine(toLat,   toLng,   stepGeom[i].lat, stepGeom[i].lng);
    if (dFrom < bestFromDist) { bestFromDist = dFrom; bestFromIdx = i; }
    if (dTo   < bestToDist)   { bestToDist   = dTo;   bestToIdx   = i; }
  }

  let sliceStartIdx = bestFromIdx;
  let sliceEndIdx   = bestToIdx;
  if (sliceStartIdx > sliceEndIdx) [sliceStartIdx, sliceEndIdx] = [sliceEndIdx, sliceStartIdx];

  const rawSliceLen = sliceEndIdx - sliceStartIdx + 1;

  return {
    slice,
    meta: {
      bestFromIdx,
      bestToIdx,
      bestFromDistanceM: bestFromDist,
      bestToDistanceM:   bestToDist,
      sliceStartIdx,
      sliceEndIdx,
      sliceLen:       rawSliceLen,
      edgeGeomSource: rawSliceLen >= 2 ? 'slice' : 'fallback_direct',
    },
  };
}

// ─── Edge Geometry Gap Telemetry ──────────────────────────────────────────────
// Logs GRAPH_EDGE_GEOMETRY_GAP_TRACE when any gap metric exceeds 50m.
// Does NOT reject the edge or modify the graph.
function maybeLogEdgeGap(
  fromId: string,
  toId: string,
  fromNode: GraphNode | undefined,
  toNode: GraphNode | undefined,
  cost: number,
  geom: Coordinate[] | undefined,
  edgeSource: string,
  isBoundaryEdge: boolean,
  isReverseEdge: boolean,
): void {
  if (!geom || geom.length < 2 || !fromNode || !toNode) return;
  let edgeMaxInternalJumpM = 0;
  for (let i = 1; i < geom.length; i++) {
    const d = haversine(geom[i - 1].lat, geom[i - 1].lng, geom[i].lat, geom[i].lng);
    if (d > edgeMaxInternalJumpM) edgeMaxInternalJumpM = d;
  }
  const geometryFirstToFromNodeM = haversine(geom[0].lat, geom[0].lng, fromNode.lat, fromNode.lng);
  const geometryLastToToNodeM   = haversine(
    geom[geom.length - 1].lat, geom[geom.length - 1].lng, toNode.lat, toNode.lng,
  );
  if (edgeMaxInternalJumpM <= 50 && geometryFirstToFromNodeM <= 50 && geometryLastToToNodeM <= 50) return;
  log.warn({
    edgeFrom:                 fromId,
    edgeTo:                   toId,
    cost,
    geometryLen:              geom.length,
    edgeMaxInternalJumpM:     Math.round(edgeMaxInternalJumpM),
    geometryFirstToFromNodeM: Math.round(geometryFirstToFromNodeM),
    geometryLastToToNodeM:    Math.round(geometryLastToToNodeM),
    edgeSource,
    isBoundaryEdge,
    isReverseEdge,
    fromNode:                 { lat: fromNode.lat, lng: fromNode.lng },
    toNode:                   { lat: toNode.lat,   lng: toNode.lng },
    geometryFirst:            geom[0],
    geometryLast:             geom[geom.length - 1],
  }, 'GRAPH_EDGE_GEOMETRY_GAP_TRACE');
}

// ─── Densify 2-point boundary edge geometry ───────────────────────────────────
// Inserts intermediate points so every consecutive gap <= maxSegmentM.
// Both endpoints are preserved exactly. Safe at <= 200 m scale where geographic
// linear interpolation error is < 1 m.
function densifyBoundaryEdgeGeometry(
  from: Coordinate,
  to: Coordinate,
  maxSegmentM: number,
): Coordinate[] {
  const dist = haversine(from.lat, from.lng, to.lat, to.lng);
  if (dist <= maxSegmentM) return [from, to];
  const nSegments = Math.ceil(dist / maxSegmentM);
  const pts: Coordinate[] = [from];
  for (let k = 1; k < nSegments; k++) {
    const t = k / nSegments;
    pts.push({
      lat: from.lat + t * (to.lat - from.lat),
      lng: from.lng + t * (to.lng - from.lng),
    });
  }
  pts.push(to);
  return pts;
}

// ─── Connectivity Audit (read-only, does NOT mutate graph) ───────────────────
// Directed BFS from every unvisited node to find weakly-connected components.
// Because every road edge has both forward and reverse entries, directed BFS
// accurately reflects what MT-D* Lite can actually traverse.
function auditGraphConnectivity(
  nodes: Record<string, GraphNode>,
  edges: Record<string, GraphEdge[]>,
  agentNodeId: string,
  targetNodeId: string,
  longBoundaryDetectedCount: number,
  longBoundaryPenalizedCount: number,
): void {
  const nodeIds = Object.keys(nodes);
  const componentOf = new Map<string, number>();
  const componentSizes: number[] = [];

  for (const start of nodeIds) {
    if (componentOf.has(start)) continue;
    const cid = componentSizes.length;
    const queue = [start];
    componentOf.set(start, cid);
    let size = 0;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      size++;
      for (const edge of edges[cur] ?? []) {
        if (!componentOf.has(edge.to)) {
          componentOf.set(edge.to, cid);
          queue.push(edge.to);
        }
      }
    }
    componentSizes.push(size);
  }

  const agentCid  = componentOf.get(agentNodeId)  ?? -1;
  const targetCid = componentOf.get(targetNodeId) ?? -1;

  log.info({
    nodeCount:                  nodeIds.length,
    edgeCount:                  Object.values(edges).reduce((s, a) => s + a.length, 0),
    componentCount:             componentSizes.length,
    largestComponentSize:       componentSizes.length > 0 ? Math.max(...componentSizes) : 0,
    agentNodeId,
    targetNodeId,
    agentTargetReachable:       agentCid !== -1 && agentCid === targetCid,
    agentComponentSize:         agentCid  >= 0 ? componentSizes[agentCid]  : 0,
    targetComponentSize:        targetCid >= 0 ? componentSizes[targetCid] : 0,
    longBoundaryDetectedCount,
    longBoundaryPenalizedCount,
  }, 'GRAPH_CONNECTIVITY_AUDIT');
}

// ─── Build Graph ──────────────────────────────────────────────────────────────
export function buildCorridorGraph(
  responses: MapboxDirectionsResponse[],
  agentPos: Coordinate,
  targetPos: Coordinate,
  options: CorridorBuildOptions = {},
): SerializableGraph {
  // Primary route (driving, first alternative) — used for corridor check + cost/duration
  const primaryRoute = responses[0].routes[0];
  const nodes: Record<string, GraphNode> = {};
  const edges: Record<string, GraphEdge[]> = {};
  const corridorPolyline: Coordinate[] = [];

  let nodeIdCounter = 0;
  const nodeCoords: Array<{ lat: number; lng: number; id: string }> = [];

  // interToNodeId: exact intersection coord → canonical nodeId
  // shared across all routes/profiles so cross-profile merging works correctly
  const interToNodeId = new Map<string, string>();

  let longBoundaryDetectedCount  = 0;
  let longBoundaryPenalizedCount = 0;

  // ─── Process every route from every profile response ────────────────────────
  for (let responseIndex = 0; responseIndex < responses.length; responseIndex++) {
    const response = responses[responseIndex];
    const isTargetRayResponse =
      options.targetRayResponseStartIndex !== undefined &&
      responseIndex >= options.targetRayResponseStartIndex;
    for (const route of response.routes) {

      // ─── 1. Extract intersections → nodes (merge <15m) ──────────────────────
      for (const leg of route.legs) {
        for (const step of leg.steps) {
          if (!step.intersections?.length) continue;

          for (const inter of step.intersections) {
            const lat = inter.location[1];
            const lng = inter.location[0];

            let existingId: string | null = null;
            for (const nc of nodeCoords) {
              if (haversine(lat, lng, nc.lat, nc.lng) < MERGE_THRESHOLD_M) {
                existingId = nc.id;
                break;
              }
            }

            const id = existingId ?? `n${nodeIdCounter++}`;
            if (!existingId) {
              nodes[id] = { id, lat, lng };
              edges[id] = [];
              nodeCoords.push({ lat, lng, id });
              corridorPolyline.push({ lat, lng });
            }

            interToNodeId.set(`${lat.toFixed(7)},${lng.toFixed(7)}`, id);
          }
        }
      }

      // ─── 2. สร้าง edges เชื่อม consecutive intersections ภายใน step ─────────
      for (const leg of route.legs) {
        let stepIndex = 0;
        for (const step of leg.steps) {
          const inters = step.intersections;
          if (!inters?.length || inters.length < 2) { stepIndex++; continue; }

          let stepGeom: Coordinate[] | undefined;
          if (step.geometry) {
            stepGeom = decode(step.geometry, 6).map(p => ({ lat: p[0], lng: p[1] }));
          }

          const segDists: number[] = [];
          let totalSegDist = 0;
          for (let j = 0; j < inters.length - 1; j++) {
            const d = haversine(
              inters[j].location[1], inters[j].location[0],
              inters[j + 1].location[1], inters[j + 1].location[0],
            );
            segDists.push(d);
            totalSegDist += d;
          }

          let pendingManeuver = !isTargetRayResponse && step.maneuver
            ? {
                type: step.maneuver.type,
                modifier: step.maneuver.modifier,
                location: {
                  lat: step.maneuver.location[1],
                  lng: step.maneuver.location[0],
                },
                sourceStepIndex: stepIndex,
              }
            : undefined;

          for (let j = 0; j < inters.length - 1; j++) {
            const fromKey = `${inters[j].location[1].toFixed(7)},${inters[j].location[0].toFixed(7)}`;
            const toKey   = `${inters[j + 1].location[1].toFixed(7)},${inters[j + 1].location[0].toFixed(7)}`;

            const fromId = interToNodeId.get(fromKey);
            const toId   = interToNodeId.get(toKey);
            if (!fromId || !toId || fromId === toId) continue;

            const cost = totalSegDist > 0
              ? (step.distance || 100) * (segDists[j] / totalSegDist)
              : (segDists[j] || 100);

            // ── Slice geometry — result is identical to the original call; ────
            // sliceGeometryWithMeta delegates to sliceGeometry() internally.
            // sliceMeta is captured for telemetry only and does NOT affect edgeGeom.
            let edgeGeom: Coordinate[] | undefined;
            let sliceMeta: SliceMeta | null = null;
            let edgeGeomSource: 'slice' | 'fallback_direct' | 'no_step_geometry' = 'no_step_geometry';

            if (stepGeom && stepGeom.length >= 2) {
              const withMeta = sliceGeometryWithMeta(
                stepGeom,
                inters[j].location[1], inters[j].location[0],
                inters[j + 1].location[1], inters[j + 1].location[0],
              );
              edgeGeom       = withMeta.slice;
              sliceMeta      = withMeta.meta;
              edgeGeomSource = withMeta.meta.edgeGeomSource;
            }

            if (!edgeGeom || edgeGeom.length < 2) {
              const fromNode = nodes[fromId];
              const toNode   = nodes[toId];
              if (fromNode && toNode) {
                edgeGeom = [
                  { lat: fromNode.lat, lng: fromNode.lng },
                  { lat: toNode.lat,   lng: toNode.lng   },
                ];
              }
              edgeGeomSource = 'no_step_geometry';
            }

            // ── WITHIN_STEP_GEOMETRY_SOURCE_TRACE + sparse geometry marking ──
            // isSparseGeometry stays false unless Mapbox gave only 2 perfectly-matched
            // geometry points for this segment (real road, just Mapbox-undersampled).
            // Accessible outside the inner if so the edge push can stamp the edge.
            let isSparseGeometry = false;

            // ── WITHIN_STEP_GEOMETRY_SOURCE_TRACE (telemetry only) ───────────
            // Fires when the final within_step edgeGeom is suspicious:
            //   edgeGeomLen ≤ 2 : sparse geometry (Mapbox or slice collapse)
            //   edgeMaxInternalJumpM > 50 : jump inside edge geometry
            //   geometryFirstToFromNodeM > 15 : node merge endpoint mismatch
            //   geometryLastToToNodeM > 15   : node merge endpoint mismatch
            // Does NOT modify edgeGeom, cost, or graph structure.
            if (edgeGeom && edgeGeom.length >= 1) {
              let edgeMaxInternalJumpM = 0;
              for (let k = 1; k < edgeGeom.length; k++) {
                const d = haversine(
                  edgeGeom[k - 1].lat, edgeGeom[k - 1].lng,
                  edgeGeom[k].lat,     edgeGeom[k].lng,
                );
                if (d > edgeMaxInternalJumpM) edgeMaxInternalJumpM = d;
              }
              const fromNode = nodes[fromId];
              const toNode   = nodes[toId];
              const geometryFirstToFromNodeM = fromNode
                ? haversine(edgeGeom[0].lat, edgeGeom[0].lng, fromNode.lat, fromNode.lng)
                : -1;
              const geometryLastToToNodeM = toNode
                ? haversine(
                    edgeGeom[edgeGeom.length - 1].lat, edgeGeom[edgeGeom.length - 1].lng,
                    toNode.lat, toNode.lng,
                  )
                : -1;

              if (
                edgeGeom.length <= 2 ||
                edgeMaxInternalJumpM > 50 ||
                geometryFirstToFromNodeM > 15 ||
                geometryLastToToNodeM    > 15
              ) {
                const fromCoord: Coordinate = { lat: inters[j].location[1],     lng: inters[j].location[0]     };
                const toCoord: Coordinate   = { lat: inters[j + 1].location[1], lng: inters[j + 1].location[0] };
                log.warn({
                  stepIndex,
                  intersectionIndex:        j,
                  stepGeomLen:              stepGeom?.length ?? 0,
                  fromCoord,
                  toCoord,
                  fromId,
                  toId,
                  fromNodeCoord:            fromNode ? { lat: fromNode.lat, lng: fromNode.lng } : null,
                  toNodeCoord:              toNode   ? { lat: toNode.lat,   lng: toNode.lng   } : null,
                  bestFromIdx:              sliceMeta?.bestFromIdx  ?? null,
                  bestToIdx:                sliceMeta?.bestToIdx    ?? null,
                  bestFromDistanceM:        sliceMeta != null ? Math.round(sliceMeta.bestFromDistanceM) : null,
                  bestToDistanceM:          sliceMeta != null ? Math.round(sliceMeta.bestToDistanceM)   : null,
                  sliceStartIdx:            sliceMeta?.sliceStartIdx ?? null,
                  sliceEndIdx:              sliceMeta?.sliceEndIdx   ?? null,
                  sliceLen:                 sliceMeta?.sliceLen      ?? null,
                  edgeGeomSource,
                  edgeGeomLen:              edgeGeom.length,
                  edgeMaxInternalJumpM:     Math.round(edgeMaxInternalJumpM),
                  geometryFirstToFromNodeM: geometryFirstToFromNodeM >= 0 ? Math.round(geometryFirstToFromNodeM) : null,
                  geometryLastToToNodeM:    geometryLastToToNodeM   >= 0 ? Math.round(geometryLastToToNodeM)   : null,
                  cost:                     Math.round(cost),
                }, 'WITHIN_STEP_GEOMETRY_SOURCE_TRACE');

                const stepExtras = step as typeof step & {
                  driving_side?: string;
                  drivingSide?: string;
                };
                const geometryWindow =
                  stepGeom && sliceMeta
                    ? (() => {
                        // stepGeom/sliceMeta are declared with `let` above, so TS drops their
                        // null-narrowing inside this nested closure. Capture the already-narrowed
                        // values into local consts so the callback body sees non-null types.
                        const stableStepGeom = stepGeom;
                        const stableSliceMeta = sliceMeta;
                        const windowStart = Math.max(0, Math.min(stableSliceMeta.bestFromIdx, stableSliceMeta.bestToIdx) - 3);
                        const windowEnd = Math.min(stableStepGeom.length, Math.max(stableSliceMeta.bestFromIdx, stableSliceMeta.bestToIdx) + 4);
                        return stableStepGeom
                          .slice(windowStart, windowEnd)
                          .map((point, offset) => {
                            const index = windowStart + offset;
                            return {
                              index,
                              point,
                              distanceFromPrevM: index > 0
                                ? Math.round(haversine(
                                    stableStepGeom[index - 1].lat, stableStepGeom[index - 1].lng,
                                    point.lat, point.lng,
                                  ))
                                : null,
                              distanceToFromCoordM: Math.round(haversine(fromCoord.lat, fromCoord.lng, point.lat, point.lng)),
                              distanceToToCoordM:   Math.round(haversine(toCoord.lat,   toCoord.lng,   point.lat, point.lng)),
                            };
                          });
                      })()
                    : [];
                const intersectionWindow = inters
                  .slice(Math.max(0, j - 2), Math.min(inters.length, j + 4))
                  .map((inter, offset) => {
                    const index = Math.max(0, j - 2) + offset;
                    const coord: Coordinate = { lat: inter.location[1], lng: inter.location[0] };
                    const nearest = nearestGeometryPoint(coord, stepGeom);
                    return {
                      index,
                      coord,
                      distanceToBestGeometryPointM: nearest.distanceM !== null ? Math.round(nearest.distanceM) : null,
                      nearestGeometryIdx:           nearest.index,
                      nearestGeometryDistanceM:     nearest.distanceM !== null ? Math.round(nearest.distanceM) : null,
                    };
                  });

                log.warn({
                  stepIndex,
                  intersectionIndex:        j,
                  fromId,
                  toId,
                  stepGeomLen:              stepGeom?.length ?? 0,
                  stepDistance:             step.distance,
                  stepDuration:             step.duration ?? null,
                  stepName:                 step.name ?? null,
                  maneuverType:             step.maneuver?.type ?? null,
                  drivingSide:              stepExtras.driving_side ?? stepExtras.drivingSide ?? null,
                  fromIntersectionIndex:    j,
                  toIntersectionIndex:      j + 1,
                  fromCoord,
                  toCoord,
                  fromNodeCoord:            fromNode ? { lat: fromNode.lat, lng: fromNode.lng } : null,
                  toNodeCoord:              toNode   ? { lat: toNode.lat,   lng: toNode.lng   } : null,
                  bestFromIdx:              sliceMeta?.bestFromIdx  ?? null,
                  bestToIdx:                sliceMeta?.bestToIdx    ?? null,
                  bestFromDistanceM:        sliceMeta != null ? Math.round(sliceMeta.bestFromDistanceM) : null,
                  bestToDistanceM:          sliceMeta != null ? Math.round(sliceMeta.bestToDistanceM)   : null,
                  sliceStartIdx:            sliceMeta?.sliceStartIdx ?? null,
                  sliceEndIdx:              sliceMeta?.sliceEndIdx   ?? null,
                  sliceLen:                 sliceMeta?.sliceLen      ?? null,
                  edgeGeomLen:              edgeGeom.length,
                  edgeMaxInternalJumpM:     Math.round(edgeMaxInternalJumpM),
                  geometryFirstToFromNodeM: geometryFirstToFromNodeM >= 0 ? Math.round(geometryFirstToFromNodeM) : null,
                  geometryLastToToNodeM:    geometryLastToToNodeM   >= 0 ? Math.round(geometryLastToToNodeM)   : null,
                  geometryWindow,
                  intersectionWindow,
                  reason:                   'suspicious_within_step_geometry',
                }, 'STEP_INTERSECTION_GEOMETRY_TRACE');
              }

              // Detect Mapbox sparse geometry: slice matched intersection coordinates
              // exactly (bestDistanceM=0) but Mapbox returned only 2 geometry points,
              // and those 2 points are far apart.  This is real road geometry that is
              // simply undersampled — NOT a sliceGeometry collapse or fallback error.
              isSparseGeometry =
                edgeGeomSource === 'slice' &&
                edgeGeom.length <= 2 &&
                edgeMaxInternalJumpM > MAX_SAFE_BOUNDARY_EDGE_M &&
                sliceMeta !== null &&
                sliceMeta.bestFromDistanceM === 0 &&
                sliceMeta.bestToDistanceM   === 0;

              if (isSparseGeometry) {
                log.warn({
                  fromId,
                  toId,
                  edgeMaxInternalJumpM:  Math.round(edgeMaxInternalJumpM),
                  edgeGeomLen:           edgeGeom.length,
                  stepGeomLen:           stepGeom?.length ?? 0,
                  bestFromIdx:           sliceMeta!.bestFromIdx,
                  bestToIdx:             sliceMeta!.bestToIdx,
                  bestFromDistanceM:     0,
                  bestToDistanceM:       0,
                  reason:                'mapbox_sparse_step_geometry',
                }, 'WITHIN_STEP_SPARSE_GEOMETRY_MARKED');
              }
            }

            if (!edges[fromId]) edges[fromId] = [];
            let fwdEdge = edges[fromId].find((e) => e.to === toId);
            if (!fwdEdge) {
              fwdEdge = {
                from: fromId,
                to: toId,
                cost,
                geometry: edgeGeom,
                edgeSource: 'within_step',
                edgeGeomSource,
                isBoundaryEdge: false,
              };
              if (isTargetRayResponse) {
                fwdEdge.maneuverGeometryFallbackExcluded = 'target_ray';
              }
              if (isSparseGeometry) {
                fwdEdge.sparseGeometry       = true;
                fwdEdge.sparseGeometryReason = 'mapbox_sparse_step_geometry';
              }
              edges[fromId].push(fwdEdge);
              maybeLogEdgeGap(fromId, toId, nodes[fromId], nodes[toId], cost, edgeGeom, 'within_step', false, false);
            }
            if (pendingManeuver) {
              // First source wins (driving/corridor responses are processed before
              // walking alternatives); later overlapping routes cannot replace it.
              if (!fwdEdge.maneuver) fwdEdge.maneuver = pendingManeuver;
              pendingManeuver = undefined;
            }

            if (!edges[toId]) edges[toId] = [];
            if (!edges[toId].some((e) => e.to === fromId)) {
              const rev = edgeGeom ? [...edgeGeom].reverse() : undefined;
              const revEdge: GraphEdge = {
                from: toId,
                to: fromId,
                cost,
                geometry: rev,
                edgeSource: 'within_step',
                edgeGeomSource,
                isBoundaryEdge: false,
                maneuverGeometryFallbackEligible: true,
              };
              if (isTargetRayResponse) {
                revEdge.maneuverGeometryFallbackExcluded = 'target_ray';
              } else if (isComplexManeuverType(step.maneuver?.type)) {
                revEdge.maneuverGeometryFallbackExcluded = 'complex_semantic';
              }
              if (isSparseGeometry) {
                revEdge.sparseGeometry       = true;
                revEdge.sparseGeometryReason = 'mapbox_sparse_step_geometry';
              }
              edges[toId].push(revEdge);
              maybeLogEdgeGap(toId, fromId, nodes[toId], nodes[fromId], cost, rev, 'within_step', false, true);
            }
          }
          stepIndex++;
        }
      }

      // ─── 2b. Between-step boundary edges ────────────────────────────────────
      for (const leg of route.legs) {
        const steps = leg.steps;
        for (let i = 0; i < steps.length - 1; i++) {
          const curInters  = steps[i].intersections;
          const nextInters = steps[i + 1].intersections;
          if (!curInters?.length || !nextInters?.length) continue;

          const lastInter = curInters[curInters.length - 1];
          const firstNext = nextInters[0];

          const fromKey = `${lastInter.location[1].toFixed(7)},${lastInter.location[0].toFixed(7)}`;
          const toKey   = `${firstNext.location[1].toFixed(7)},${firstNext.location[0].toFixed(7)}`;

          const fromId = interToNodeId.get(fromKey);
          const toId   = interToNodeId.get(toKey);
          if (!fromId || !toId || fromId === toId) continue;

          // Boundary geometry: use exact intersection coordinates directly.
          // sliceGeometry(steps[i].geometry, ..., firstNext) is incorrect because
          // firstNext belongs to steps[i+1] — it may not exist in steps[i]'s polyline,
          // causing nearest-point mismatches and long fallback straight lines.
          // The turn point is exactly these two coordinates; a 2-point line is correct.
          const fromCoord: Coordinate = { lat: lastInter.location[1], lng: lastInter.location[0] };
          const toCoord: Coordinate   = { lat: firstNext.location[1], lng: firstNext.location[0] };
          const cost = haversine(fromCoord.lat, fromCoord.lng, toCoord.lat, toCoord.lng) || steps[i].distance || 1;

          const finalBoundaryGeom = densifyBoundaryEdgeGeometry(fromCoord, toCoord, MAX_SAFE_BOUNDARY_EDGE_M);
          const boundaryEdgeDensified = finalBoundaryGeom.length > 2;
          if (boundaryEdgeDensified) {
            log.info({
              fromId,
              toId,
              originalDistM:           Math.round(cost),
              originalGeomPointCount:  2,
              densifiedGeomPointCount: finalBoundaryGeom.length,
              maxSegmentM:             MAX_SAFE_BOUNDARY_EDGE_M,
              maxSegmentAfterM:        Math.round(cost / (finalBoundaryGeom.length - 1)),
            }, 'BOUNDARY_EDGE_DENSIFIED');
          }

          if (process.env.DEBUG_NAV && cost > 30) {
            log.warn({
              boundaryDistM: Math.round(cost), fromId, toId, fromCoord, toCoord,
            }, 'PHASE2B_BOUNDARY_LARGE');
          }

          // Penalty: long 2-point boundary edges stay in the graph (connectivity preserved)
          // but carry 10× cost so MT-D* strongly prefers within_step road geometry.
          // If this edge is the only connector, planner can still use it at high cost.
          let edgeCost = cost;
          if (cost > MAX_SAFE_BOUNDARY_EDGE_M) {
            longBoundaryDetectedCount++;
            log.warn({
              fromId,
              toId,
              cost:        Math.round(cost),
              geometryLen: 2,
              fromCoord,
              toCoord,
              reason:      'long_2pt_boundary_edge',
            }, 'BOUNDARY_EDGE_LONG_DIRECT_DETECTED');

            edgeCost = cost * 10;
            longBoundaryPenalizedCount++;
            log.warn({
              fromId,
              toId,
              originalCost:  Math.round(cost),
              penalizedCost: Math.round(edgeCost),
              geometryLen:   2,
              fromCoord,
              toCoord,
              reason:        'long_2pt_boundary_edge_penalty',
            }, 'BOUNDARY_EDGE_LONG_DIRECT_PENALIZED');
          }

          if (!edges[fromId]) edges[fromId] = [];
          if (!edges[fromId].some((e) => e.to === toId)) {
            const boundaryEdge: GraphEdge = {
              from: fromId,
              to: toId,
              cost: edgeCost,
              geometry: finalBoundaryGeom,
              edgeSource: 'boundary_edge',
              edgeGeomSource: 'boundary_connector',
              isBoundaryEdge: true,
              boundaryEdgeDensified,
            };
            if (isTargetRayResponse) {
              boundaryEdge.maneuverGeometryFallbackExcluded = 'target_ray';
            }
            edges[fromId].push(boundaryEdge);
            maybeLogEdgeGap(fromId, toId, nodes[fromId], nodes[toId], edgeCost, finalBoundaryGeom, 'boundary', true, false);
          }
          if (!edges[toId]) edges[toId] = [];
          if (!edges[toId].some((e) => e.to === fromId)) {
            const rev = finalBoundaryGeom ? [...finalBoundaryGeom].reverse() : undefined;
            const reverseBoundaryEdge: GraphEdge = {
              from: toId,
              to: fromId,
              cost: edgeCost,
              geometry: rev,
              edgeSource: 'boundary_edge',
              edgeGeomSource: 'boundary_connector',
              isBoundaryEdge: true,
              boundaryEdgeDensified,
              maneuverGeometryFallbackEligible: true,
            };
            if (isTargetRayResponse) {
              reverseBoundaryEdge.maneuverGeometryFallbackExcluded = 'target_ray';
            }
            edges[toId].push(reverseBoundaryEdge);
            maybeLogEdgeGap(toId, fromId, nodes[toId], nodes[fromId], edgeCost, rev, 'boundary', true, true);
          }
        }
      }
    }
  }

  // ─── 3. Snap agent/target เข้า graph ────────────────────────────────────────
  const agentNodeId  = snapToGraph('agent',  agentPos,  nodes, edges, nodeCoords, nodeIdCounter);
  const targetNodeId = snapToGraph('target', targetPos, nodes, edges, nodeCoords, nodeIdCounter);

  const totalEdges = Object.values(edges).reduce((s, a) => s + a.length, 0);
  log.info({
    totalResponses: responses.length,
    totalRoutes: responses.reduce((s, r) => s + r.routes.length, 0),
    totalNodes: Object.keys(nodes).length,
    totalEdges,
  }, 'CORRIDOR_GRAPH_BUILT');

  // ─── 4. Connectivity audit ───────────────────────────────────────────────────
  auditGraphConnectivity(
    nodes, edges, agentNodeId, targetNodeId,
    longBoundaryDetectedCount, longBoundaryPenalizedCount,
  );

  // ─── DEBUG: ตรวจ edge geometry ที่ผิดปกติ (เปิดด้วย DEBUG_NAV=true) ──────────
  if (process.env.DEBUG_NAV) {
    for (const edgeList of Object.values(edges)) {
      for (const edge of edgeList) {
        const fromNode = nodes[edge.from];
        const toNode   = nodes[edge.to];
        const g0       = edge.geometry?.[0];
        const gLast    = edge.geometry?.[edge.geometry.length - 1];
        const d0   = g0    && fromNode ? haversine(fromNode.lat, fromNode.lng, g0.lat, g0.lng)    : -1;
        const dEnd = gLast && toNode   ? haversine(toNode.lat,   toNode.lng,   gLast.lat, gLast.lng) : -1;
        if (!edge.geometry || d0 > 30 || dEnd > 30) {
          log.warn({
            edgeFrom: edge.from, edgeTo: edge.to,
            fromNode: fromNode ? { lat: fromNode.lat, lng: fromNode.lng } : null,
            toNode:   toNode   ? { lat: toNode.lat,   lng: toNode.lng   } : null,
            geom0: g0, geomLast: gLast,
            distFromToGeom0M:  Math.round(d0),
            distToToGeomLastM: Math.round(dEnd),
            geomLen: edge.geometry?.length ?? 0,
          }, 'GRAPH_GEOMETRY_SUSPECT');
        }
      }
    }
  }

  // ─── 4. Primary route polyline (driving first) for corridor distance check ──
  const routePolyline: Coordinate[] = primaryRoute.geometry
    ? decode(primaryRoute.geometry, 6).map(p => ({ lat: p[0], lng: p[1] }))
    : corridorPolyline;

  return {
    nodes,
    edges,
    corridorPolyline,
    routePolyline,
    totalDistance: primaryRoute.distance,
    totalDuration: primaryRoute.duration,
    createdAt: Date.now(),
  };
}

// ─── Snap Position ────────────────────────────────────────────────────────────
// For 'agent': create virtual node when dist > 50m (trimPathFromAgent clips it later).
// For 'target': never create virtual node — a straight-line edge from road → building
//   is the primary cause of the path cutting through buildings. MT-D* Lite ends at
//   the nearest road node instead; appendTargetToPath handles the last-mile (≤30m only).
function snapToGraph(
  label: string,
  pos: Coordinate,
  nodes: Record<string, GraphNode>,
  edges: Record<string, GraphEdge[]>,
  nodeCoords: Array<{ lat: number; lng: number; id: string }>,
  counter: number,
): string {
  const nearId = findNearestNode(pos, nodes);
  if (!nearId) {
    // Graph ว่าง → สร้าง node ใหม่
    const id = `${label}_n${counter}`;
    nodes[id] = { id, lat: pos.lat, lng: pos.lng };
    edges[id] = [];
    nodeCoords.push({ lat: pos.lat, lng: pos.lng, id });
    return id;
  }

  const near = nodes[nearId];
  const dist = haversine(pos.lat, pos.lng, near.lat, near.lng);
  if (dist <= 50) return nearId; // ใกล้พอ → reuse

  // Target: ห้ามสร้าง virtual node เพราะ edge จะเป็นเส้นตรงตัดผ่านตึก
  if (label === 'target') {
    log.debug({ dist: Math.round(dist), nearId }, 'target snap: reusing nearest node (no virtual node)');
    return nearId;
  }

  // Agent: สร้าง virtual node เชื่อมเข้า nearest (trimPathFromAgent จะ clip ส่วนนี้ออก)
  const vId = `${label}_n${counter}`;
  nodes[vId] = { id: vId, lat: pos.lat, lng: pos.lng };
  const geom: Coordinate[] = [
    { lat: pos.lat, lng: pos.lng },
    { lat: near.lat, lng: near.lng },
  ];
  edges[vId] = [{
    from: vId,
    to: nearId,
    cost: dist,
    geometry: geom,
    edgeSource: 'virtual_node_agent',
    edgeGeomSource: 'virtual_node_agent',
    isBoundaryEdge: false,
  }];
  maybeLogEdgeGap(vId, nearId, nodes[vId], nodes[nearId], dist, geom, 'virtual_node_agent', false, false);
  if (!edges[nearId]) edges[nearId] = [];
  edges[nearId].push({
    from: nearId,
    to: vId,
    cost: dist,
    geometry: [...geom].reverse(),
    edgeSource: 'virtual_node_agent',
    edgeGeomSource: 'virtual_node_agent',
    isBoundaryEdge: false,
  });
  maybeLogEdgeGap(nearId, vId, nodes[nearId], nodes[vId], dist, [...geom].reverse(), 'virtual_node_agent', false, true);
  nodeCoords.push({ lat: pos.lat, lng: pos.lng, id: vId });
  log.info({ vId, nearId, distM: Math.round(dist), pos }, 'VIRTUAL_NODE_CREATED');

  return vId;
}

// ─── Find Nearest Node ────────────────────────────────────────────────────────
export function findNearestNode(
  pos: Coordinate,
  nodes: Record<string, GraphNode>,
  options?: { excludeNodeId?: string },
): string | null {
  let minD = Infinity;
  let nearest: string | null = null;
  for (const [id, n] of Object.entries(nodes)) {
    if (options?.excludeNodeId === id) continue;
    const d = haversine(pos.lat, pos.lng, n.lat, n.lng);
    if (d < minD) { minD = d; nearest = id; }
  }
  return nearest;
}

// ─── Corridor Distance Check ──────────────────────────────────────────────────
export function distanceToCorridor(
  pos: Coordinate,
  poly: Coordinate[],
): number {
  let minD = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const d = pointToSegDist(pos, poly[i], poly[i + 1]);
    if (d < minD) minD = d;
  }
  if (poly.length > 0) {
    const last = poly[poly.length - 1];
    const d = haversine(pos.lat, pos.lng, last.lat, last.lng);
    if (d < minD) minD = d;
  }
  return minD;
}

export function isWithinCorridor(pos: Coordinate, poly: Coordinate[]): boolean {
  return distanceToCorridor(pos, poly) <= CORRIDOR_THRESHOLD_M;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pointToSegDist(p: Coordinate, a: Coordinate, b: Coordinate): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return haversine(p.lat, p.lng, a.lat, a.lng);

  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return haversine(p.lat, p.lng, a.lat + t * dy, a.lng + t * dx);
}
