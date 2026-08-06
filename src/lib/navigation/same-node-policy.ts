export type SameNodeDecision =
  | {
      kind: 'NOT_SAME_NODE';
      targetNodeId: string;
    }
  | {
      kind: 'ARRIVED';
      targetNodeId: string;
      gpsDistance: number;
    }
  | {
      kind: 'SNAP_AMBIGUITY';
      targetNodeId: string;
      gpsDistance: number;
    }
  | {
      kind: 'ALTERNATE_TARGET_SELECTED';
      targetNodeId: string;
      previousTargetNodeId: string;
      gpsDistance: number;
    };

export function resolveSameNode(input: {
  agentNodeId: string;
  targetNodeId: string;
  gpsDistance: number;
  arrivalThreshold: number;
  alternateNodeId: string | null;
}): SameNodeDecision {
  if (input.agentNodeId !== input.targetNodeId) {
    return {
      kind: 'NOT_SAME_NODE',
      targetNodeId: input.targetNodeId,
    };
  }

  if (input.gpsDistance <= input.arrivalThreshold) {
    return {
      kind: 'ARRIVED',
      targetNodeId: input.targetNodeId,
      gpsDistance: input.gpsDistance,
    };
  }

  if (input.alternateNodeId === null) {
    return {
      kind: 'SNAP_AMBIGUITY',
      targetNodeId: input.targetNodeId,
      gpsDistance: input.gpsDistance,
    };
  }

  return {
    kind: 'ALTERNATE_TARGET_SELECTED',
    targetNodeId: input.alternateNodeId,
    previousTargetNodeId: input.targetNodeId,
    gpsDistance: input.gpsDistance,
  };
}

