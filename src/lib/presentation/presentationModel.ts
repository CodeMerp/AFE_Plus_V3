// ─────────────────────────────────────────────────────────────────────────────
// PR1 — Frontend Presentation State Model (SHADOW ONLY)
//
// Pure types and pure helpers for the three-layer presentation model:
//
//     Authoritative Route → Pending Presentation → Displayed Presentation
//
// This file is deliberately free of React, Mapbox, refs, timers and module-level
// mutable state. Every function here is a pure transformation of its arguments.
//
// SHADOW ONLY: nothing produced by this module may be consumed by a production
// route / marker / motion / projection / trim / camera decision. In PR1 the
// existing production pipeline remains the sole behavior owner; this module only
// computes what a future Presentation Transaction *would* do, so the runtime
// evidence needed to approve PR2 can be measured first.
//
// Geometry math is INJECTED (see PresentationShadowMathDeps) rather than
// re-implemented. That keeps a single source of truth for projection / progress
// / trim math in app/navigation/page.tsx — this module must never fork it.
// ─────────────────────────────────────────────────────────────────────────────

export type ShadowLatLng = { lat: number; lng: number };

/** Mirrors the production RouteProjection shape without importing it. */
export type ShadowRouteProjection = {
    projectedPoint: ShadowLatLng;
    segmentIndex: number;
    distanceM: number;
    t: number;
};

/** Mirrors the production RouteTrimProgress shape without importing it. */
export type ShadowRouteTrim = {
    progress: number;
    distanceAlongRouteM: number;
    distanceM: number;
    segmentIndex: number;
    projectedPoint: ShadowLatLng;
    totalLengthM: number;
};

export type PresentationTransitionType =
    | 'INITIAL_PRESENTATION'
    | 'MT_INCREMENTAL'
    | 'MAPBOX_REPLACEMENT'
    | 'DUPLICATE_OR_NOOP'
    | 'INVALID_OR_EMPTY';

/**
 * Four-valued invariant status.
 *
 * UNPROVEN is load-bearing: it marks an invariant whose *measurement* exists but
 * whose pass/fail tolerance has not been calibrated from field data yet. PR1
 * must never silently promote UNPROVEN to PASS by inventing a threshold.
 */
export type ShadowValidationStatus = 'PASS' | 'FAIL' | 'UNPROVEN' | 'NOT_APPLICABLE';

export type PresentationRetryTrigger =
    | 'new_route'
    | 'new_gps'
    | 'marker_moved'
    | 'source_ready_changed'
    | 'manual_shadow_retry'
    | 'none';

// ── Layer 1: Authoritative Route ─────────────────────────────────────────────

export interface AuthoritativeRouteShadow {
    generation: number;
    geometry: ShadowLatLng[];
    routeVersion: number;
    routeSourceKey: number;
    signature: string;
    bodySignature: string;
    targetEndpoint: ShadowLatLng | null;
    receivedAt: number;
    /** Backend metadata snapshot — recorded as observed, never inferred. */
    replanType: string | null;
    mapboxApiCalled: boolean | null;
    refetchReason: string | null;
}

// ── Layer 3 (observed): Displayed Presentation snapshot ──────────────────────
// Diagnostic-only view of what production currently has on screen. Built from
// production state by the caller; this module only reads it.

export interface DisplayedPresentationShadowSnapshot {
    geometrySignature: string;
    geometryPointCount: number;
    routeVersion: number;
    routeSourceKey: number;
    visualMarker: ShadowLatLng | null;
    markerProjection: ShadowRouteProjection | null;
    markerProgressM: number | null;
    trimNormalized: number | null;
    trimDistanceAlongRouteM: number | null;
    routeHead: ShadowLatLng | null;
    cameraMarkerInput: ShadowLatLng | null;
    cameraBearingDeg: number | null;
    cameraCenter: ShadowLatLng | null;
}

// ── Layer 2: Pending Presentation (shadow candidate) ─────────────────────────

export interface PendingPresentationTrimBasis {
    normalized: number | null;
    distanceAlongRouteM: number | null;
    totalLengthM: number | null;
    geometrySignature: string;
}

export interface PendingPresentationCameraBasis {
    markerWorldAnchor: ShadowLatLng;
    routeBearingDeg: number | null;
    lookAheadCoordinate: ShadowLatLng | null;
}

export interface PendingPresentationShadow {
    generation: number;
    transitionType: PresentationTransitionType;
    sourceIdentity: { routeVersion: number; routeSourceKey: number };
    geometrySignature: string;
    geometryPointCount: number;
    /** The single marker snapshot every stage of this preparation shares. */
    markerWorldAnchor: ShadowLatLng;
    markerProjection: ShadowRouteProjection | null;
    markerProgressM: number | null;
    rawGpsTargetProjection: ShadowRouteProjection | null;
    targetProgressM: number | null;
    progressLagM: number | null;
    trimBasis: PendingPresentationTrimBasis;
    routeHeadCoordinate: ShadowLatLng | null;
    /**
     * Where route sampling at the rebased marker progress would place the
     * marker. Used only to measure the jump the *existing* migration path would
     * produce; the shadow never moves the marker.
     */
    rebasedMarkerSamplePoint: ShadowLatLng | null;
    targetEndpoint: ShadowLatLng | null;
    routeTotalLengthM: number | null;
    remainingRouteM: number | null;
    routeAheadValid: boolean;
    cameraBasis: PendingPresentationCameraBasis;
    validation: PresentationShadowValidation;
    preparedAt: number;
    retryTrigger: PresentationRetryTrigger;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface PresentationShadowValidation {
    geometryValidity: ShadowValidationStatus;
    markerProjectionValidity: ShadowValidationStatus;
    /**
     * Deliberately distinct from markerProjectionValidity. The existing 50 m
     * AGENT_PROJECTION_MAX_DIST_M is a *navigation* acceptance threshold; it has
     * never been shown to be a *presentation* safety bound. This stays UNPROVEN
     * until field data calibrates it.
     */
    presentationProjectionSafety: ShadowValidationStatus;
    markerContinuityValidity: ShadowValidationStatus;
    routeHeadValidity: ShadowValidationStatus;
    routeAheadValidity: ShadowValidationStatus;
    trimValidity: ShadowValidationStatus;
    motionValidity: ShadowValidationStatus;
    cameraContinuityValidity: ShadowValidationStatus;
    overall: ShadowValidationStatus;
    failureReason: string | null;
    /** Measurements exported raw — no invented pass thresholds. */
    navigationProjectionAccepted: boolean | null;
    markerProjectionDistanceM: number | null;
    routeHeadGapWorldM: number | null;
    routeHeadAheadOfMarker: boolean | null;
    targetBehindMarker: boolean | null;
    endpointValid: boolean | null;
    markerWorldUnchangedByPreparation: boolean;
    /**
     * Diagnostic only — must never gate production. True means "no hard
     * invariant failed"; UNPROVEN invariants are NOT treated as blocking in PR1
     * precisely because their tolerances are uncalibrated.
     */
    wouldPublish: boolean;
}

// ── Hold / starvation shadow state ───────────────────────────────────────────

export interface PresentationShadowHoldState {
    held: boolean;
    holdGeneration: number | null;
    firstHeldAt: number | null;
    consecutiveHoldCount: number;
    retryCount: number;
    latestFailureReason: string | null;
    holdStartMarker: ShadowLatLng | null;
    holdStartTargetEndpoint: ShadowLatLng | null;
    markerMovementSinceHoldM: number | null;
    targetEndpointDriftM: number | null;
    superseded: boolean;
    lastRetryTrigger: PresentationRetryTrigger;
}

export function createEmptyHoldState(): PresentationShadowHoldState {
    return {
        held: false,
        holdGeneration: null,
        firstHeldAt: null,
        consecutiveHoldCount: 0,
        retryCount: 0,
        latestFailureReason: null,
        holdStartMarker: null,
        holdStartTargetEndpoint: null,
        markerMovementSinceHoldM: null,
        targetEndpointDriftM: null,
        superseded: false,
        lastRetryTrigger: 'none',
    };
}

// ── Production/shadow comparison ─────────────────────────────────────────────

export interface PresentationShadowComparison {
    productionWouldCurrentlyPublish: boolean | null;
    shadowWouldPublish: boolean;
    disagreementReason: string | null;
    productionTrimNormalized: number | null;
    candidateTrimNormalized: number | null;
    trimNormalizedDelta: number | null;
    productionRouteHead: ShadowLatLng | null;
    productionRouteHeadGapWorldM: number | null;
    candidateRouteHeadGapWorldM: number | null;
    /** Marker jump the *existing* migration path would produce, when measurable. */
    expectedMarkerJumpM: number | null;
    expectedProgressRebaseM: number | null;
    expectedTargetProgressDeltaM: number | null;
    expectedTargetProgressLagM: number | null;
    displayedMarkerProgressDeltaM: number | null;
    cameraBearingDeltaDeg: number | null;
    cameraLookAheadMovementM: number | null;
}

// ── Atomicity observation ────────────────────────────────────────────────────
// Values are read from the live map by the caller (impure); this module only
// derives the mismatch flags from them.

export interface PresentationShadowAtomicityInput {
    sourceExists: boolean;
    routeLayerExists: boolean;
    casingLayerExists: boolean;
    sourceGeometrySignature: string | null;
    stableRefSignature: string;
    reactDisplayedSignature: string;
    routeLayerTrim: [number, number] | null;
    casingLayerTrim: [number, number] | null;
    trimBasisSignature: string | null;
    frameNumber: number;
}

export interface PresentationShadowAtomicityObservation extends PresentationShadowAtomicityInput {
    /** Rendered geometry does not match the signature the trim was computed for. */
    geometryTrimBasisMismatch: boolean;
    /** The two route layers disagree on trim — a partially applied paint. */
    layerTrimMismatch: boolean;
    /** React-committed signature has not caught up with the imperative ref. */
    reactRefSignatureMismatch: boolean;
    /** Map source geometry disagrees with the stable production ref. */
    sourceRefSignatureMismatch: boolean;
}

// ── Injected math ────────────────────────────────────────────────────────────
// The production implementations are passed in by reference so this module never
// forks projection / progress / trim math, and never adds a call site to the
// production projection path.

export interface PresentationShadowMathDeps {
    projectPointToRoute: (point: ShadowLatLng, routePath: ShadowLatLng[]) => ShadowRouteProjection | null;
    computeRouteProgressFromProjection: (segmentIndex: number, t: number, routePath: ShadowLatLng[]) => number;
    computeRouteTrimProgress: (
        point: ShadowLatLng,
        routePath: ShadowLatLng[],
        maxProjectionDistanceM: number,
    ) => ShadowRouteTrim | null;
    distanceMeters: (a: ShadowLatLng, b: ShadowLatLng) => number;
    sampleRouteAtDistance: (
        routePath: ShadowLatLng[],
        distanceM: number,
    ) => { position: ShadowLatLng; bearing: number; segmentIndex: number } | null;
    computeLookAheadCenter: (agentPos: ShadowLatLng, bearingDeg: number, lookAheadM: number) => ShadowLatLng;
    shortestBearingDelta: (from: number, to: number) => number;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function isFiniteLatLng(p: ShadowLatLng | null | undefined): boolean {
    return !!p
        && Number.isFinite(p.lat)
        && Number.isFinite(p.lng)
        && Math.abs(p.lat) <= 90
        && Math.abs(p.lng) <= 180;
}

export function allCoordinatesFinite(geometry: ShadowLatLng[]): boolean {
    for (const p of geometry) {
        if (!isFiniteLatLng(p)) return false;
    }
    return true;
}

// ── Phase C: pure classification ─────────────────────────────────────────────

export interface ClassifyPresentationTransitionInput {
    candidateGeometryLength: number;
    candidateSignature: string;
    candidateCoordinatesFinite: boolean;
    displayedGeometryLength: number;
    displayedSignature: string;
    candidateRouteSourceKey: number;
    displayedRouteSourceKey: number;
    /**
     * Outcome of the existing production presentation guard / body lock. When
     * production decided to hold, the shadow reports INVALID_OR_EMPTY so the two
     * classifications stay comparable — the shadow never overrides that guard.
     */
    productionGuardHold: boolean;
}

export interface ClassifyPresentationTransitionResult {
    transitionType: PresentationTransitionType;
    /**
     * A Mapbox refetch that returned byte-identical geometry. Production
     * (page.tsx) resolves this as `duplicate` because it tests the signature
     * before the source-key change, so the shadow follows the same order and
     * flags the case rather than silently diverging.
     */
    duplicateWithSourceKeyChange: boolean;
    reason: string;
}

export function classifyPresentationTransition(
    input: ClassifyPresentationTransitionInput,
): ClassifyPresentationTransitionResult {
    const sourceKeyChanged = input.candidateRouteSourceKey !== input.displayedRouteSourceKey;
    const sameSignature = input.candidateSignature === input.displayedSignature;
    const duplicateWithSourceKeyChange = sameSignature && sourceKeyChanged;

    if (input.candidateGeometryLength < 2) {
        return { transitionType: 'INVALID_OR_EMPTY', duplicateWithSourceKeyChange, reason: 'path_too_short' };
    }
    if (!input.candidateCoordinatesFinite) {
        return { transitionType: 'INVALID_OR_EMPTY', duplicateWithSourceKeyChange, reason: 'invalid_coordinates' };
    }
    if (input.productionGuardHold) {
        return { transitionType: 'INVALID_OR_EMPTY', duplicateWithSourceKeyChange, reason: 'production_guard_hold' };
    }
    if (input.displayedGeometryLength < 2) {
        return { transitionType: 'INITIAL_PRESENTATION', duplicateWithSourceKeyChange, reason: 'no_displayed_geometry' };
    }
    // Signature test precedes the source-key test to mirror the production
    // route effect's own branch order (page.tsx: sameSignature before
    // sourceKeyChanged). Divergence would itself be a false disagreement signal.
    if (sameSignature) {
        return { transitionType: 'DUPLICATE_OR_NOOP', duplicateWithSourceKeyChange, reason: 'exact_signature_match' };
    }
    if (sourceKeyChanged) {
        return { transitionType: 'MAPBOX_REPLACEMENT', duplicateWithSourceKeyChange, reason: 'route_source_key_changed' };
    }
    return { transitionType: 'MT_INCREMENTAL', duplicateWithSourceKeyChange, reason: 'material_geometry_change' };
}

/** Maps a production route-effect outcome onto the transition it implies. */
export function productionReasonToTransitionType(
    productionReason: string | null,
    productionApplied: boolean | null,
    sourceKeyChanged: boolean,
): PresentationTransitionType | null {
    if (productionReason === null) return null;
    if (productionApplied === false) return 'INVALID_OR_EMPTY';
    switch (productionReason) {
        case 'initial_seed':               return 'INITIAL_PRESENTATION';
        case 'duplicate':                  return 'DUPLICATE_OR_NOOP';
        case 'tail_only_agent_movement':   return 'DUPLICATE_OR_NOOP';
        case 'route_version_changed':      return sourceKeyChanged ? 'MAPBOX_REPLACEMENT' : 'MT_INCREMENTAL';
        case 'route_endpoint_changed':     return 'MT_INCREMENTAL';
        case 'route_body_changed':         return 'MT_INCREMENTAL';
        default:                           return null;
    }
}

// ── Phase E: pure preparation ────────────────────────────────────────────────

export interface PreparePendingPresentationInput {
    generation: number;
    transitionType: PresentationTransitionType;
    geometry: ShadowLatLng[];
    geometrySignature: string;
    routeVersion: number;
    routeSourceKey: number;
    markerWorldAnchor: ShadowLatLng;
    rawGpsPosition: ShadowLatLng;
    /** Existing navigation acceptance distance, injected — not a new threshold. */
    navigationProjectionMaxDistM: number;
    /** Existing trim projection limit, injected — not a new threshold. */
    trimMaxProjectionDistM: number;
    /** Current camera look-ahead distance, read from production diagnostics. */
    activeLookAheadM: number;
    preparedAt: number;
    retryTrigger: PresentationRetryTrigger;
}

export function preparePendingPresentationShadow(
    input: PreparePendingPresentationInput,
    displayed: DisplayedPresentationShadowSnapshot,
    deps: PresentationShadowMathDeps,
): PendingPresentationShadow {
    const geometry = input.geometry;
    const anchor = input.markerWorldAnchor;
    const usable = geometry.length >= 2 && allCoordinatesFinite(geometry) && isFiniteLatLng(anchor);

    // 2. Marker anchor projected onto the candidate geometry.
    const markerProjection = usable ? deps.projectPointToRoute(anchor, geometry) : null;
    // 4. Marker progress along the candidate.
    const markerProgressM = markerProjection
        ? deps.computeRouteProgressFromProjection(markerProjection.segmentIndex, markerProjection.t, geometry)
        : null;

    // 3. Raw GPS target projected independently onto the same candidate.
    const rawGpsTargetProjection = usable && isFiniteLatLng(input.rawGpsPosition)
        ? deps.projectPointToRoute(input.rawGpsPosition, geometry)
        : null;
    // 5. Target progress along the candidate.
    const targetProgressM = rawGpsTargetProjection
        ? deps.computeRouteProgressFromProjection(rawGpsTargetProjection.segmentIndex, rawGpsTargetProjection.t, geometry)
        : null;

    // 6. Progress lag (target minus marker), reported signed so a target that
    //    projects *behind* the marker is visible rather than clamped away.
    const progressLagM = markerProgressM !== null && targetProgressM !== null
        ? targetProgressM - markerProgressM
        : null;

    // 7. Trim derived from the marker WORLD anchor on the candidate geometry —
    //    never from a previously stored normalized progress.
    const trim = usable
        ? deps.computeRouteTrimProgress(anchor, geometry, input.trimMaxProjectionDistM)
        : null;
    const trimBasis: PendingPresentationTrimBasis = {
        normalized: trim ? trim.progress : null,
        distanceAlongRouteM: trim ? trim.distanceAlongRouteM : null,
        totalLengthM: trim ? trim.totalLengthM : null,
        geometrySignature: input.geometrySignature,
    };

    // 8. Route head derived from that same trim basis.
    const routeHeadCoordinate = trim ? trim.projectedPoint : null;

    const targetEndpoint = geometry.length >= 2 ? geometry[geometry.length - 1] : null;
    const routeTotalLengthM = trim ? trim.totalLengthM : null;

    // 10. Route ahead: geometry must continue from head to target endpoint.
    const remainingRouteM = routeTotalLengthM !== null && markerProgressM !== null
        ? routeTotalLengthM - markerProgressM
        : null;
    const routeAheadValid = remainingRouteM !== null
        && remainingRouteM > 0
        && isFiniteLatLng(targetEndpoint);

    // 9. Candidate camera basis, derived from the same marker snapshot.
    const routeSample = usable && markerProgressM !== null
        ? deps.sampleRouteAtDistance(geometry, markerProgressM)
        : null;
    const routeBearingDeg = routeSample ? routeSample.bearing : null;
    const lookAheadCoordinate = routeBearingDeg !== null && Number.isFinite(input.activeLookAheadM)
        ? deps.computeLookAheadCenter(anchor, routeBearingDeg, input.activeLookAheadM)
        : null;

    const pendingWithoutValidation = {
        generation: input.generation,
        transitionType: input.transitionType,
        sourceIdentity: { routeVersion: input.routeVersion, routeSourceKey: input.routeSourceKey },
        geometrySignature: input.geometrySignature,
        geometryPointCount: geometry.length,
        markerWorldAnchor: anchor,
        markerProjection,
        markerProgressM,
        rawGpsTargetProjection,
        targetProgressM,
        progressLagM,
        trimBasis,
        routeHeadCoordinate,
        rebasedMarkerSamplePoint: routeSample ? routeSample.position : null,
        targetEndpoint,
        routeTotalLengthM,
        remainingRouteM,
        routeAheadValid,
        cameraBasis: {
            markerWorldAnchor: anchor,
            routeBearingDeg,
            lookAheadCoordinate,
        },
        preparedAt: input.preparedAt,
        retryTrigger: input.retryTrigger,
    };

    const validation = validatePendingPresentationShadow(
        pendingWithoutValidation,
        displayed,
        { navigationProjectionMaxDistM: input.navigationProjectionMaxDistM },
        deps,
    );

    return { ...pendingWithoutValidation, validation };
}

// ── Phase F: pure validation ─────────────────────────────────────────────────

export type PendingPresentationShadowDraft = Omit<PendingPresentationShadow, 'validation'>;

export interface ValidatePendingPresentationOptions {
    navigationProjectionMaxDistM: number;
}

export function validatePendingPresentationShadow(
    pending: PendingPresentationShadowDraft,
    displayed: DisplayedPresentationShadowSnapshot,
    options: ValidatePendingPresentationOptions,
    deps: PresentationShadowMathDeps,
): PresentationShadowValidation {
    const failures: string[] = [];

    // Geometry
    const geometryOk = pending.geometryPointCount >= 2
        && pending.routeTotalLengthM !== null
        && pending.routeTotalLengthM > 0
        && isFiniteLatLng(pending.targetEndpoint);
    const geometryValidity: ShadowValidationStatus = geometryOk ? 'PASS' : 'FAIL';
    if (!geometryOk) failures.push('geometry_invalid');

    // Marker projection — navigation acceptance only.
    const markerProjectionDistanceM = pending.markerProjection ? pending.markerProjection.distanceM : null;
    const navigationProjectionAccepted = markerProjectionDistanceM !== null
        ? markerProjectionDistanceM <= options.navigationProjectionMaxDistM
        : null;
    let markerProjectionValidity: ShadowValidationStatus;
    if (!pending.markerProjection) {
        markerProjectionValidity = 'FAIL';
        failures.push('marker_projection_missing');
    } else if (navigationProjectionAccepted === false) {
        markerProjectionValidity = 'FAIL';
        failures.push('marker_projection_beyond_navigation_threshold');
    } else {
        markerProjectionValidity = 'PASS';
    }

    // Presentation safety is a DIFFERENT question from navigation acceptance and
    // has no calibrated bound yet. Never PASS here on the strength of the 50 m
    // navigation threshold alone.
    const presentationProjectionSafety: ShadowValidationStatus = pending.markerProjection
        ? 'UNPROVEN'
        : 'NOT_APPLICABLE';

    // Marker continuity — preparation must not move the marker.
    const markerWorldUnchangedByPreparation = !!displayed.visualMarker
        && displayed.visualMarker.lat === pending.markerWorldAnchor.lat
        && displayed.visualMarker.lng === pending.markerWorldAnchor.lng;
    let markerContinuityValidity: ShadowValidationStatus;
    if (!displayed.visualMarker) {
        markerContinuityValidity = 'NOT_APPLICABLE';
    } else if (markerWorldUnchangedByPreparation) {
        markerContinuityValidity = 'PASS';
    } else {
        markerContinuityValidity = 'FAIL';
        failures.push('marker_world_moved_during_preparation');
    }

    // Route head — measured only. No pass tolerance is invented here.
    const routeHeadGapWorldM = pending.routeHeadCoordinate
        ? deps.distanceMeters(pending.markerWorldAnchor, pending.routeHeadCoordinate)
        : null;
    const routeHeadAheadOfMarker = pending.trimBasis.distanceAlongRouteM !== null && pending.markerProgressM !== null
        ? pending.trimBasis.distanceAlongRouteM > pending.markerProgressM
        : null;
    let routeHeadValidity: ShadowValidationStatus;
    if (!pending.routeHeadCoordinate) {
        routeHeadValidity = 'FAIL';
        failures.push('route_head_not_computable');
    } else if (routeHeadAheadOfMarker === true) {
        // Head ahead of the marker is the one directional failure that is
        // unambiguous without a calibrated distance tolerance: it renders as a
        // broken route. Head *behind* the marker only leaves a short stub.
        routeHeadValidity = 'FAIL';
        failures.push('route_head_ahead_of_marker');
    } else {
        // The gap magnitude tolerance is still uncalibrated.
        routeHeadValidity = 'UNPROVEN';
    }

    // Route ahead
    const targetBehindMarker = pending.progressLagM !== null ? pending.progressLagM < 0 : null;
    const endpointValid = isFiniteLatLng(pending.targetEndpoint);
    let routeAheadValidity: ShadowValidationStatus;
    if (!pending.routeAheadValid) {
        routeAheadValidity = 'FAIL';
        failures.push('route_ahead_incomplete');
    } else if (targetBehindMarker === true) {
        routeAheadValidity = 'UNPROVEN';
    } else {
        routeAheadValidity = 'PASS';
    }

    // Trim — must belong to the candidate geometry and be derived from the world
    // marker, never from a stored normalized progress.
    let trimValidity: ShadowValidationStatus;
    if (pending.trimBasis.normalized === null) {
        trimValidity = 'FAIL';
        failures.push('trim_not_computable_on_candidate');
    } else if (pending.trimBasis.geometrySignature !== pending.geometrySignature) {
        trimValidity = 'FAIL';
        failures.push('trim_basis_signature_mismatch');
    } else {
        trimValidity = 'PASS';
    }

    // Motion — a rebase preserves world position by construction here, because
    // the shadow never writes integrator state. The dual-writer risk (production
    // migration still owns progress) stays UNPROVEN for as long as PR1 runs.
    const motionValidity: ShadowValidationStatus = pending.markerProgressM === null
        ? 'FAIL'
        : 'UNPROVEN';
    if (pending.markerProgressM === null) failures.push('marker_progress_not_computable');

    // Camera — basis change magnitude is measured, tolerance uncalibrated.
    let cameraContinuityValidity: ShadowValidationStatus;
    if (pending.cameraBasis.routeBearingDeg === null || displayed.cameraBearingDeg === null) {
        cameraContinuityValidity = 'NOT_APPLICABLE';
    } else {
        cameraContinuityValidity = 'UNPROVEN';
    }

    const hasFailure = failures.length > 0;
    const hasUnproven = [
        geometryValidity, markerProjectionValidity, presentationProjectionSafety,
        markerContinuityValidity, routeHeadValidity, routeAheadValidity,
        trimValidity, motionValidity, cameraContinuityValidity,
    ].includes('UNPROVEN');

    const overall: ShadowValidationStatus = hasFailure
        ? 'FAIL'
        : (hasUnproven ? 'UNPROVEN' : 'PASS');

    return {
        geometryValidity,
        markerProjectionValidity,
        presentationProjectionSafety,
        markerContinuityValidity,
        routeHeadValidity,
        routeAheadValidity,
        trimValidity,
        motionValidity,
        cameraContinuityValidity,
        overall,
        failureReason: hasFailure ? failures[0] : null,
        navigationProjectionAccepted,
        markerProjectionDistanceM,
        routeHeadGapWorldM,
        routeHeadAheadOfMarker,
        targetBehindMarker,
        endpointValid,
        markerWorldUnchangedByPreparation,
        // Diagnostic only. Never consumed by production.
        wouldPublish: !hasFailure,
    };
}

// ── Phase G: pure atomicity summary ──────────────────────────────────────────

export function summarizeAtomicityObservation(
    input: PresentationShadowAtomicityInput,
): PresentationShadowAtomicityObservation {
    const layerTrimMismatch = !!input.routeLayerTrim
        && !!input.casingLayerTrim
        && (input.routeLayerTrim[0] !== input.casingLayerTrim[0]
            || input.routeLayerTrim[1] !== input.casingLayerTrim[1]);

    const geometryTrimBasisMismatch = input.trimBasisSignature !== null
        && input.trimBasisSignature !== input.stableRefSignature;

    return {
        ...input,
        geometryTrimBasisMismatch,
        layerTrimMismatch,
        reactRefSignatureMismatch: input.reactDisplayedSignature !== input.stableRefSignature,
        sourceRefSignatureMismatch: input.sourceGeometrySignature !== null
            && input.sourceGeometrySignature !== input.stableRefSignature,
    };
}

// ── Phase H: pure hold-state transition ──────────────────────────────────────

export interface UpdateHoldStateInput {
    previous: PresentationShadowHoldState;
    generation: number;
    now: number;
    failed: boolean;
    failureReason: string | null;
    markerWorldAnchor: ShadowLatLng;
    targetEndpoint: ShadowLatLng | null;
    retryTrigger: PresentationRetryTrigger;
}

export function updatePresentationShadowHold(
    input: UpdateHoldStateInput,
    deps: PresentationShadowMathDeps,
): PresentationShadowHoldState {
    const prev = input.previous;

    if (!input.failed) {
        // Validation passed — the hold (if any) is resolved.
        return createEmptyHoldState();
    }

    const supersededNow = prev.held
        && prev.holdGeneration !== null
        && prev.holdGeneration !== input.generation;

    // A newer authoritative generation replaces the held one: restart the hold
    // against the new generation rather than accumulating across identities.
    if (!prev.held || supersededNow) {
        return {
            held: true,
            holdGeneration: input.generation,
            firstHeldAt: input.now,
            consecutiveHoldCount: 1,
            retryCount: 0,
            latestFailureReason: input.failureReason,
            holdStartMarker: input.markerWorldAnchor,
            holdStartTargetEndpoint: input.targetEndpoint,
            markerMovementSinceHoldM: 0,
            targetEndpointDriftM: 0,
            superseded: supersededNow,
            lastRetryTrigger: input.retryTrigger,
        };
    }

    return {
        held: true,
        holdGeneration: prev.holdGeneration,
        firstHeldAt: prev.firstHeldAt,
        consecutiveHoldCount: prev.consecutiveHoldCount + 1,
        retryCount: prev.retryCount + 1,
        latestFailureReason: input.failureReason,
        holdStartMarker: prev.holdStartMarker,
        holdStartTargetEndpoint: prev.holdStartTargetEndpoint,
        markerMovementSinceHoldM: prev.holdStartMarker
            ? deps.distanceMeters(prev.holdStartMarker, input.markerWorldAnchor)
            : null,
        targetEndpointDriftM: prev.holdStartTargetEndpoint && input.targetEndpoint
            ? deps.distanceMeters(prev.holdStartTargetEndpoint, input.targetEndpoint)
            : null,
        superseded: false,
        lastRetryTrigger: input.retryTrigger,
    };
}

// ── Phase I: pure production/shadow comparison ───────────────────────────────

export interface ComparePresentationShadowInput {
    pending: PendingPresentationShadow;
    displayed: DisplayedPresentationShadowSnapshot;
    /** Whether the production route effect applied a source update this cycle. */
    productionWouldCurrentlyPublish: boolean | null;
    /** Live production integrator route progress (metres along the displayed route). */
    productionCurrentRouteProgressM: number | null;
    /** Live production integrator target progress (metres along the displayed route). */
    productionCurrentTargetProgressM: number | null;
}

export function comparePresentationShadow(
    input: ComparePresentationShadowInput,
    deps: PresentationShadowMathDeps,
): PresentationShadowComparison {
    const { pending, displayed } = input;

    const productionRouteHeadGapWorldM = displayed.routeHead && displayed.visualMarker
        ? deps.distanceMeters(displayed.visualMarker, displayed.routeHead)
        : null;
    const candidateRouteHeadGapWorldM = pending.validation.routeHeadGapWorldM;

    // The existing migration path rebases route progress and then lets the
    // integrator sample the route at that progress. This measures how far that
    // sampled point sits from the marker's current world anchor — i.e. the jump
    // the production path would produce on this transition.
    const expectedMarkerJumpM = pending.rebasedMarkerSamplePoint
        ? deps.distanceMeters(pending.markerWorldAnchor, pending.rebasedMarkerSamplePoint)
        : null;

    // How far the integrator's own route progress would move if it were rebased
    // onto the candidate geometry. A large value with a stationary marker means
    // the jump is a coordinate-system change, not motion.
    const expectedProgressRebaseM = pending.markerProgressM !== null
        && input.productionCurrentRouteProgressM !== null
        ? pending.markerProgressM - input.productionCurrentRouteProgressM
        : null;

    // How far the integrator's TARGET progress would move. This is the quantity
    // that produced the ~31 m step observed in the Phase 7 field test.
    const expectedTargetProgressDeltaM = pending.targetProgressM !== null
        && input.productionCurrentTargetProgressM !== null
        ? pending.targetProgressM - input.productionCurrentTargetProgressM
        : null;

    const expectedTargetProgressLagM = pending.progressLagM;

    const cameraBearingDeltaDeg = pending.cameraBasis.routeBearingDeg !== null && displayed.cameraBearingDeg !== null
        ? deps.shortestBearingDelta(displayed.cameraBearingDeg, pending.cameraBasis.routeBearingDeg)
        : null;

    const cameraLookAheadMovementM = pending.cameraBasis.lookAheadCoordinate && displayed.cameraCenter
        ? deps.distanceMeters(displayed.cameraCenter, pending.cameraBasis.lookAheadCoordinate)
        : null;

    const trimNormalizedDelta = pending.trimBasis.normalized !== null && displayed.trimNormalized !== null
        ? pending.trimBasis.normalized - displayed.trimNormalized
        : null;

    let disagreementReason: string | null = null;
    if (input.productionWouldCurrentlyPublish !== null
        && input.productionWouldCurrentlyPublish !== pending.validation.wouldPublish) {
        disagreementReason = input.productionWouldCurrentlyPublish
            ? 'production_publishes_shadow_would_hold'
            : 'production_holds_shadow_would_publish';
    }

    return {
        productionWouldCurrentlyPublish: input.productionWouldCurrentlyPublish,
        shadowWouldPublish: pending.validation.wouldPublish,
        disagreementReason,
        productionTrimNormalized: displayed.trimNormalized,
        candidateTrimNormalized: pending.trimBasis.normalized,
        trimNormalizedDelta,
        productionRouteHead: displayed.routeHead,
        productionRouteHeadGapWorldM,
        candidateRouteHeadGapWorldM,
        expectedMarkerJumpM,
        expectedProgressRebaseM,
        expectedTargetProgressDeltaM,
        expectedTargetProgressLagM,
        displayedMarkerProgressDeltaM: pending.markerProgressM !== null && displayed.markerProgressM !== null
            ? pending.markerProgressM - displayed.markerProgressM
            : null,
        cameraBearingDeltaDeg,
        cameraLookAheadMovementM,
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// PR2a-1A — Pure Route/Trim Transaction Model (BEHAVIOR-FREE)
//
// Everything below models what a FUTURE coherent same-identity publish would do.
// PR2a-1A implements none of it: there is no Mapbox mutation, no transaction
// runner, and no production decision may consume any result here.
//
// The model exists so the runtime can answer, before any behavior changes:
//   - is this production branch an eligible same-identity entry?
//   - what trim/route-head would be prepared from the Marker world position?
//   - would the candidate satisfy directional / basis / visual-connection policy?
//   - would a future transaction have enough readable state to be reversible?
//   - what would P0/P1/P2/P3 have to verify?
//   - would the transaction publish, hold, or need degraded presentation?
// ═════════════════════════════════════════════════════════════════════════════

/** Production route-effect branch identity, as observed — never inferred. */
export type PresentationPublishEntryReason =
    | 'route_version_changed'
    | 'route_endpoint_changed'
    | 'route_body_changed'
    | 'initial_seed'
    | 'mapbox_replacement'
    | 'duplicate'
    | 'tail_only_agent_movement'
    | 'presentation_guard_hold'
    | 'body_lock_hold'
    | 'unknown';

/**
 * Model states for the future transaction. PR2a-1A never enters any state past
 * VALIDATE — nothing here drives a runtime state machine yet.
 */
export type PresentationTransactionPhase =
    | 'IDLE'
    | 'PREPARE'
    | 'VALIDATE'
    | 'SNAPSHOT_CURRENT'
    | 'STAGE_MAPBOX'
    | 'VERIFY_STAGE'
    | 'COMMIT_FRONTEND'
    | 'POST_RENDER_P1'
    | 'POST_RENDER_P2'
    | 'POST_RENDER_P3'
    | 'FINALIZED'
    | 'HELD'
    | 'ROLLED_BACK'
    | 'AUTO_DISABLED'
    | 'DEGRADED_PRESENTATION';

/**
 * Frame identity for observations. P0–P3 are reserved for the future
 * transaction; PR2a-1A only ever emits 'PRODUCTION', because no transaction
 * exists to anchor a P0 against.
 */
export type PresentationFramePhase = 'PRODUCTION' | 'P0' | 'P1' | 'P2' | 'P3';

export type PresentationVisualPolicyResult = 'PASS' | 'HOLD' | 'UNPROVEN';

// ── Phase C: entry eligibility ───────────────────────────────────────────────

export interface PresentationPublishEligibilityInput {
    /** Branch the production route effect actually took. */
    entryReason: PresentationPublishEntryReason;
    /** Whether production applied the candidate. null when not observed. */
    productionApplied: boolean | null;
    sourceKeyChanged: boolean;
    displayedGeometryPointCount: number;
    candidateGeometryPointCount: number;
    candidateCoordinatesFinite: boolean;
    candidateGeneration: number;
    latestGeneration: number;
    routeVersion: number;
    routeSourceKey: number;
    /** PR1 shadow classification — recorded for disagreement only, never authority. */
    shadowTransitionType: PresentationTransitionType | null;
}

export interface PresentationPublishEligibility {
    eligible: boolean;
    reason: string;
    entryReason: PresentationPublishEntryReason;
    sameIdentity: boolean;
    initialRoute: boolean;
    mapboxReplacement: boolean;
    productionAccepted: boolean;
    duplicateOrNoop: boolean;
    heldByProduction: boolean;
    staleGeneration: boolean;
    invalidRoute: boolean;
    generation: number;
    routeVersion: number;
    routeSourceKey: number;
    /** Diagnostic only: does PR1's classifier agree with this eligibility call? */
    shadowTransitionType: PresentationTransitionType | null;
    shadowAgreesWithEligibility: boolean | null;
}

export function evaluatePresentationPublishEligibility(
    input: PresentationPublishEligibilityInput,
): PresentationPublishEligibility {
    // Only these three production branches are same-identity accepted applies.
    // Deliberately function-local: the pure model holds no module-level state.
    const ELIGIBLE_ENTRY_REASONS: PresentationPublishEntryReason[] = [
        'route_version_changed',
        'route_endpoint_changed',
        'route_body_changed',
    ];
    const sameIdentity = !input.sourceKeyChanged;
    const initialRoute = input.entryReason === 'initial_seed' || input.displayedGeometryPointCount < 2;
    const mapboxReplacement = input.entryReason === 'mapbox_replacement' || input.sourceKeyChanged;
    const duplicateOrNoop = input.entryReason === 'duplicate'
        || input.entryReason === 'tail_only_agent_movement';
    const heldByProduction = input.entryReason === 'presentation_guard_hold'
        || input.entryReason === 'body_lock_hold'
        || input.productionApplied === false;
    const staleGeneration = input.candidateGeneration < input.latestGeneration;
    const invalidRoute = input.candidateGeometryPointCount < 2 || !input.candidateCoordinatesFinite;
    const productionAccepted = input.productionApplied === true;

    let eligible = false;
    let reason: string;
    if (staleGeneration) {
        reason = 'stale_generation';
    } else if (invalidRoute) {
        reason = 'invalid_route';
    } else if (initialRoute) {
        reason = 'initial_route';
    } else if (mapboxReplacement) {
        reason = 'mapbox_replacement';
    } else if (duplicateOrNoop) {
        reason = 'duplicate_or_noop';
    } else if (heldByProduction) {
        reason = 'held_by_production';
    } else if (!ELIGIBLE_ENTRY_REASONS.includes(input.entryReason)) {
        reason = 'unknown_entry_reason';
    } else if (!productionAccepted) {
        reason = 'production_not_accepted';
    } else {
        eligible = true;
        reason = 'eligible';
    }

    // Disagreement is exported, never consumed: PR1 measured only 8/19 agreement
    // between the shadow classifier and production hold/body-lock semantics.
    const shadowSaysSameIdentityIncremental = input.shadowTransitionType === 'MT_INCREMENTAL';
    const shadowAgreesWithEligibility = input.shadowTransitionType === null
        ? null
        : shadowSaysSameIdentityIncremental === eligible;

    return {
        eligible,
        reason,
        entryReason: input.entryReason,
        sameIdentity,
        initialRoute,
        mapboxReplacement,
        productionAccepted,
        duplicateOrNoop,
        heldByProduction,
        staleGeneration,
        invalidRoute,
        generation: input.candidateGeneration,
        routeVersion: input.routeVersion,
        routeSourceKey: input.routeSourceKey,
        shadowTransitionType: input.shadowTransitionType,
        shadowAgreesWithEligibility,
    };
}

// ── Phase D: visual connection policy (V1–V4) ────────────────────────────────

export interface PresentationVisualConnectionInput {
    // V1 — directional
    candidateTrimDistanceM: number | null;
    candidateMarkerProgressM: number | null;
    // V2 — basis
    candidateTrimGeometrySignature: string | null;
    candidateGeometrySignature: string;
    // V3 — non-worsening
    candidateGapWorldM: number | null;
    displayedGapWorldM: number | null;
    candidateGapScreenPx: number | null;
    displayedGapScreenPx: number | null;
    // V4 — route-constrained experimental evidence (read-only booleans)
    integratorRouteProgressValid: boolean;
    routeBearingSourceIsRoute: boolean;
}

export interface PresentationVisualConnectionEvaluation {
    directionalValid: boolean | null;
    basisValid: boolean;
    candidateGapWorldM: number | null;
    displayedGapWorldM: number | null;
    candidateGapScreenPx: number | null;
    displayedGapScreenPx: number | null;
    worldGapComparable: boolean;
    worldGapNonWorsening: boolean | null;
    screenGapComparable: boolean;
    screenGapNonWorsening: boolean | null;
    routeConstrained: boolean;
    experimentalEligible: boolean;
    result: PresentationVisualPolicyResult;
    holdReason: string | null;
    unprovenReason: string | null;
}

/**
 * V1 directional and V2 basis are exact mathematical facts.
 * V3 compares two MEASURED quantities against each other — never against an
 * invented constant — so "do not make the picture worse" is expressible without
 * a tolerance. V4 is an existing production boolean pair.
 *
 * PASS is reserved for experimental-evidence eligibility only. A candidate whose
 * visual comparison cannot be established is UNPROVEN, never silently PASS.
 */
export function evaluatePresentationVisualConnection(
    input: PresentationVisualConnectionInput,
): PresentationVisualConnectionEvaluation {
    // V1
    const directionalValid = input.candidateTrimDistanceM === null || input.candidateMarkerProgressM === null
        ? null
        : input.candidateTrimDistanceM <= input.candidateMarkerProgressM;

    // V2
    const basisValid = input.candidateTrimGeometrySignature !== null
        && input.candidateTrimGeometrySignature === input.candidateGeometrySignature;

    // V3 world
    const worldGapComparable = input.candidateGapWorldM !== null && input.displayedGapWorldM !== null;
    const worldGapNonWorsening = worldGapComparable
        ? (input.candidateGapWorldM as number) <= (input.displayedGapWorldM as number)
        : null;

    // V3 screen
    const screenGapComparable = input.candidateGapScreenPx !== null && input.displayedGapScreenPx !== null;
    const screenGapNonWorsening = screenGapComparable
        ? (input.candidateGapScreenPx as number) <= (input.displayedGapScreenPx as number)
        : null;

    // V4
    const routeConstrained = input.integratorRouteProgressValid && input.routeBearingSourceIsRoute;

    let holdReason: string | null = null;
    if (directionalValid === null) holdReason = 'directional_not_computable';
    else if (directionalValid === false) holdReason = 'route_head_ahead_of_marker';
    else if (!basisValid) holdReason = 'trim_basis_signature_mismatch';
    else if (worldGapNonWorsening === false) holdReason = 'world_gap_worsens';
    else if (screenGapNonWorsening === false) holdReason = 'screen_gap_worsens';

    let unprovenReason: string | null = null;
    if (holdReason === null) {
        if (!worldGapComparable) unprovenReason = 'world_gap_not_comparable';
        else if (!screenGapComparable) unprovenReason = 'screen_gap_not_comparable';
        else if (!routeConstrained) unprovenReason = 'not_route_constrained';
    }

    const experimentalEligible = holdReason === null
        && unprovenReason === null
        && directionalValid === true
        && basisValid
        && worldGapNonWorsening === true
        && screenGapNonWorsening === true
        && routeConstrained;

    const result: PresentationVisualPolicyResult = holdReason !== null
        ? 'HOLD'
        : (experimentalEligible ? 'PASS' : 'UNPROVEN');

    return {
        directionalValid,
        basisValid,
        candidateGapWorldM: input.candidateGapWorldM,
        displayedGapWorldM: input.displayedGapWorldM,
        candidateGapScreenPx: input.candidateGapScreenPx,
        displayedGapScreenPx: input.displayedGapScreenPx,
        worldGapComparable,
        worldGapNonWorsening,
        screenGapComparable,
        screenGapNonWorsening,
        routeConstrained,
        experimentalEligible,
        result,
        holdReason,
        unprovenReason,
    };
}

// ── Phase E: rollback snapshot completeness ──────────────────────────────────

export interface PresentationRollbackSnapshotInput {
    previousGeometrySignature: string | null;
    previousRoutePointCount: number | null;
    previousTrimNormalized: number | null;
    previousTrimDistanceM: number | null;
    previousTrimBasisSignature: string | null;
    previousRouteLayerTrim: number[] | null;
    previousCasingLayerTrim: number[] | null;
    previousMotionRouteVersion: number | null;
    previousRouteSourceSignature: string | null;
    previousRouteBodySignature: string | null;
    previousRouteVersion: number | null;
    /**
     * PR2a-1A.6 correction 1: a signature plus a point count is NOT enough to
     * restore a route. A future transaction that calls setData() must be able to
     * put the PREVIOUS geometry back, so the model has to state explicitly
     * whether that geometry exists at all.
     *
     * `previousSourceGeometryAvailable` — the caller holds the previous geometry
     * (e.g. the still-unmodified stable route ref) and could pass it to a restore.
     * `previousSourceGeometryReadable` — the geometry can additionally be read
     * back off the live Mapbox source, so a restore could be verified.
     *
     * Both are booleans by design: the pure model never stores geometry and
     * never snapshots runtime data — it only models whether the snapshot exists.
     */
    previousSourceGeometryAvailable: boolean;
    previousSourceGeometryReadable: boolean;
    sourceSnapshotReadable: boolean;
    routeLayerSnapshotReadable: boolean;
    casingLayerSnapshotReadable: boolean;
}

export interface PresentationRollbackSnapshotModel extends PresentationRollbackSnapshotInput {
    complete: boolean;
    missingFields: string[];
    /**
     * Diagnostic only in PR2a-1A. A future transaction must refuse to mutate
     * Mapbox at all when this is false: mutating without a restorable snapshot
     * would be an irreversible partial mutation.
     */
    mutationAllowedInFutureTransaction: boolean;
}

export function evaluateRollbackSnapshotCompleteness(
    input: PresentationRollbackSnapshotInput,
): PresentationRollbackSnapshotModel {
    const missingFields: string[] = [];
    const requireValue = (value: unknown, name: string) => {
        if (value === null || value === undefined) missingFields.push(name);
    };
    requireValue(input.previousGeometrySignature, 'previousGeometrySignature');
    requireValue(input.previousRoutePointCount, 'previousRoutePointCount');
    requireValue(input.previousTrimNormalized, 'previousTrimNormalized');
    requireValue(input.previousTrimDistanceM, 'previousTrimDistanceM');
    requireValue(input.previousTrimBasisSignature, 'previousTrimBasisSignature');
    requireValue(input.previousRouteLayerTrim, 'previousRouteLayerTrim');
    requireValue(input.previousCasingLayerTrim, 'previousCasingLayerTrim');
    requireValue(input.previousMotionRouteVersion, 'previousMotionRouteVersion');
    requireValue(input.previousRouteSourceSignature, 'previousRouteSourceSignature');
    requireValue(input.previousRouteBodySignature, 'previousRouteBodySignature');
    requireValue(input.previousRouteVersion, 'previousRouteVersion');
    // Correction 1: geometry presence is a first-class rollback requirement.
    // Without it a restore could not put the previous route back, so signature
    // and point count alone must never be treated as sufficient.
    if (!input.previousSourceGeometryAvailable) missingFields.push('previousSourceGeometryAvailable');
    if (!input.previousSourceGeometryReadable) missingFields.push('previousSourceGeometryReadable');
    if (!input.sourceSnapshotReadable) missingFields.push('sourceSnapshotReadable');
    if (!input.routeLayerSnapshotReadable) missingFields.push('routeLayerSnapshotReadable');
    if (!input.casingLayerSnapshotReadable) missingFields.push('casingLayerSnapshotReadable');

    const complete = missingFields.length === 0;
    return {
        ...input,
        complete,
        missingFields,
        mutationAllowedInFutureTransaction: complete,
    };
}

// ── Phase F: P0/P1/P2/P3 frame observation model ─────────────────────────────

/**
 * Structural equality for a Mapbox `line-trim-offset` value. Object identity is
 * explicitly NOT used: Mapbox may return a different array instance holding the
 * same numbers.
 */
export function trimOffsetEquals(a: number[] | null, b: number[] | null): boolean {
    if (a === null || b === null) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (typeof a[i] !== 'number' || typeof b[i] !== 'number') return false;
        if (a[i] !== b[i]) return false;
    }
    return true;
}

export interface PresentationFrameObservation {
    framePhase: PresentationFramePhase;
    frameNumber: number;
    timestamp: number;
    intendedSourceSignature: string | null;
    actualSourceSignature: string | null;
    stableRefSignature: string | null;
    reactDisplayedSignature: string | null;
    intendedTrimNormalized: number | null;
    routeLayerTrim: number[] | null;
    casingLayerTrim: number[] | null;
    trimBasisSignature: string | null;
    geometryTrimBasisMismatch: boolean;
    layerTrimMismatch: boolean;
    routeHeadGapWorldM: number | null;
    routeHeadGapScreenPx: number | null;
    markerLng: number | null;
    markerLat: number | null;
    markerMovementFromP0M: number | null;
    /**
     * Caller-supplied. Deliberately not derived from markerMovementFromP0M,
     * because no calibrated steady-state noise bound exists yet.
     */
    markerMovementExceedsSteadyStateNoise: boolean | null;
    migrationAttempted: boolean | null;
    migrationSucceeded: boolean | null;
    migrationDistanceM: number | null;
    cameraBearingDeltaDeg: number | null;
    sourceSignatureChangedSincePreviousFrame: boolean | null;
    trimChangedSincePreviousFrame: boolean | null;
    /** True when the painted trim went back to the pre-publish value. */
    oldTrimRestored: boolean | null;
    sourceMissing: boolean;
    routeLayerMissing: boolean;
    casingLayerMissing: boolean;
    rollbackIncomplete: boolean;
    hardMismatch: boolean;
    mismatchReason: string | null;
}

export type PresentationFrameObservationDraft =
    Omit<PresentationFrameObservation, 'hardMismatch' | 'mismatchReason'>;

export interface PresentationMismatchClassification {
    hardMismatch: boolean;
    mismatchReason: string | null;
    softMismatches: string[];
}

export function classifyPresentationMismatch(
    observation: PresentationFrameObservationDraft,
): PresentationMismatchClassification {
    // PR2a-1A.6 correction 2: a missing source/layer is only a *failure* when a
    // publish was actually intended. PR2a-1A observes PRODUCTION frames, where no
    // transaction exists — there the same reading is merely unavailable evidence
    // (the map may simply not be ready yet), not a hard mismatch.
    const isIntendedTransactionFrame = observation.framePhase !== 'PRODUCTION';
    const anyMissing = observation.sourceMissing
        || observation.routeLayerMissing
        || observation.casingLayerMissing;

    let hardReason: string | null = null;
    if (observation.layerTrimMismatch) hardReason = 'layer_trim_mismatch';
    else if (observation.geometryTrimBasisMismatch) hardReason = 'geometry_trim_basis_mismatch';
    else if (
        observation.intendedSourceSignature !== null
        && observation.actualSourceSignature !== null
        && observation.intendedSourceSignature !== observation.actualSourceSignature
    ) hardReason = 'unexpected_source_signature';
    else if (observation.oldTrimRestored === true) hardReason = 'old_trim_restored';
    else if (observation.markerMovementExceedsSteadyStateNoise === true) hardReason = 'marker_moved_unexpectedly';
    else if (isIntendedTransactionFrame && anyMissing) {
        hardReason = 'missing_source_or_layer';
    } else if (observation.rollbackIncomplete) hardReason = 'rollback_incomplete';

    const softMismatches: string[] = [];
    if (!isIntendedTransactionFrame && anyMissing) {
        // Unavailable evidence on a PRODUCTION frame — recorded, never fatal.
        if (observation.sourceMissing) softMismatches.push('source_unavailable');
        if (observation.routeLayerMissing) softMismatches.push('route_layer_unavailable');
        if (observation.casingLayerMissing) softMismatches.push('casing_layer_unavailable');
    }
    if (observation.intendedSourceSignature !== null
        && observation.reactDisplayedSignature !== null
        && observation.reactDisplayedSignature !== observation.intendedSourceSignature) {
        softMismatches.push('react_signature_lagging');
    }
    if (observation.actualSourceSignature === null) softMismatches.push('source_signature_unavailable');
    if (observation.routeHeadGapScreenPx === null) softMismatches.push('screen_projection_unavailable');
    if (observation.cameraBearingDeltaDeg !== null && observation.cameraBearingDeltaDeg !== 0) {
        // Camera is explicitly NOT part of PR2a success criteria.
        softMismatches.push('camera_bearing_delta_present');
    }

    return { hardMismatch: hardReason !== null, mismatchReason: hardReason, softMismatches };
}

export function comparePresentationFrameObservation(
    previous: PresentationFrameObservation | null,
    current: PresentationFrameObservationDraft,
): { sourceSignatureChanged: boolean | null; trimChanged: boolean | null } {
    if (!previous) return { sourceSignatureChanged: null, trimChanged: null };
    const sourceSignatureChanged = previous.actualSourceSignature === null || current.actualSourceSignature === null
        ? null
        : previous.actualSourceSignature !== current.actualSourceSignature;
    const trimChanged = previous.routeLayerTrim === null || current.routeLayerTrim === null
        ? null
        : !trimOffsetEquals(previous.routeLayerTrim, current.routeLayerTrim);
    return { sourceSignatureChanged, trimChanged };
}

export interface PresentationPostRenderSequenceSummary {
    observedPhases: PresentationFramePhase[];
    anyHardMismatch: boolean;
    firstHardMismatchPhase: PresentationFramePhase | null;
    firstHardMismatchReason: string | null;
    reactSignatureConvergedAtPhase: PresentationFramePhase | null;
    oldTrimRestoredAtPhase: PresentationFramePhase | null;
    sequenceComplete: boolean;
}

export function evaluatePresentationPostRenderSequence(
    frames: PresentationFrameObservation[],
): PresentationPostRenderSequenceSummary {
    // P3 is part of the model so late source parsing / late React commits are
    // visible. Function-local: the pure model holds no module-level state.
    const REQUIRED_POST_RENDER_PHASES: PresentationFramePhase[] = ['P0', 'P1', 'P2', 'P3'];
    const observedPhases = frames.map((f) => f.framePhase);
    let firstHardMismatchPhase: PresentationFramePhase | null = null;
    let firstHardMismatchReason: string | null = null;
    let reactSignatureConvergedAtPhase: PresentationFramePhase | null = null;
    let oldTrimRestoredAtPhase: PresentationFramePhase | null = null;

    for (const frame of frames) {
        if (frame.hardMismatch && firstHardMismatchPhase === null) {
            firstHardMismatchPhase = frame.framePhase;
            firstHardMismatchReason = frame.mismatchReason;
        }
        if (reactSignatureConvergedAtPhase === null
            && frame.intendedSourceSignature !== null
            && frame.reactDisplayedSignature === frame.intendedSourceSignature) {
            reactSignatureConvergedAtPhase = frame.framePhase;
        }
        if (oldTrimRestoredAtPhase === null && frame.oldTrimRestored === true) {
            oldTrimRestoredAtPhase = frame.framePhase;
        }
    }

    const sequenceComplete = REQUIRED_POST_RENDER_PHASES.every((p) => observedPhases.includes(p));
    return {
        observedPhases,
        anyHardMismatch: firstHardMismatchPhase !== null,
        firstHardMismatchPhase,
        firstHardMismatchReason,
        reactSignatureConvergedAtPhase,
        oldTrimRestoredAtPhase,
        sequenceComplete,
    };
}

// ── Phase G: degraded presentation model ─────────────────────────────────────

export interface PresentationDegradedInput {
    /** Would the coherent transaction hold this candidate? */
    coherentTransactionWouldHold: boolean;
    /** Does the route currently on screen still reach the current Target? */
    displayedRouteStillReachesTarget: boolean | null;
    holdReason: string | null;
    endpointDriftM: number | null;
    consecutiveHoldCount: number;
    heldDurationMs: number | null;
    superseded: boolean;
}

export interface PresentationDegradedEvaluation extends PresentationDegradedInput {
    /**
     * True when holding would preserve visual coherence at the cost of
     * navigational correctness. A future transaction would then abandon the hold
     * and allow the existing production publication path, accepting the original
     * visual gap. PR2a-1A only models this — it never triggers a fallback.
     */
    degradedPresentationWouldBeRequired: boolean;
    degradedReason: string | null;
}

export function evaluateDegradedPresentation(
    input: PresentationDegradedInput,
): PresentationDegradedEvaluation {
    const degradedPresentationWouldBeRequired = input.coherentTransactionWouldHold
        && input.displayedRouteStillReachesTarget === false;
    return {
        ...input,
        degradedPresentationWouldBeRequired,
        degradedReason: degradedPresentationWouldBeRequired
            ? 'displayed_route_no_longer_reaches_target'
            : null,
    };
}
