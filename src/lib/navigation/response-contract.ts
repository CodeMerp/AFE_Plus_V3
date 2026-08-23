import type { Coordinate, NavMetric, SessionData, UpdateResponse } from '@/lib/navigation/types';

export type NavigationState =
  | 'INITIALIZING'
  | 'NAVIGATING'
  | 'UPDATING_ROUTE'
  | 'REBUILDING_GRAPH'
  | 'ARRIVED'
  | 'NO_ROUTE'
  | 'SNAP_AMBIGUITY'
  | 'ERROR';

export type ResponsePathSource =
  | 'planner_prepared'
  | 'error_empty'
  | 'same_node_arrived'
  | 'same_node_alternate'
  | 'sparse_geometry_allowed'
  | 'refetch_planner_failed_no_fallback'
  | 'manual_reroute'
  | 'unknown'
  | null;

export function withMetricDefaults(
  metric: NavMetric,
  maxPathJumpThresholdM = 50,
): NavMetric {
  return {
    ...metric,
    maxPathJumpThresholdM: metric.maxPathJumpThresholdM ?? maxPathJumpThresholdM,
    refetchReason: metric.refetchReason ?? null,
    responsePathLen: metric.responsePathLen ?? null,
    pathSource: metric.pathSource ?? null,
    refetchSuccess: metric.refetchSuccess ?? null,
    responsePathSource: metric.responsePathSource ?? null,
    consecutiveRefetchCount: metric.consecutiveRefetchCount ?? 0,
    targetGapM: metric.targetGapM ?? null,
    pathReachesTarget: metric.pathReachesTarget ?? null,
    terminatesEarly: metric.terminatesEarly ?? null,
    lastMileMode: metric.lastMileMode ?? 'none',
    lastMileDistanceM: metric.lastMileDistanceM ?? 0,
    lastMileMapboxCalled: metric.lastMileMapboxCalled ?? false,
    roadTargetGapM: metric.roadTargetGapM ?? null,
    targetSnapDistanceM: metric.targetSnapDistanceM ?? null,
    snappedTargetNodeChanged: metric.snappedTargetNodeChanged ?? null,
    targetGpsToRouteEndM: metric.targetGpsToRouteEndM ?? null,
    snappedTargetNodeId: metric.snappedTargetNodeId ?? null,
    previousSnappedTargetNodeId: metric.previousSnappedTargetNodeId ?? null,
    targetProjectionAttempted: metric.targetProjectionAttempted ?? null,
    targetProjectionAvailable: metric.targetProjectionAvailable ?? null,
    targetProjectionDistanceM: metric.targetProjectionDistanceM ?? null,
    projectedTargetPoint: metric.projectedTargetPoint ?? null,
    projectedEdgeFrom: metric.projectedEdgeFrom ?? null,
    projectedEdgeTo: metric.projectedEdgeTo ?? null,
    projectedDistanceAlongEdgeM: metric.projectedDistanceAlongEdgeM ?? null,
    projectedTargetFallbackReason: metric.projectedTargetFallbackReason ?? null,
    wouldUseProjectedTarget: metric.wouldUseProjectedTarget ?? null,
    graphCreatedAt:          metric.graphCreatedAt          ?? null,
    graphNodeCount:          metric.graphNodeCount          ?? null,
    graphEdgeCount:          metric.graphEdgeCount          ?? null,
    graphCenterPos:          metric.graphCenterPos          ?? null,
    graphRadiusM:            metric.graphRadiusM            ?? null,
    targetDistanceToGraphCenterM: metric.targetDistanceToGraphCenterM ?? null,
    outsideGraphCount:       metric.outsideGraphCount       ?? null,
    pathUsesSparseGeometry:  metric.pathUsesSparseGeometry  ?? null,
    sparseGeometryMaxJumpM:  metric.sparseGeometryMaxJumpM  ?? null,
    sparseGeometryEdgeCount: metric.sparseGeometryEdgeCount ?? null,
    jumpClassification:     metric.jumpClassification     ?? null,
    jumpEdgeId:             metric.jumpEdgeId             ?? null,
    jumpEdgeSource:         metric.jumpEdgeSource         ?? null,
    jumpGeometryPointCount: metric.jumpGeometryPointCount ?? null,
    jumpAllowed:            metric.jumpAllowed            ?? null,
    pathEndpoint:           metric.pathEndpoint           ?? null,
    routeGoalType:           metric.routeGoalType           ?? null,
    routeGoalPoint:         metric.routeGoalPoint         ?? null,
    targetGpsPoint:          metric.targetGpsPoint          ?? null,
    offRoadDistanceM:        metric.offRoadDistanceM        ?? null,
    reachableByRoad:         metric.reachableByRoad         ?? null,
    preEnforcementEndpointDistanceM: metric.preEnforcementEndpointDistanceM ?? null,
    finalEndpointDistanceM: metric.finalEndpointDistanceM ?? null,
    endpointDistanceM:      metric.endpointDistanceM      ?? null,
    endpointEnforced:       metric.endpointEnforced       ?? null,
    endpointTrimmed:        metric.endpointTrimmed        ?? null,
    endpointExtended:       metric.endpointExtended       ?? null,
    frozenAttachmentValid:   metric.frozenAttachmentValid   ?? null,
    lastTargetRoadAttachmentPoint: metric.lastTargetRoadAttachmentPoint ?? null,
    lastTargetProjectionDistanceM: metric.lastTargetProjectionDistanceM ?? null,
    frozenDistanceM:         metric.frozenDistanceM         ?? null,
    endpointEnforcementFailed: metric.endpointEnforcementFailed ?? null,
    targetAttachmentValid:         metric.targetAttachmentValid         ?? null,
    targetAttachmentBand:          metric.targetAttachmentBand          ?? null,
    targetAttachmentInvalidReason: metric.targetAttachmentInvalidReason ?? null,
    targetAttachmentInvalidStreak: metric.targetAttachmentInvalidStreak ?? null,
  };
}

export function withUpdateResponseDefaults(
  body: UpdateResponse,
  maxPathJumpThresholdM = 50,
): UpdateResponse {
  const lastMetric = body.lastMetric
    ? withMetricDefaults(body.lastMetric, maxPathJumpThresholdM)
    : undefined;
  return {
    ...body,
    maneuvers: body.maneuvers ?? [],
    lastMetric,
    refetchReason: body.refetchReason ?? lastMetric?.refetchReason ?? null,
    consecutiveRefetchCount: body.consecutiveRefetchCount ?? lastMetric?.consecutiveRefetchCount ?? 0,
    targetGapM: body.targetGapM ?? lastMetric?.targetGapM ?? null,
    pathReachesTarget: body.pathReachesTarget ?? lastMetric?.pathReachesTarget ?? null,
    terminatesEarly: body.terminatesEarly ?? lastMetric?.terminatesEarly ?? null,
    lastMileMode: body.lastMileMode ?? lastMetric?.lastMileMode ?? 'none',
    lastMileDistanceM: body.lastMileDistanceM ?? lastMetric?.lastMileDistanceM ?? 0,
    lastMileMapboxCalled: body.lastMileMapboxCalled ?? lastMetric?.lastMileMapboxCalled ?? false,
    roadTargetGapM: body.roadTargetGapM ?? lastMetric?.roadTargetGapM ?? null,
    targetSnapDistanceM: body.targetSnapDistanceM ?? lastMetric?.targetSnapDistanceM ?? null,
    snappedTargetNodeChanged: body.snappedTargetNodeChanged ?? lastMetric?.snappedTargetNodeChanged ?? null,
    targetGpsToRouteEndM: body.targetGpsToRouteEndM ?? lastMetric?.targetGpsToRouteEndM ?? null,
    jumpClassification: body.jumpClassification ?? lastMetric?.jumpClassification ?? null,
    jumpEdgeId: body.jumpEdgeId ?? lastMetric?.jumpEdgeId ?? null,
    jumpEdgeSource: body.jumpEdgeSource ?? lastMetric?.jumpEdgeSource ?? null,
    jumpGeometryPointCount: body.jumpGeometryPointCount ?? lastMetric?.jumpGeometryPointCount ?? null,
    jumpAllowed: body.jumpAllowed ?? lastMetric?.jumpAllowed ?? null,
    pathEndpoint: body.pathEndpoint ?? lastMetric?.pathEndpoint ?? null,
    routeGoalPoint: body.routeGoalPoint ?? lastMetric?.routeGoalPoint ?? null,
    preEnforcementEndpointDistanceM: body.preEnforcementEndpointDistanceM ?? lastMetric?.preEnforcementEndpointDistanceM ?? null,
    finalEndpointDistanceM: body.finalEndpointDistanceM ?? lastMetric?.finalEndpointDistanceM ?? null,
    endpointDistanceM: body.endpointDistanceM ?? lastMetric?.endpointDistanceM ?? null,
    endpointEnforced: body.endpointEnforced ?? lastMetric?.endpointEnforced ?? null,
    endpointTrimmed: body.endpointTrimmed ?? lastMetric?.endpointTrimmed ?? null,
    endpointExtended: body.endpointExtended ?? lastMetric?.endpointExtended ?? null,
  };
}

export function pathSignature(path: Coordinate[]): string {
  if (path.length === 0) return 'empty';
  let h = 2166136261 >>> 0;
  for (const p of path) {
    const s = `${p.lat.toFixed(6)},${p.lng.toFixed(6)};`;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    }
  }
  const f = path[0]; const l = path[path.length - 1];
  return `${path.length}:${h.toString(16)}:${f.lat.toFixed(5)},${f.lng.toFixed(5)}:${l.lat.toFixed(5)},${l.lng.toFixed(5)}`;
}

export type NavPathTruthInput = {
  session: SessionData;
  status: string;
  replanType: string;
  mapboxApiCalled: boolean;
  refetchReason: string | null;
  pathSource: Exclude<ResponsePathSource, null>;
  plannerAttempted: boolean;
  plannerSucceeded: boolean | null;
  rawPlannerPath: Coordinate[] | null;
  preparedPath: Coordinate[] | null;
  responsePath: Coordinate[];
  targetForwardDriftDetected: boolean;
  targetForwardDriftSuppressed: boolean;
  targetCoveredBySessionGraph: boolean;
  targetCoverageReason: string | null;
  maxPathJumpM: number;
  jumpThresholdM: number;
};

export function buildNavPathTruthLog(p: NavPathTruthInput): Record<string, unknown> {
  return {
    sessionId:                   p.session.sessionId,
    updateCount:                 p.session.updateCount,
    status:                      p.status,
    replanType:                  p.replanType,
    mapboxApiCalled:             p.mapboxApiCalled,
    refetchReason:               p.refetchReason,
    pathSource:                  p.pathSource,
    plannerAttempted:            p.plannerAttempted,
    plannerSucceeded:            p.plannerSucceeded,
    rawPlannerPathLen:           p.rawPlannerPath !== null ? p.rawPlannerPath.length : null,
    rawPlannerPathSignature:     p.rawPlannerPath !== null ? pathSignature(p.rawPlannerPath) : null,
    preparedPathLen:             p.preparedPath !== null ? p.preparedPath.length : null,
    preparedPathSignature:       p.preparedPath !== null ? pathSignature(p.preparedPath) : null,
    responsePathLen:             p.responsePath.length,
    responsePathSignature:       pathSignature(p.responsePath),
    targetForwardDriftDetected:  p.targetForwardDriftDetected,
    targetForwardDriftSuppressed: p.targetForwardDriftSuppressed,
    targetCoveredBySessionGraph: p.targetCoveredBySessionGraph,
    targetCoverageReason:        p.targetCoverageReason,
    maxPathJumpM:                Math.round(p.maxPathJumpM),
    jumpThresholdM:              p.jumpThresholdM,
    graphCreatedAt:              p.session.graph.createdAt,
    graphNodeCount:              Object.keys(p.session.graph.nodes).length,
    graphEdgeCount:              Object.values(p.session.graph.edges).reduce((s, arr) => s + arr.length, 0),
  };
}
