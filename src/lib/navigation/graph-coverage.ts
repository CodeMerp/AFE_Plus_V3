import type { Coordinate, SerializableGraph } from '@/lib/navigation/types';
import type { EdgeProjectionResult } from './graph.projection';

export type GraphCoverageReason =
  | 'EDGE_PROJECTION'
  | 'NODE_SNAP'
  | 'OFF_ROAD_NEAR_GRAPH'
  | 'OUTSIDE_GRAPH'
  | 'UNREACHABLE';

export type GraphCoverageResult = {
  covered: boolean;
  reason: GraphCoverageReason;
};

export type GraphCoverageThresholds = {
  edgeProjectionM: number;
  nodeSnapM: number;
  offRoadNearGraphM: number;
};

export const DEFAULT_GRAPH_COVERAGE_THRESHOLDS: GraphCoverageThresholds = {
  edgeProjectionM: 50,
  nodeSnapM: 100,
  offRoadNearGraphM: 150,
};

export function evaluateGraphCoverage(input: {
  targetPos: Coordinate;
  graph: SerializableGraph;
  projection: EdgeProjectionResult | null;
  nearestNodeDistance: number | null;
  plannerReachable: boolean | null;
  thresholds?: Partial<GraphCoverageThresholds>;
}): GraphCoverageResult {
  const thresholds = {
    ...DEFAULT_GRAPH_COVERAGE_THRESHOLDS,
    ...input.thresholds,
  };

  if (input.plannerReachable === false) {
    return { covered: false, reason: 'UNREACHABLE' };
  }

  if (input.projection !== null && input.projection.distanceM <= thresholds.edgeProjectionM) {
    return { covered: true, reason: 'EDGE_PROJECTION' };
  }

  if (input.nearestNodeDistance !== null && input.nearestNodeDistance <= thresholds.nodeSnapM) {
    return { covered: true, reason: 'NODE_SNAP' };
  }

  if (
    input.projection !== null &&
    input.nearestNodeDistance !== null &&
    input.projection.distanceM <= thresholds.offRoadNearGraphM &&
    input.nearestNodeDistance <= thresholds.offRoadNearGraphM
  ) {
    return { covered: true, reason: 'OFF_ROAD_NEAR_GRAPH' };
  }

  return { covered: false, reason: 'OUTSIDE_GRAPH' };
}

// ─── M4-E2: Target attachment validity ─────────────────────────────────────
// evaluateGraphCoverage() above answers "is the target anywhere near this
// session graph" (geographic proximity, true out to offRoadNearGraphM=150m).
// That is not the same question as "can the route validly attach to the
// target's current road position" — geographic coverage stays true for a
// target on a missing branch or a wrong/parallel road, which is exactly the
// false-safe gap this evaluator closes (see M4-E1 design audit §3, §5).
//
// Minimal M4-E2 scope: attachment validity is distance-only (projection
// existence + distance against the same threshold that already gates render
// attachment/tail-trim). Edge continuity, wrong-road/bearing guards, and
// planner-side connected-component reachability are explicitly deferred —
// see the M4-E2 implementation report for the reasoning.
export type TargetAttachmentBand = 'ATTACHED' | 'GRACE' | 'SUSPECT' | 'OUTSIDE';

export type TargetAttachmentInvalidReason = 'no_projection' | 'distance_band' | null;

export type TargetAttachmentThresholds = {
  /** Upper bound (inclusive) of the ATTACHED band — reuses the existing render/tail-trim threshold. */
  attachedM: number;
  /** Upper bound (inclusive) of the GRACE band — reuses DEFAULT_GRAPH_COVERAGE_THRESHOLDS.edgeProjectionM. */
  graceM: number;
  /** Upper bound (inclusive) of the SUSPECT band — reuses DEFAULT_GRAPH_COVERAGE_THRESHOLDS.offRoadNearGraphM. */
  suspectM: number;
};

export const DEFAULT_TARGET_ATTACHMENT_THRESHOLDS: TargetAttachmentThresholds = {
  attachedM: 30,
  graceM: DEFAULT_GRAPH_COVERAGE_THRESHOLDS.edgeProjectionM,
  suspectM: DEFAULT_GRAPH_COVERAGE_THRESHOLDS.offRoadNearGraphM,
};

export type TargetAttachmentResult = {
  /** true iff the target is safely attachable to a road edge right now — the only band MT-D*'s NODE_SNAP/EDGE_PROJECTION output should be trusted for. */
  valid: boolean;
  band: TargetAttachmentBand;
  invalidReason: TargetAttachmentInvalidReason;
};

export function evaluateTargetAttachment(input: {
  projection: EdgeProjectionResult | null;
  thresholds?: Partial<TargetAttachmentThresholds>;
}): TargetAttachmentResult {
  const thresholds = {
    ...DEFAULT_TARGET_ATTACHMENT_THRESHOLDS,
    ...input.thresholds,
  };
  const { projection } = input;

  if (projection === null) {
    return { valid: false, band: 'OUTSIDE', invalidReason: 'no_projection' };
  }
  if (projection.distanceM <= thresholds.attachedM) {
    return { valid: true, band: 'ATTACHED', invalidReason: null };
  }
  if (projection.distanceM <= thresholds.graceM) {
    return { valid: false, band: 'GRACE', invalidReason: 'distance_band' };
  }
  if (projection.distanceM <= thresholds.suspectM) {
    return { valid: false, band: 'SUSPECT', invalidReason: 'distance_band' };
  }
  return { valid: false, band: 'OUTSIDE', invalidReason: 'distance_band' };
}

