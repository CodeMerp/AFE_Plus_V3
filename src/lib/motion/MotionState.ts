// MotionState — Sprint M0.5 / M1 / M1.5R
// Single source of truth for the presentation layer.
// M0.5A: shadow-written from existing refs (no behavior change).
// M1+:   will become authoritative; existing refs removed incrementally.
// M1.5R: replaces exponential lerp with velocity-maintaining integrator.

export type LatLngPoint = { lat: number; lng: number };

export interface MotionState {
    // ── GPS layer (raw input) ──────────────────────────────────────────────────
    rawGpsPosition:      LatLngPoint; // latest accepted GPS fix
    rawGpsAccuracyM:     number;      // horizontal accuracy (m); 0 = unknown
    lastGpsAt:           number;      // performance.now() when last GPS sample arrived
    gpsAge:              number;      // ms since lastGpsAt — updated each rAF frame

    // ── Projected layer (road truth) ──────────────────────────────────────────
    projectedPosition:    LatLngPoint; // rawGpsPosition snapped to route
    projectionDistanceM:  number;      // GPS-to-route distance (quality signal)
    projectionSegmentIdx: number;      // current locked route segment (-1 = none)
    isProjected:          boolean;     // false = off-route, visual uses fallback

    // ── Integrator layer (M1.5R — velocity-maintaining motion) ────────────────
    integratorPosition:           LatLngPoint; // current output position (feeds marker visual)
    integratorVelocityMps:        number;      // current speed magnitude (m/s), always >= 0
    integratorBearingDeg:         number;      // current direction of travel (°)
    integratorTargetPosition:     LatLngPoint; // latest snappedAgentTarget (projection output)
    integratorTargetDistanceM:    number;      // dist(integratorPosition, integratorTargetPosition)
    integratorDesiredSpeedMps:    number;      // desired speed this frame
    integratorLastTargetUpdateAt: number;      // performance.now() when target last changed
    integratorIsSettled:          boolean;     // true when velocity ≈ 0 AND dist < epsilon
    integratorMode:               string;      // "stopped" | "accel" | "cruise" | "decel"
    // M1.5R-B: route-constrained fields
    integratorRouteProgressM:     number;      // current integrator progress along route polyline (m)
    integratorTargetProgressM:    number;      // target progress along route polyline (m)
    integratorRouteProgressValid: boolean;     // false = no valid route projection yet, use Euclidean fallback
    integratorRouteBearingSource: string;      // "route" | "euclidean"
    // M1.5R-D1: motion dynamics fields
    integratorAccelMps2:      number;  // current acceleration (m/s²), signed
    integratorAngularVelDegS: number;  // current heading rotation rate (°/s)
    // M1.5R-D2: turn dynamics diagnostics
    integratorTurnHeadingDeltaDeg: number;  // |bearing(progress+5m) - current bearing| (°)
    integratorTurnPhase:           string;  // 'STRAIGHT' | 'TURNING'

    // ── Camera layer (M2-A) ──────────────────────────────────────────────────
    cameraBearingSource: string;  // 'integrator' | RouteUpBearingSource values

    // ── Visual layer (presentation truth) ─────────────────────────────────────
    visualPosition:       LatLngPoint; // integrator output — what agent marker renders
    visualMarkerBearing:  number;      // smoothly lerped marker arrow heading (°)
    targetMarkerBearing:  number;      // route tangent bearing target for lerp (°)

    // ── Camera layer ──────────────────────────────────────────────────────────
    visualCameraCenter:   LatLngPoint; // smoothly lerped camera center (with lookAhead)
    visualCameraBearing:  number;      // smoothly lerped camera heading (°)
    targetCameraBearing:  number;      // route-up bearing target for camera lerp (°)

    // ── Qualitative signals ────────────────────────────────────────────────────
    isStationary:         boolean;     // GPS speed < 0.5 m/s
    isTurning:            boolean;     // bearing delta > CAMERA_TURN_DEAD_ZONE_DEG
    hasMovementDetected:  boolean;     // camera has entered navigation_follow mode

    // ── Frame timing ──────────────────────────────────────────────────────────
    lastFrameAt:          number;      // performance.now() of most recent rAF frame
}

export function createInitialMotionState(initialPosition: LatLngPoint): MotionState {
    return {
        rawGpsPosition:      initialPosition,
        rawGpsAccuracyM:     0,
        lastGpsAt:           0,
        gpsAge:              0,

        projectedPosition:    initialPosition,
        projectionDistanceM:  0,
        projectionSegmentIdx: -1,
        isProjected:          false,

        integratorPosition:           initialPosition,
        integratorVelocityMps:        0,
        integratorBearingDeg:         0,
        integratorTargetPosition:     initialPosition,
        integratorTargetDistanceM:    0,
        integratorDesiredSpeedMps:    0,
        integratorLastTargetUpdateAt: 0,
        integratorIsSettled:          true,
        integratorMode:               'stopped',
        integratorRouteProgressM:     0,
        integratorTargetProgressM:    0,
        integratorRouteProgressValid: false,
        integratorRouteBearingSource: 'euclidean',
        integratorAccelMps2:      0,
        integratorAngularVelDegS: 0,
        integratorTurnHeadingDeltaDeg: 0,
        integratorTurnPhase:           'STRAIGHT',

        cameraBearingSource: 'fallback',

        visualPosition:       initialPosition,
        visualMarkerBearing:  0,
        targetMarkerBearing:  0,

        visualCameraCenter:   initialPosition,
        visualCameraBearing:  0,
        targetCameraBearing:  0,

        isStationary:         true,
        isTurning:            false,
        hasMovementDetected:  false,

        lastFrameAt:          0,
    };
}
