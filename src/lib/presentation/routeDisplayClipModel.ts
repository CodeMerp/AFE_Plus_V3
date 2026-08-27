// [afe.web.route_flicker] Route display-geometry physical clip model.
// Pure helpers for excluding passed route history from the geometry that is actually
// sent to the Mapbox route Source, instead of hiding it behind a separately-mutated
// `line-trim-offset` paint property. Kept separate from routeTrimRebaseModel.ts (which
// still owns the paint-cadence throttle gate) because this module owns a different
// concern: whether a given frame's fresh route projection is safe to physically commit.

export interface LatLngPoint {
    lat: number;
    lng: number;
}

// Physically remove passed history from a route path by slicing the coordinate array at
// the given projection (an interpolated point on `segmentIndex`), rather than keeping the
// full geometry and hiding the passed portion behind a mutable paint property. Mirrors the
// existing routeTailAnchor/renderedRoutePath tail-construction pattern already used for
// marker/camera geometry in src/pages/navigation.tsx, applied here to the Mapbox route
// Source itself.
//
// Fail-closed: returns the input path unchanged if clipping would collapse it below 2
// points (e.g. the projection lands on/after the final segment) — an unclipped-but-valid
// path is preferred over a degenerate one, consistent with how the rest of this codebase
// falls back to unclipped geometry when a projection cannot be trusted.
export function clipRoutePathAtProjection(
    path: LatLngPoint[],
    projectedPoint: LatLngPoint,
    segmentIndex: number,
): LatLngPoint[] {
    if (path.length < 2) return path;
    const tail = path.slice(segmentIndex + 1);
    const clipped: LatLngPoint[] = [projectedPoint, ...tail];
    return clipped.length >= 2 ? clipped : path;
}

// Decide whether this frame's fresh route projection should drive a new physically-clipped
// write, or whether it regressed (GPS noise / re-projection wobble on the same geometry
// basis) and the already-committed display geometry should be left untouched instead.
//
// A geometry-basis change always licenses a fresh commit (rebase), matching the existing
// hasRouteTrimGeometryBasisChanged/shouldApplyRouteTrimPaint bypass semantics. On the same
// basis, the passed frontier must never move backwards — only a forward-or-equal projection
// is committed; a regression is a no-op against the previously-committed generation, never a
// write of stale/foreign geometry.
export function shouldCommitFreshProjection(
    freshDistanceAlongRouteM: number,
    previousDistanceAlongRouteM: number,
    geometryBasisChanged: boolean,
): boolean {
    return geometryBasisChanged || freshDistanceAlongRouteM >= previousDistanceAlongRouteM;
}
