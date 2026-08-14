// Route-trim paint gate model.
// Pure helper for deciding whether the visual trim paint should update on the
// current frame. Normal steady-state throttling remains unchanged; a geometry
// basis change is the only bypass.

export interface RouteTrimPaintGateInput {
    currentGeometrySignature: string;
    trimBasisSignature: string | null;
    lastPaintAtMs: number;
    nowMs: number;
    distanceDeltaM: number;
    progressDelta: number;
    minAdvanceM: number;
    minProgressDelta: number;
    paintIntervalMs: number;
}

export function hasRouteTrimGeometryBasisChanged(
    currentGeometrySignature: string,
    trimBasisSignature: string | null,
): boolean {
    return currentGeometrySignature !== trimBasisSignature;
}

export function shouldApplyRouteTrimPaint(input: RouteTrimPaintGateInput): boolean {
    if (hasRouteTrimGeometryBasisChanged(input.currentGeometrySignature, input.trimBasisSignature)) {
        return true;
    }
    if (input.lastPaintAtMs === 0) return true;

    const timeSinceLastPaintMs = input.nowMs - input.lastPaintAtMs;
    return (input.distanceDeltaM >= input.minAdvanceM
            || input.progressDelta >= input.minProgressDelta)
        && timeSinceLastPaintMs >= input.paintIntervalMs;
}
