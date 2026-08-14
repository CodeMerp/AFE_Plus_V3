import type { Coordinate, NavDistanceMode, SerializableGraph } from '@/lib/navigation/types';
import { haversine } from './gps.smooth';

export type PathValidationLogger = {
  info(input: Record<string, unknown>, message: string): void;
  warn(input: Record<string, unknown>, message: string): void;
};

export type PrepareRenderablePathInput = {
  path: unknown;
  smoothAgent: Coordinate;
  source: string;
  reason?: string;
  requireAgentNearStart?: boolean;
  routeStartAgentWarnM: number;
  routeStartAgentBlockM: number;
  log: PathValidationLogger;
};

export type PreparedRenderablePath = {
  ok: boolean;
  path: Coordinate[];
  originalPathLen: number;
  trimmedPathLen: number;
  firstPointDistanceM: number;
  reason?: string;
  blockReason?: string;
};

export type PathJumpAnalysis = {
  maxJumpM: number;
  maxJumpIndex: number;
  fromPoint: Coordinate | null;
  toPoint: Coordinate | null;
  aroundJumpPoints: Coordinate[];
  pathLen: number;
};

export function prepareRenderablePath(input: PrepareRenderablePathInput): PreparedRenderablePath {
  const requireAgentNearStart = input.requireAgentNearStart ?? true;
  const originalPath = Array.isArray(input.path) ? (input.path as Coordinate[]) : [];
  const originalPathLen = originalPath.length;

  input.log.info({
    source: input.source,
    reason: input.reason,
    originalPathLen,
    smoothAgent: input.smoothAgent,
    firstPoint: originalPath[0] ?? null,
    lastPoint: originalPathLen > 0 ? originalPath[originalPathLen - 1] : null,
  }, 'PREPARE_RENDERABLE_PATH');

  if (originalPathLen < 2) {
    const prepared = {
      ok: false,
      path: [],
      originalPathLen,
      trimmedPathLen: 0,
      firstPointDistanceM: Infinity,
      reason: input.reason,
      blockReason: 'path_too_short',
    };
    input.log.warn({
      source: input.source,
      reason: input.reason,
      originalPathLen,
      trimmedPathLen: 0,
      smoothAgent: input.smoothAgent,
      firstPoint: null,
      lastPoint: null,
    }, 'RENDERABLE_PATH_TOO_SHORT');
    logRenderablePathBlocked(prepared, input);
    return prepared;
  }

  const trimmedPath = trimPathFromAgent(originalPath, input.smoothAgent, input.log);
  const trimmedPathLen = trimmedPath.length;

  input.log.info({
    source: input.source,
    reason: input.reason,
    originalPathLen,
    trimmedPathLen,
    smoothAgent: input.smoothAgent,
    firstPoint: trimmedPath[0] ?? null,
    lastPoint: trimmedPathLen > 0 ? trimmedPath[trimmedPathLen - 1] : null,
  }, 'RENDERABLE_PATH_TRIMMED');

  if (trimmedPathLen < 2) {
    const prepared = {
      ok: false,
      path: [],
      originalPathLen,
      trimmedPathLen,
      firstPointDistanceM: Infinity,
      reason: input.reason,
      blockReason: 'trimmed_path_too_short',
    };
    input.log.warn({
      source: input.source,
      reason: input.reason,
      originalPathLen,
      trimmedPathLen,
      smoothAgent: input.smoothAgent,
      firstPoint: trimmedPath[0] ?? null,
      lastPoint: trimmedPathLen > 0 ? trimmedPath[trimmedPathLen - 1] : null,
    }, 'RENDERABLE_PATH_TOO_SHORT');
    logRenderablePathBlocked(prepared, input);
    return prepared;
  }

  const firstPointDistanceM = haversine(
    input.smoothAgent.lat, input.smoothAgent.lng,
    trimmedPath[0].lat, trimmedPath[0].lng,
  );
  const prepared = {
    ok: true,
    path: trimmedPath,
    originalPathLen,
    trimmedPathLen,
    firstPointDistanceM,
    reason: input.reason,
  };

  if (firstPointDistanceM > input.routeStartAgentWarnM) {
    input.log.warn({
      source: input.source,
      reason: input.reason,
      originalPathLen,
      trimmedPathLen,
      firstPointDistanceM: Math.round(firstPointDistanceM),
      warnThresholdM: input.routeStartAgentWarnM,
      blockThresholdM: input.routeStartAgentBlockM,
      smoothAgent: input.smoothAgent,
      firstPoint: trimmedPath[0],
      lastPoint: trimmedPath[trimmedPathLen - 1],
    }, 'RENDERABLE_PATH_FIRST_POINT_FAR');
  }

  if (requireAgentNearStart && firstPointDistanceM > input.routeStartAgentBlockM) {
    input.log.warn({
      source: input.source,
      reason: input.reason,
      blockReason: 'first_point_too_far',
      originalPathLen,
      trimmedPathLen,
      firstPointDistanceM: Math.round(firstPointDistanceM),
      smoothAgent: input.smoothAgent,
      firstPoint: trimmedPath[0],
      lastPoint: trimmedPath[trimmedPathLen - 1],
    }, 'RENDERABLE_PATH_BLOCKED');
    return {
      ...prepared,
      ok: false,
      path: [],
      blockReason: 'first_point_too_far',
    };
  }

  return prepared;
}

export function trimPathFromAgent(
  path: Coordinate[],
  agent: Coordinate,
  log?: PathValidationLogger,
): Coordinate[] {
  if (path.length < 2) return path;

  // Project in approximate meter-space to avoid latitude distortion in degree-space dot products.
  // At Thai latitudes (~16N) 1 deg lng is close but not exact.
  const cosLat = Math.cos(agent.lat * Math.PI / 180);
  const LAT_M = 111320;
  const LNG_M = LAT_M * cosLat;

  let bestSegIdx = 0;
  let bestT = 0;
  let bestDist = Infinity;

  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i].lng * LNG_M,     ay = path[i].lat * LAT_M;
    const bx = path[i + 1].lng * LNG_M, by = path[i + 1].lat * LAT_M;
    const dx = bx - ax,                  dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    const t = lenSq === 0 ? 0
      : Math.max(0, Math.min(1,
          ((agent.lng * LNG_M - ax) * dx + (agent.lat * LAT_M - ay) * dy) / lenSq,
        ));

    const projLat = path[i].lat + t * (path[i + 1].lat - path[i].lat);
    const projLng = path[i].lng + t * (path[i + 1].lng - path[i].lng);
    const dist = haversine(agent.lat, agent.lng, projLat, projLng);

    if (dist < bestDist) {
      bestDist = dist;
      bestSegIdx = i;
      bestT = t;
    }
  }

  if (bestSegIdx >= path.length - 1) return [agent];

  const a = path[bestSegIdx];
  const b = path[bestSegIdx + 1];
  const projected: Coordinate = {
    lat: a.lat + bestT * (b.lat - a.lat),
    lng: a.lng + bestT * (b.lng - a.lng),
  };

  const trimmedPath: Coordinate[] = [projected, path[bestSegIdx + 1], ...path.slice(bestSegIdx + 2)];
  log?.info({
    bestSegIdx,
    bestT:          Math.round(bestT * 1000) / 1000,
    bestDistanceM:  Math.round(bestDist),
    agentPos:       agent,
    originalLen:    path.length,
    trimmedLen:     trimmedPath.length,
    oldFirstPoint:  path[0],
    newFirstPoint:  trimmedPath[0],
    oldLastPoint:   path[path.length - 1],
    newLastPoint:   trimmedPath[trimmedPath.length - 1],
  }, 'TRIM_PROGRESS_DEBUG');
  return trimmedPath;
}

/**
 * Trims the END of a path to the road attachment projected point p.
 * Mirrors trimPathFromAgent() which trims the FRONT.
 *
 * Finds the nearest segment in the path to projectedPoint and returns
 * path[0..bestSegIdx] + p. This replaces the tail (tId node) with the
 * actual edge projection point, so the route ends at p instead of n2.
 *
 * Falls back to original path when:
 * - path.length < 2
 * - projection point is beyond the last segment (path already ends close to p)
 * - trimmed result would be < 2 points
 * - projection is too far from any segment (> 50m — projection is stale/mismatch)
 */
export function trimPathTailToProjection(
  path: Coordinate[],
  projectedPoint: Coordinate,
  log?: PathValidationLogger,
): Coordinate[] {
  if (path.length < 2) return path;

  const cosLat = Math.cos(projectedPoint.lat * Math.PI / 180);
  const LAT_M = 111320;
  const LNG_M = LAT_M * cosLat;

  let bestSegIdx = path.length - 2;
  let bestT = 1;
  let bestDist = Infinity;

  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i].lng * LNG_M,     ay = path[i].lat * LAT_M;
    const bx = path[i + 1].lng * LNG_M, by = path[i + 1].lat * LAT_M;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    const t = lenSq === 0 ? 0
      : Math.max(0, Math.min(1,
          ((projectedPoint.lng * LNG_M - ax) * dx + (projectedPoint.lat * LAT_M - ay) * dy) / lenSq,
        ));

    const projLat = path[i].lat + t * (path[i + 1].lat - path[i].lat);
    const projLng = path[i].lng + t * (path[i + 1].lng - path[i].lng);
    const dist = haversine(projectedPoint.lat, projectedPoint.lng, projLat, projLng);

    if (dist < bestDist) {
      bestDist = dist;
      bestSegIdx = i;
      bestT = t;
    }
  }

  // Projection too far from any path segment — stale or mismatched; don't trim
  if (bestDist > 50) {
    log?.warn({
      bestDist: Math.round(bestDist),
      bestSegIdx,
      projectedPoint,
      pathLen: path.length,
      reason: 'projection_too_far_from_path',
    }, 'TAIL_TRIM_PROJECTION_SKIPPED');
    return path;
  }

  // If projection is at segment end of last segment, path is already shorter than or at p
  if (bestT >= 1 && bestSegIdx >= path.length - 2) return path;

  const p: Coordinate = {
    lat: path[bestSegIdx].lat + bestT * (path[bestSegIdx + 1].lat - path[bestSegIdx].lat),
    lng: path[bestSegIdx].lng + bestT * (path[bestSegIdx + 1].lng - path[bestSegIdx].lng),
  };

  const trimmedPath = [...path.slice(0, bestSegIdx + 1), p];

  if (trimmedPath.length < 2) return path;

  log?.info({
    bestSegIdx,
    bestT:         Math.round(bestT * 1000) / 1000,
    bestDistM:     Math.round(bestDist),
    projectedPoint,
    originalLen:   path.length,
    trimmedLen:    trimmedPath.length,
    oldLastPoint:  path[path.length - 1],
    newLastPoint:  p,
  }, 'TAIL_TRIM_PROGRESS_DEBUG');

  return trimmedPath;
}

/**
 * Extends the END of a path to the road attachment projected point p,
 * using actual edge geometry from edgeFrom → edgeTo.
 *
 * Used when target projection p is closer to edgeFrom and the planner
 * routed to edgeFrom. Extends the path from edgeFrom forward along the
 * edge geometry to reach p.
 *
 * Falls back to original path when:
 * - edge edgeFrom → edgeTo not found in graph
 * - edge has no geometry (< 2 points)
 * - projection of p onto edge geometry is too far (> 50m)
 * - result would be < 2 points
 */
export function extendPathToProjection(
  path: Coordinate[],
  projectedPoint: Coordinate,
  edgeFrom: string,
  edgeTo: string,
  graph: SerializableGraph,
  log?: PathValidationLogger,
): Coordinate[] {
  if (path.length < 1) return path;

  const edgeList = graph.edges[edgeFrom] ?? [];
  const edge = edgeList.find((e) => e.to === edgeTo);

  if (!edge) {
    log?.warn({ edgeFrom, edgeTo, reason: 'edge_not_found_in_graph' }, 'EXTEND_PATH_SKIP_INTERNAL');
    return path;
  }

  const geom = edge.geometry;
  if (!geom || geom.length < 2) {
    log?.warn({ edgeFrom, edgeTo, reason: 'edge_geometry_missing_or_short' }, 'EXTEND_PATH_SKIP_INTERNAL');
    return path;
  }

  const cosLat = Math.cos(projectedPoint.lat * Math.PI / 180);
  const LAT_M = 111320;
  const LNG_M = LAT_M * cosLat;

  let bestSegIdx = 0;
  let bestT = 0;
  let bestDist = Infinity;

  for (let i = 0; i < geom.length - 1; i++) {
    const ax = geom[i].lng * LNG_M,     ay = geom[i].lat * LAT_M;
    const bx = geom[i + 1].lng * LNG_M, by = geom[i + 1].lat * LAT_M;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    const t = lenSq === 0 ? 0
      : Math.max(0, Math.min(1,
          ((projectedPoint.lng * LNG_M - ax) * dx + (projectedPoint.lat * LAT_M - ay) * dy) / lenSq,
        ));

    const projLat = geom[i].lat + t * (geom[i + 1].lat - geom[i].lat);
    const projLng = geom[i].lng + t * (geom[i + 1].lng - geom[i].lng);
    const dist = haversine(projectedPoint.lat, projectedPoint.lng, projLat, projLng);

    if (dist < bestDist) {
      bestDist = dist;
      bestSegIdx = i;
      bestT = t;
    }
  }

  if (bestDist > 50) {
    log?.warn({
      edgeFrom, edgeTo,
      bestDist:      Math.round(bestDist),
      bestSegIdx,
      projectedPoint,
      geomLen:       geom.length,
      reason:        'projection_too_far_from_edge_geometry',
    }, 'EXTEND_PATH_SKIP_INTERNAL');
    return path;
  }

  const p: Coordinate = {
    lat: geom[bestSegIdx].lat + bestT * (geom[bestSegIdx + 1].lat - geom[bestSegIdx].lat),
    lng: geom[bestSegIdx].lng + bestT * (geom[bestSegIdx + 1].lng - geom[bestSegIdx].lng),
  };

  // Skip geom[0] (≈ path.last() = edgeFrom node) to avoid near-duplicate coordinates.
  // The connection from path.last() to geom[1] (or directly to p) lies on the road
  // because path.last() ≈ geom[0] within typical coordinate precision (< 5m).
  const extension: Coordinate[] = [
    ...geom.slice(1, bestSegIdx + 1),
    p,
  ];

  const extendedPath = [...path, ...extension];

  if (extendedPath.length < 2) return path;

  log?.info({
    edgeFrom, edgeTo,
    bestSegIdx,
    bestT:        Math.round(bestT * 1000) / 1000,
    bestDistM:    Math.round(bestDist),
    projectedPoint,
    geomLen:      geom.length,
    extensionLen: extension.length,
    originalLen:  path.length,
    extendedLen:  extendedPath.length,
    oldLastPoint: path[path.length - 1],
    newLastPoint: p,
  }, 'EXTEND_PATH_PROGRESS_DEBUG');

  return extendedPath;
}

export function getMaxPathJump(path: Coordinate[]): {
  maxJumpM: number;
  maxJumpIdx: number;
  aroundJump: Coordinate[];
} {
  let maxJumpM = 0;
  let maxJumpIdx = -1;
  for (let i = 1; i < path.length; i++) {
    const d = haversine(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
    if (d > maxJumpM) { maxJumpM = d; maxJumpIdx = i; }
  }
  const aroundJump = maxJumpIdx >= 0
    ? path.slice(Math.max(0, maxJumpIdx - 2), Math.min(path.length, maxJumpIdx + 3))
    : [];
  return { maxJumpM, maxJumpIdx, aroundJump };
}

export function analyzePathJump(path: Coordinate[]): PathJumpAnalysis {
  let maxJumpM = 0;
  let maxJumpIndex = -1;
  for (let i = 1; i < path.length; i++) {
    const d = haversine(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
    if (d > maxJumpM) { maxJumpM = d; maxJumpIndex = i; }
  }
  return {
    maxJumpM,
    maxJumpIndex,
    fromPoint:       maxJumpIndex > 0 ? path[maxJumpIndex - 1] : null,
    toPoint:         maxJumpIndex >= 0 ? path[maxJumpIndex] : null,
    aroundJumpPoints: maxJumpIndex >= 0
      ? path.slice(Math.max(0, maxJumpIndex - 2), Math.min(path.length, maxJumpIndex + 3))
      : [],
    pathLen: path.length,
  };
}

export function pathCost(pts: Coordinate[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++)
    d += haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  return d;
}

export function isSparseGeometryJumpAllowed(input: {
  navMode: NavDistanceMode;
  maxJumpM: number;
  maxPathJumpM: number;
  pathUsesSparseGeometry: boolean;
  sparseGeometryMaxJumpM: number | null;
  toleranceM?: number;
}): boolean {
  const toleranceM = input.toleranceM ?? 10;
  return input.navMode !== 'long_distance' &&
    input.maxJumpM > input.maxPathJumpM &&
    input.pathUsesSparseGeometry &&
    input.sparseGeometryMaxJumpM !== null &&
    input.maxJumpM <= input.sparseGeometryMaxJumpM + toleranceM;
}

function logRenderablePathBlocked(
  prepared: PreparedRenderablePath,
  input: PrepareRenderablePathInput,
): void {
  input.log.warn({
    source: input.source,
    reason: input.reason,
    blockReason: prepared.blockReason,
    originalPathLen: prepared.originalPathLen,
    trimmedPathLen: prepared.trimmedPathLen,
    firstPointDistanceM: Number.isFinite(prepared.firstPointDistanceM)
      ? Math.round(prepared.firstPointDistanceM)
      : null,
    smoothAgent: input.smoothAgent,
    firstPoint: prepared.path[0] ?? null,
    lastPoint: prepared.path.length > 0 ? prepared.path[prepared.path.length - 1] : null,
  }, 'RENDERABLE_PATH_BLOCKED');
}

