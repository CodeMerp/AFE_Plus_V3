export type MapboxPolicyReason =
  | 'SESSION_INIT'
  | 'OUTSIDE_GRAPH'
  | 'GRAPH_INVALID'
  | 'SEMANTIC_STALE'
  | 'ATTACHMENT_INVALID'
  | 'MANUAL_REROUTE'
  | 'SAME_NODE'
  | 'SPARSE_GEOMETRY'
  | 'FORWARD_DRIFT_IF_COVERED'
  | 'AGENT_CORRIDOR_EXCEEDED'
  | 'CORRIDOR_EXCEEDED_IF_COVERED'
  | 'PATH_JUMP_IF_SPARSE'
  | 'PLANNER_FAILED_IF_COVERED'
  | 'NO_MAPBOX_TRIGGER';

export type MapboxPolicyDecision = {
  allowed: boolean;
  reason: MapboxPolicyReason;
};

export function shouldCallMapbox(context: {
  sessionInit?: boolean;
  targetCoveredBySessionGraph: boolean;
  sameNode?: boolean;
  plannerFailed?: boolean;
  pathJump?: boolean;
  pathUsesSparseGeometry?: boolean;
  semanticStale?: boolean;
  graphInvalid?: boolean;
  manualReroute?: boolean;
  forwardDrift?: boolean;
  // M4-E2: true when targetAttachmentValid is false and grace/debounce for its
  // band has already been exhausted (see graph-coverage.ts evaluateTargetAttachment
  // and update/route.ts). Distinct from targetCoveredBySessionGraph — coverage
  // is geographic proximity only and stays true out to 150m, which must no
  // longer suppress a refetch once attachment itself is invalid.
  attachmentInvalid?: boolean;
  // M4-D0/M4-D1: corridor exceedance is no longer a single merged boolean —
  // agent-side and target-side exceedance are different events with
  // different policies (see below).
  agentCorridorExceeded?: boolean;
  targetCorridorExceeded?: boolean;
}): MapboxPolicyDecision {
  if (context.sessionInit) {
    return { allowed: true, reason: 'SESSION_INIT' };
  }

  if (context.manualReroute) {
    return { allowed: true, reason: 'MANUAL_REROUTE' };
  }

  if (context.graphInvalid) {
    return { allowed: true, reason: 'GRAPH_INVALID' };
  }

  if (context.semanticStale) {
    return { allowed: true, reason: 'SEMANTIC_STALE' };
  }

  // M4-E2: target attachment invalidity overrides geographic coverage — being
  // near the graph (targetCoveredBySessionGraph) is not the same as being
  // attachable to a valid road edge. Checked unconditionally, before sameNode/
  // sparse-geometry/forward-drift/corridor gating, mirroring how
  // agentCorridorExceeded already overrides target-side coverage below.
  if (context.attachmentInvalid) {
    return { allowed: true, reason: 'ATTACHMENT_INVALID' };
  }

  if (context.sameNode) {
    return { allowed: false, reason: 'SAME_NODE' };
  }

  if (context.pathUsesSparseGeometry && !context.pathJump) {
    return { allowed: false, reason: 'SPARSE_GEOMETRY' };
  }

  if (context.pathJump && context.pathUsesSparseGeometry) {
    return { allowed: false, reason: 'PATH_JUMP_IF_SPARSE' };
  }

  if (context.forwardDrift && context.targetCoveredBySessionGraph) {
    return { allowed: false, reason: 'FORWARD_DRIFT_IF_COVERED' };
  }

  // Agent off-route is a route-ORIGIN invalidation event, not a target-drift
  // event (M4-D0 root cause). It must override MT-D* First / target-graph
  // coverage — an agent that has physically left the corridor invalidates
  // the premise the existing graph was built on, regardless of whether the
  // target side of that same graph is still fine. Checked unconditionally,
  // before the target-only corridor policy below.
  if (context.agentCorridorExceeded) {
    return { allowed: true, reason: 'AGENT_CORRIDOR_EXCEEDED' };
  }

  if (context.targetCorridorExceeded && context.targetCoveredBySessionGraph) {
    return { allowed: false, reason: 'CORRIDOR_EXCEEDED_IF_COVERED' };
  }

  if (context.plannerFailed && context.targetCoveredBySessionGraph) {
    return { allowed: false, reason: 'PLANNER_FAILED_IF_COVERED' };
  }

  if (!context.targetCoveredBySessionGraph) {
    return { allowed: true, reason: 'OUTSIDE_GRAPH' };
  }

  return { allowed: false, reason: 'NO_MAPBOX_TRIGGER' };
}

