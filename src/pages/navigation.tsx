import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Map, { Marker, MapRef, Source, Layer, type ViewStateChangeEvent } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Layers, Navigation as NavIcon, Volume2, VolumeX } from 'lucide-react';
import { NavigationProvider, useNavigation } from '@/hooks/useNavigation';
import { AdaptivePollingService } from '@/services/pollingService';
import CustomCompass from '@/components/CustomCompass';
import { hasRouteTrimGeometryBasisChanged, shouldApplyRouteTrimPaint } from '@/lib/presentation/routeTrimRebaseModel';
import { createInitialMotionState, type MotionState } from '@/lib/motion/MotionState';

type LatLngPoint = { lat: number; lng: number };

// SOURCE_COPY_TRIM_COMPUTATION — ported from
// afe-navigation-frontend-production/app/navigation/page.tsx:459-464,509-516.
type RouteProjection = {
  projectedPoint: LatLngPoint;
  segmentIndex: number;
  distanceM: number;
  t: number;
};

type RouteTrimProgress = {
  progress: number;
  distanceAlongRouteM: number;
  distanceM: number;
  segmentIndex: number;
  projectedPoint: LatLngPoint;
  totalLengthM: number;
};

// SOURCE_COPY_MOTION_TYPE_HELPER — ported from page.tsx:466-498. Diagnostics-only
// fields (`ProjectionStableTrace` and its 'trace' consumers) are omitted per
// Phase 5C-10 Blocker A resolution (page.tsx:855-1002 audit) — proven
// write-only, never influencing selection.
type StableProjectionSource =
  | 'initial_full_scan'
  | 'window_scan'
  | 'full_scan_recovery'
  | 'hysteresis_keep_previous'
  | 'fallback_raw';

type BacktrackClampDiag = {
  originalT: number;
  clampedT: number;
  maxBacktrackM: number;
  segmentLengthM: number;
};

type StableRouteProjection = RouteProjection & {
  source: StableProjectionSource;
  changedSegment: boolean;
  backtrackClamped?: BacktrackClampDiag;
};

type ProjectionLock = StableRouteProjection & {
  routeVersion: number;
  routePathLen: number;
  lastUpdatedAt: number;
};

type RouteTailAnchor = {
  point: LatLngPoint;
  segmentIndex: number;
  routeVersion: number;
  routePathLen: number;
  updatedAt: number;
  source: 'visual_projection';
};

type RouteUpBearingSource =
  | 'locked_projection_segment'
  | 'rendered_route_tangent'
  | 'path_start_tangent'
  | 'wrong_way_movement_bearing'
  | 'gps'
  | 'fallback'
  | 'integrator';

type RouteGeometryBearingCandidate = {
  bearing: number;
  source: RouteUpBearingSource;
  segmentIndex?: number;
  from?: LatLngPoint;
  to?: LatLngPoint;
};

// SOURCE_COPY_CAMERA_STATE_REF — camera/marker-bearing types ported from
// page.tsx:431-441,480-486,1099-1100.
type MarkerBearingSource = 'gps' | 'route_tangent' | 'movement_bearing' | 'wrong_way_movement_bearing' | 'fallback';

type StableMarkerBearingInfo = {
  bearing: number;
  source: MarkerBearingSource;
  segmentIndex: number | null;
  rawBearing: number;
  delta: number;
  skippedSmallDelta: boolean;
};

type PendingTouchGesture = {
  active: boolean;
  startX: number;
  startY: number;
  startTime: number;
  touchCount: number;
};

type CameraMode = 'top_down' | 'navigation_follow';

type NavigationQueryIdentity = {
  usersId: number;
  takecareId: number;
  idlocation: string | null;
  auToken: string | null;
};

type NavigationQueryResult =
  | {
      ok: true;
      value: NavigationQueryIdentity;
    }
  | {
      ok: false;
      error: string;
    };

const NAVIGATION_QUERY_ERROR = 'ข้อมูลผู้ใช้งานสำหรับการนำทางไม่ถูกต้อง';
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
const TOP_DOWN_ZOOM = 16;

// SOURCE_COPY_TRIM_COMPUTATION — ported verbatim from page.tsx:81,139,177.
const NAV_DEBUG = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_NAV_DEBUG === 'true';
const ROUTE_TRIM_MAX_PROJECTION_DIST_M = 12; // marker must project close to stable route source before trim advances
const ROUTE_LINE_LAYER_IDS = ['route-line-casing', 'route-line'] as const;

// SOURCE_COPY_MOTION_TYPE_HELPER — production constants ported exact-value from
// page.tsx:118-183 (values unchanged, units unchanged, no renaming/consolidation).
const AGENT_PROJECTION_MAX_DIST_M = 50;
const AGENT_PROJECTION_RECOVERY_DIST_M = 30;
const AGENT_PROJECTION_SWITCH_MARGIN_M = 5;
const AGENT_PROJECTION_BACKTRACK_LIMIT = 1;
const AGENT_PROJECTION_WINDOW_BACK = 3;
const AGENT_PROJECTION_WINDOW_FORWARD = 8;
const PROJECTION_POOR_FIT_DIST_M = 20;
const PROJECTION_FORCE_FULL_SCAN_DIST_M = 35;
const PROJECTION_POOR_FIT_MAX_COUNT = 3;
const MAX_BACKTRACK_M = 2.0;
const DISPLAY_AGENT_MIN_MOVE_M = 0.75;
const VISUAL_AGENT_FAST_CATCHUP_DIST_M = 25;
const VISUAL_AGENT_MAX_SPEED_MPS = 45;
const ROUTE_TAIL_ANCHOR_UPDATE_INTERVAL_MS = 125;
const ROUTE_TAIL_ANCHOR_MIN_MOVE_M = 0.75;
const ROUTE_TAIL_ANCHOR_MAX_PROJECTION_DIST_M = 12;
const ROUTE_TRIM_PAINT_INTERVAL_MS = 100;
const ROUTE_TRIM_MIN_ADVANCE_M = 2;
const ROUTE_TRIM_MIN_PROGRESS_DELTA = 0.00001;
const MIN_ROUTE_PRESENTATION_PTS = 5;
const ROUTE_SHRINK_HOLD_RATIO = 0.30;
const WRONG_WAY_MOVEMENT_MIN_M = 1.25;
const WRONG_WAY_SPEED_MIN_MPS = 0.8;
const WRONG_WAY_DETECT_DELTA_DEG = 120;
const WRONG_WAY_CLEAR_DELTA_DEG = 80;
const WRONG_WAY_TICKS_REQUIRED = 2;
const MOVEMENT_ACCURACY_MAX_M = 30;
const INTEGRATOR_DECEL_WINDOW_SEC = 0.3;
const INTEGRATOR_EPSILON_M = 0.15;
const INTEGRATOR_STOP_SPEED_MPS = 0.3;
const INTEGRATOR_STALE_GPS_SEC = 2.0;
const INTEGRATOR_EXPECTED_GPS_INTERVAL_SEC = 1.0;
const INTEGRATOR_MAX_SPEED_MPS = VISUAL_AGENT_MAX_SPEED_MPS;
const INTEGRATOR_MAX_ACCEL_MPS2 = 5.0;
const INTEGRATOR_MAX_DECEL_MPS2 = 8.0;
const INTEGRATOR_MAX_ANGULAR_VEL_DEG_S = 80.0;
const INTEGRATOR_CRUISE_HYSTERESIS_MPS = 0.3;
const INTEGRATOR_TURN_LOOKAHEAD_M = 5.0;
const INTEGRATOR_TURN_DETECT_DEG = 10.0;
const PATIENT_MARKER_DEAD_ZONE_M = 4;
const PATIENT_MARKER_INTERP_ALPHA = 0.2;
const PATIENT_MARKER_MAX_JUMP_M = 25;
const MARKER_BEARING_VISUAL_DEAD_ZONE_DEG = 1.5;
const MARKER_BEARING_SMOOTH_TIME_MS = 300;
const NAV_ARRIVAL_NEAR_THRESHOLD_M = 50;
const NAV_ARRIVAL_REACHED_THRESHOLD_M = 5;
const ROUTE_BODY_LOCK_MIN_VISIBLE_PTS = 8;
const ROUTE_BODY_LOCK_ENDPOINT_DELTA_M = 10;
const ROUTE_SOURCE_ENDPOINT_MOVE_M = 1.0;

// SOURCE_COPY_CAMERA_STATE_REF — camera constants ported exact-value from
// page.tsx:105-117,130-156 (values unchanged, no renaming/consolidation).
const NAV_FOLLOW_PITCH = 65;
const NAV_FOLLOW_ZOOM = 18;
const LOOK_AHEAD_M = 120;
const CAMERA_NAV_BOTTOM_PAD_PX = 300;
const CAMERA_LOOKAHEAD_LOG_INTERVAL_MS = 1000;
const CAMERA_TURN_SMOOTH_TIME_MS = 300;
const CAMERA_TURN_DEAD_ZONE_DEG = 0.75;
const USER_GESTURE_MOVE_THRESHOLD_PX = 10;
const CAMERA_CENTER_SMOOTH_TIME_MS = 150;
const CAMERA_CENTER_EPSILON_M = 0.3;
const CAMERA_CENTER_SNAP_DIST_M = 50;
const SOFT_FOLLOW_DURATION_MS = 2500;
const MOVEMENT_DISTANCE_THRESHOLD_M = 15;
const MOVEMENT_CONSECUTIVE_REQUIRED = 2;

function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// SOURCE_COPY_MOTION_TYPE_HELPER — ported verbatim from page.tsx:290-295.
function shortestBearingDelta(from: number, to: number): number {
  let delta = normalizeBearing(to) - normalizeBearing(from);
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

// SOURCE_COPY_MOTION_TYPE_HELPER — ported verbatim from page.tsx:307-313.
function bearingBetween(from: LatLngPoint, to: LatLngPoint): number {
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const x = Math.sin(dLng) * Math.cos(lat2);
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeBearing(Math.atan2(x, y) * 180 / Math.PI);
}

// SOURCE_COPY_MOTION_TYPE_HELPER — ported verbatim from page.tsx:421-428.
function computeBearingBetween(from: LatLngPoint, to: LatLngPoint): number {
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const deltaLng = (to.lng - from.lng) * Math.PI / 180;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return normalizeBearing(Math.atan2(y, x) * 180 / Math.PI);
}

// SOURCE_COPY_MOTION_TYPE_HELPER — ported verbatim from page.tsx:317-331.
function computeRouteProgressFromProjection(
  segmentIndex: number,
  t: number,
  routePath: LatLngPoint[],
): number {
  let distanceBeforeSegmentM = 0;
  let projectedSegmentLengthM = 0;
  for (let i = 0; i < routePath.length - 1; i++) {
    const segmentLengthM = distanceMeters(routePath[i], routePath[i + 1]);
    if (!Number.isFinite(segmentLengthM) || segmentLengthM <= 0) continue;
    if (i < segmentIndex) distanceBeforeSegmentM += segmentLengthM;
    if (i === segmentIndex) projectedSegmentLengthM = segmentLengthM;
  }
  return distanceBeforeSegmentM + projectedSegmentLengthM * t;
}

// SOURCE_COPY_MOTION_TYPE_HELPER — ported verbatim from page.tsx:343-365.
function sampleRouteAtDistance(
  routePath: LatLngPoint[],
  distanceM: number,
): { position: LatLngPoint; bearing: number; segmentIndex: number } | null {
  if (routePath.length < 2) return null;
  let remaining = Math.max(0, distanceM);
  for (let i = 0; i < routePath.length - 1; i++) {
    const a = routePath[i];
    const b = routePath[i + 1];
    const segLen = distanceMeters(a, b);
    if (!Number.isFinite(segLen) || segLen <= 0) continue;
    if (remaining <= segLen || i === routePath.length - 2) {
      const t = segLen > 0 ? Math.max(0, Math.min(1, remaining / segLen)) : 0;
      const position: LatLngPoint = {
        lat: a.lat + t * (b.lat - a.lat),
        lng: a.lng + t * (b.lng - a.lng),
      };
      const bearing = computeBearingBetween(a, b);
      return { position, bearing, segmentIndex: i };
    }
    remaining -= segLen;
  }
  return null;
}

// SOURCE_COPY_PROJECTION_CORE — ported verbatim from page.tsx:617-629.
function withProjectionSource(
  proj: RouteProjection,
  previous: ProjectionLock | null,
  source: StableProjectionSource,
  backtrackClamped?: BacktrackClampDiag,
): StableRouteProjection {
  return {
    ...proj,
    source,
    changedSegment: previous ? proj.segmentIndex !== previous.segmentIndex : true,
    backtrackClamped,
  };
}

// SOURCE_COPY_CAMERA_STATE_REF — ported verbatim from page.tsx:402-418.
function computeLookAheadCenter(agentPos: LatLngPoint, bearingDeg: number, lookAheadM: number): LatLngPoint {
  const earthRadiusM = 6371000;
  const angularDistance = lookAheadM / earthRadiusM;
  const bearing = (normalizeBearing(bearingDeg) * Math.PI) / 180;
  const lat1 = (agentPos.lat * Math.PI) / 180;
  const lng1 = (agentPos.lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance)
    + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );

  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

// SOURCE_COPY_PROJECTION_CORE — ported from page.tsx:855-1002. AUTHORIZED_
// CAMERA_DEBUG_SHADOW_OMISSION: source's optional `trace?: ProjectionStableTrace
// | null` parameter and its `if (trace) {...}` branches are omitted — proven
// write-only diagnostics per source's own comment ("the helper never reads it,
// so no selection can depend on whether tracing is enabled"), confirmed during
// Phase 5C-10 Blocker A resolution. Selection logic, thresholds, and return
// value are otherwise unchanged.
function projectPointToRouteStable(
  point: LatLngPoint,
  routePath: LatLngPoint[],
  previous: ProjectionLock | null,
  routeVersion: number,
): StableRouteProjection | null {
  if (routePath.length < 2) return null;

  const routeChanged = !previous
    || previous.routeVersion !== routeVersion
    || previous.routePathLen !== routePath.length;

  if (routeChanged) {
    const initial = projectPointToRoute(point, routePath);
    return initial ? withProjectionSource(initial, previous, 'initial_full_scan') : null;
  }

  const lastSegmentIndex = routePath.length - 2;
  const prevSegment = Math.min(Math.max(previous.segmentIndex, 0), lastSegmentIndex);
  const windowStart = Math.max(0, prevSegment - AGENT_PROJECTION_WINDOW_BACK);
  const windowEnd = Math.min(lastSegmentIndex, prevSegment + AGENT_PROJECTION_WINDOW_FORWARD);
  const windowCandidate = projectPointToRouteRange(point, routePath, windowStart, windowEnd);
  const previousSegmentCandidate = projectPointToRouteRange(point, routePath, prevSegment, prevSegment);

  if (!windowCandidate) {
    const recovered = projectPointToRoute(point, routePath);
    return recovered ? withProjectionSource(recovered, previous, 'full_scan_recovery') : null;
  }

  let candidate = windowCandidate;
  let source: StableProjectionSource = 'window_scan';
  let backtrackClampedDiag: BacktrackClampDiag | undefined;

  const isLargeBackwardJump = candidate.segmentIndex < previous.segmentIndex - AGENT_PROJECTION_BACKTRACK_LIMIT;
  if (isLargeBackwardJump && previousSegmentCandidate && previousSegmentCandidate.distanceM <= AGENT_PROJECTION_RECOVERY_DIST_M) {
    candidate = previousSegmentCandidate;
    source = 'hysteresis_keep_previous';
  }

  const isSameSegmentBacktrack = candidate.segmentIndex === previous.segmentIndex && candidate.t < previous.t - 0.05;
  if (isSameSegmentBacktrack && previousSegmentCandidate && previousSegmentCandidate.distanceM <= AGENT_PROJECTION_RECOVERY_DIST_M) {
    const a = routePath[previous.segmentIndex];
    const b = routePath[previous.segmentIndex + 1];
    const cosLat = Math.cos(point.lat * Math.PI / 180);
    const segLenM = Math.sqrt(
      Math.pow((b.lat - a.lat) * 111320, 2) +
      Math.pow((b.lng - a.lng) * 111320 * cosLat, 2),
    );
    const maxBacktrackT = segLenM > 0.5 ? MAX_BACKTRACK_M / segLenM : MAX_BACKTRACK_M;
    const originalT = candidate.t;
    const lockedT = Math.max(candidate.t, previous.t - maxBacktrackT);
    if (lockedT > originalT) {
      backtrackClampedDiag = { originalT, clampedT: lockedT, maxBacktrackM: MAX_BACKTRACK_M, segmentLengthM: segLenM };
    }
    candidate = {
      projectedPoint: {
        lat: a.lat + lockedT * (b.lat - a.lat),
        lng: a.lng + lockedT * (b.lng - a.lng),
      },
      segmentIndex: previous.segmentIndex,
      distanceM: previousSegmentCandidate.distanceM,
      t: lockedT,
    };
    source = 'hysteresis_keep_previous';
  }

  if (candidate.distanceM > AGENT_PROJECTION_RECOVERY_DIST_M) {
    const fullScan = projectPointToRoute(point, routePath);
    if (fullScan) {
      const isForwardWindow = fullScan.segmentIndex > previous.segmentIndex
        && fullScan.segmentIndex <= previous.segmentIndex + AGENT_PROJECTION_WINDOW_FORWARD;
      const isClearlyBetter = fullScan.distanceM + AGENT_PROJECTION_SWITCH_MARGIN_M < candidate.distanceM;
      const isLockedVeryBad = candidate.distanceM > AGENT_PROJECTION_RECOVERY_DIST_M;

      if (isForwardWindow || isClearlyBetter || isLockedVeryBad) {
        candidate = fullScan;
        source = 'full_scan_recovery';
        backtrackClampedDiag = undefined;
      } else if (previousSegmentCandidate) {
        candidate = previousSegmentCandidate;
        source = 'hysteresis_keep_previous';
      }
    }
  }

  return withProjectionSource(candidate, previous, source, backtrackClampedDiag);
}

// SOURCE_COPY_TRIM_COMPUTATION — ported verbatim from page.tsx:244-251.
function navDebugLog(tag: string, payload?: unknown): void {
  if (!NAV_DEBUG) return;
  if (payload === undefined) {
    console.log(tag);
    return;
  }
  console.log(tag, payload);
}

// SOURCE_COPY_TRIM_COMPUTATION — ported verbatim from page.tsx:297-304.
function distanceMeters(a: LatLngPoint, b: LatLngPoint): number {
  const cosLat = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const LAT_M = 111320;
  const LNG_M = LAT_M * cosLat;
  const dlat = (a.lat - b.lat) * LAT_M;
  const dlng = (a.lng - b.lng) * LNG_M;
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

// SOURCE_COPY_TRIM_COMPUTATION — ported verbatim from page.tsx:525-574.
function projectPointToRouteRange(
  point: LatLngPoint,
  routePath: LatLngPoint[],
  startSegmentIndex: number,
  endSegmentIndex: number,
): RouteProjection | null {
  if (routePath.length < 2) return null;

  const lastSegmentIndex = routePath.length - 2;
  const start = Math.max(0, Math.min(startSegmentIndex, lastSegmentIndex));
  const end = Math.max(start, Math.min(endSegmentIndex, lastSegmentIndex));

  const cosLat = Math.cos(point.lat * Math.PI / 180);
  const LAT_M = 111320;
  const LNG_M = LAT_M * cosLat;

  let bestSegIdx = 0;
  let bestT = 0;
  let bestDist = Infinity;

  for (let i = start; i <= end; i++) {
    const ax = routePath[i].lng * LNG_M, ay = routePath[i].lat * LAT_M;
    const bx = routePath[i + 1].lng * LNG_M, by = routePath[i + 1].lat * LAT_M;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    const t = lenSq === 0 ? 0
      : Math.max(0, Math.min(1, ((point.lng * LNG_M - ax) * dx + (point.lat * LAT_M - ay) * dy) / lenSq));

    const projLat = routePath[i].lat + t * (routePath[i + 1].lat - routePath[i].lat);
    const projLng = routePath[i].lng + t * (routePath[i + 1].lng - routePath[i].lng);
    const dlat = (point.lat - projLat) * LAT_M;
    const dlng = (point.lng - projLng) * LNG_M;
    const dist = Math.sqrt(dlat * dlat + dlng * dlng);

    if (dist < bestDist) {
      bestDist = dist;
      bestSegIdx = i;
      bestT = t;
    }
  }

  const a = routePath[bestSegIdx];
  const b = routePath[bestSegIdx + 1];
  const projectedPoint: LatLngPoint = {
    lat: a.lat + bestT * (b.lat - a.lat),
    lng: a.lng + bestT * (b.lng - a.lng),
  };
  return { projectedPoint, segmentIndex: bestSegIdx, distanceM: bestDist, t: bestT };
}

// SOURCE_COPY_TRIM_COMPUTATION — ported verbatim from page.tsx:521-523.
function projectPointToRoute(point: LatLngPoint, routePath: LatLngPoint[]): RouteProjection | null {
  return projectPointToRouteRange(point, routePath, 0, routePath.length - 2);
}

// SOURCE_COPY_TRIM_COMPUTATION — ported verbatim from page.tsx:367-381.
function computeRouteSourceSignature(routePath: LatLngPoint[]): string {
  if (routePath.length < 2) return 'empty';
  let hash = 2166136261;
  const fnv = (value: number) => {
    hash ^= value;
    hash = Math.imul(hash, 16777619) >>> 0;
  };
  for (const point of routePath) {
    fnv(Math.round(point.lat * 1e6));
    fnv(Math.round(point.lng * 1e6));
  }
  const first = routePath[0];
  const last = routePath[routePath.length - 1];
  return `${routePath.length}:${hash.toString(16)}:${first.lat.toFixed(6)},${first.lng.toFixed(6)}:${last.lat.toFixed(6)},${last.lng.toFixed(6)}`;
}

// SOURCE_COPY_TRIM_COMPUTATION — ported verbatim from page.tsx:576-615.
function computeRouteTrimProgress(
  point: LatLngPoint,
  routePath: LatLngPoint[],
  maxProjectionDistanceM: number,
): RouteTrimProgress | null {
  if (routePath.length < 2) return null;

  const projection = projectPointToRoute(point, routePath);
  if (!projection || projection.distanceM > maxProjectionDistanceM) return null;

  let totalLengthM = 0;
  let distanceBeforeSegmentM = 0;
  let projectedSegmentLengthM = 0;

  for (let i = 0; i < routePath.length - 1; i++) {
    const segmentLengthM = distanceMeters(routePath[i], routePath[i + 1]);
    if (!Number.isFinite(segmentLengthM) || segmentLengthM <= 0) continue;
    if (i < projection.segmentIndex) {
      distanceBeforeSegmentM += segmentLengthM;
    }
    if (i === projection.segmentIndex) {
      projectedSegmentLengthM = segmentLengthM;
    }
    totalLengthM += segmentLengthM;
  }

  if (!Number.isFinite(totalLengthM) || totalLengthM <= 0) return null;

  const distanceAlongRouteM = distanceBeforeSegmentM + projectedSegmentLengthM * projection.t;
  const progress = Math.max(0, Math.min(0.995, distanceAlongRouteM / totalLengthM));

  return {
    progress,
    distanceAlongRouteM,
    distanceM: projection.distanceM,
    segmentIndex: projection.segmentIndex,
    projectedPoint: projection.projectedPoint,
    totalLengthM,
  };
}

// SOURCE_COPY_MOTION_TYPE_HELPER — ported verbatim from page.tsx:383-387.
function computeRouteSourceBodySignature(routePath: LatLngPoint[]): string {
  if (routePath.length < 2) return 'empty';
  const last = routePath[routePath.length - 1];
  return `endpoint:${Math.round(last.lat * 1e6)},${Math.round(last.lng * 1e6)}`;
}

// SOURCE_COPY_MOTION_TYPE_HELPER — ported verbatim from page.tsx:389-400.
function estimateChangedPointCount(a: LatLngPoint[], b: LatLngPoint[]): number {
  const len = Math.max(a.length, b.length);
  let changed = Math.abs(a.length - b.length);
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (Math.round(a[i].lat * 1e6) !== Math.round(b[i].lat * 1e6)
      || Math.round(a[i].lng * 1e6) !== Math.round(b[i].lng * 1e6)) {
      changed++;
    }
  }
  return Math.min(changed, len);
}

// SOURCE_COPY_ROUTE_HANDOFF — F2 Route Presentation Guard, ported verbatim
// from page.tsx:196-220 (Blocker C resolution — see Phase 5C-10 Section 2).
function shouldApplyPresentationPath(p: {
  status: string;
  incomingPathLength: number;
  currentVisiblePathLength: number;
  isIdentityChange: boolean;
}): { apply: boolean; reason: string } {
  if (p.isIdentityChange) return { apply: true, reason: 'identity_change' };
  if (p.status === 'idle' || p.status === 'arrived') return { apply: true, reason: 'nav_ended' };
  if (p.status === 'active') {
    if (p.incomingPathLength < MIN_ROUTE_PRESENTATION_PTS
      && p.currentVisiblePathLength >= MIN_ROUTE_PRESENTATION_PTS) {
      return { apply: false, reason: 'short_path_held' };
    }
    if (p.currentVisiblePathLength >= 8
      && p.incomingPathLength < Math.round(p.currentVisiblePathLength * ROUTE_SHRINK_HOLD_RATIO)) {
      return { apply: false, reason: 'abrupt_shrink_held' };
    }
  }
  return { apply: true, reason: 'apply_normal' };
}

// SOURCE_COPY_ROUTE_HANDOFF — F3 Route Body Lock, ported verbatim from
// page.tsx:222-242 (Blocker C resolution).
function shouldHoldRouteBodyLock(p: {
  status: string;
  isIdentityChange: boolean;
  currentVisiblePathLength: number;
  incomingPathLength: number;
  endpointDeltaM: number;
}): { hold: boolean; reason: string } {
  if (p.status !== 'active') return { hold: false, reason: 'not_active' };
  if (p.isIdentityChange) return { hold: false, reason: 'identity_change' };
  if (p.currentVisiblePathLength < ROUTE_BODY_LOCK_MIN_VISIBLE_PTS)
    return { hold: false, reason: 'visible_too_short' };
  if (p.incomingPathLength >= p.currentVisiblePathLength)
    return { hold: false, reason: 'incoming_not_shrinking' };
  if (p.incomingPathLength < MIN_ROUTE_PRESENTATION_PTS)
    return { hold: false, reason: 'f2_handles_short' };
  if (p.endpointDeltaM > ROUTE_BODY_LOCK_ENDPOINT_DELTA_M)
    return { hold: false, reason: 'endpoint_moved' };
  return { hold: true, reason: 'static_target_body_lock' };
}

function parseNavigationQuery(
  query: Record<string, string | string[] | undefined>,
): NavigationQueryResult {
  const usersIdParam = query.users_id;
  const takecareIdParam = query.takecare_id;
  const idlocationParam = query.idlocation;
  const auTokenParam = query.auToken;

  if (typeof usersIdParam !== 'string' || typeof takecareIdParam !== 'string') {
    return { ok: false, error: NAVIGATION_QUERY_ERROR };
  }

  if (
    (idlocationParam !== undefined && typeof idlocationParam !== 'string') ||
    (auTokenParam !== undefined && typeof auTokenParam !== 'string')
  ) {
    return { ok: false, error: NAVIGATION_QUERY_ERROR };
  }

  const usersId = Number(usersIdParam);
  const takecareId = Number(takecareIdParam);

  if (!Number.isInteger(usersId) || usersId <= 0 || !Number.isInteger(takecareId) || takecareId <= 0) {
    return { ok: false, error: NAVIGATION_QUERY_ERROR };
  }

  return {
    ok: true,
    value: {
      usersId,
      takecareId,
      idlocation: idlocationParam ?? null,
      auToken: auTokenParam ?? null,
    },
  };
}

function NavigationPageInner() {
  const router = useRouter();
  const mapRef = useRef<MapRef>(null);
  // AUTHORIZED_CONTEXT_BINDING — routeVersion added to the existing destructure
  // for Phase 5C-9's trim-reset/rebase tracking (page.tsx uses routeVersionRef
  // mirroring this same context field for the same purpose).
  // AUTHORIZED_CONTEXT_BINDING — endpointDiagnostics added for the route-apply
  // effect's dependency array (page.tsx:2617 depends on it too).
  const { start, stop, markArrived, updatePositions, status, sessionId, routeUxState, path, routeSourceKey, routeVersion, endpointDiagnostics, eta, distance } = useNavigation();
  const [currentPosition, setCurrentPosition] = useState<LatLngPoint | null>(null);
  const [gpsHeading, setGpsHeading] = useState(0);
  const [hasGpsHeading, setHasGpsHeading] = useState(false);
  const [displayBearing, setDisplayBearing] = useState(0);
  const [gpsError, setGpsError] = useState(false);
  const [patientLocation, setPatientLocation] = useState<LatLngPoint | null>(null);
  const [visualPatientLocation, setVisualPatientLocation] = useState<LatLngPoint | null>(null);
  const [isSoundOn, setIsSoundOn] = useState(true);
  const [isSatellite, setIsSatellite] = useState(false);
  const [isLayerModalOpen, setIsLayerModalOpen] = useState(false);
  const prevHeadingRef = useRef(0);
  const hasNavigationBearingRef = useRef(false);
  const latestGpsSpeedRef = useRef(0);
  const lastPatientLocationUpdateAtRef = useRef<number>(Date.now());
  const lastVisualPatientUpdateAtRef = useRef<number>(Date.now());
  const markerSmoothingDecisionRef = useRef<{
    deadZoneTriggered: boolean;
    animationState: 'initial' | 'dead_zone_hold' | 'snap_invalid' | 'snap_large_jump' | 'interpolating';
    previousVisual: LatLngPoint | null;
    nextVisual: LatLngPoint | null;
    rawToVisualBeforeM: number | null;
    rawToVisualAfterM: number | null;
  }>({
    deadZoneTriggered: false,
    animationState: 'initial',
    previousVisual: null,
    nextVisual: null,
    rawToVisualBeforeM: 0,
    rawToVisualAfterM: 0,
  });
  const [hasArrived, setHasArrived] = useState(false);
  const [arrivalDistance, setArrivalDistance] = useState<number | null>(null);
  const arrivalCandidateStartedAtRef = useRef(0);
  const arrivalCandidateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasArrivedRef = useRef(false);
  const hasSpokenArrivalRef = useRef(false);
  const lastArrivalNearLogAtRef = useRef(0);
  const lastArrivalResetKeyRef = useRef('');
  const initAttemptKeyRef = useRef<string | null>(null);
  const initInFlightRef = useRef(false);

  // SOURCE_COPY_TRIM_STATE_REF — ported from page.tsx:1281-1293,1353. Names
  // and initial values preserved exactly from source. routeTrimSourceKeyRef
  // and lastRouteSourceSignatureRef (needed by the continuous trim block,
  // page.tsx:4345-4491) are added below in the motion refs block since they
  // are populated by the route-apply/body-lock effect ported this phase.
  const routeTrimProgressRef = useRef<number>(0);
  const lastRouteTrimDistanceMRef = useRef<number>(0);
  const routeTrimRouteVersionRef = useRef<number>(routeVersion);
  const lastRouteTrimPaintAtRef = useRef<number>(0);
  const lastRouteTrimLogAtRef = useRef<number>(0);
  const lastRouteTrimWarningAtRef = useRef<number>(0);
  const hasSeededInitialRouteTrimRef = useRef<boolean>(false);
  const seededRouteTrimVersionRef = useRef<number | null>(null);
  const lastRouteTrimSeedLogAtRef = useRef<number>(0);
  const hasLoggedFirstMovementTrimNoJumpRef = useRef<boolean>(false);
  // Despite the name (source's PR1 shadow-experiment naming convention), this
  // ref is genuinely load-bearing production state here — read/written only
  // by seedInitialRouteTrim/the continuous trim block, never by the PR1
  // shadow system (not ported). See Phase 5C-9 audit.
  const presentationShadowTrimBasisSignatureRef = useRef<string | null>(null);
  // SOURCE_COPY_CONTINUOUS_TRIM — the two trim refs Phase 5C-9 deferred,
  // ported from page.tsx:1285,1274 respectively. routeTrimSourceKeyRef is
  // synced from routeSourceKey inside the route-apply effect below (mirrors
  // page.tsx:1284 useEffect); lastRouteSourceSignatureRef is written inside
  // that same effect's applySourcePathLegacy (page.tsx:1710).
  const routeTrimSourceKeyRef = useRef<number>(routeSourceKey);
  const lastRouteSourceSignatureRef = useRef<string>('empty');

  // ════════════════════════════════════════════════════════════════════
  // SOURCE_COPY_MOTION_STATE_REF — motion subsystem state/refs, ported from
  // page.tsx:1206-1296 (production subset only — debug/instrumentation/PR1/
  // PR2a/camera-only refs excluded per Phase 5C-10A audit; see inline notes).
  //
  // Initial-seed decision (Phase 5C-10 rule 5): source seeds displayAgentPosition
  // from a localStorage-restored session OR a hardcoded default coordinate
  // (page.tsx:1209-1220). AFE_Plus_V3's Provider (useNavigation.tsx) does not
  // expose a restored agent position via context, and no equivalent hardcoded
  // "startup UI" default exists in this target. Per rule 5's explicit
  // rule not to auto-insert a hardcoded coordinate, this port instead
  // extends the target's OWN pre-existing "wait for real GPS" pattern (the
  // component already returns a loading screen via `if (!currentPosition)`
  // before any Map/marker JSX renders): every position-seeded piece of motion
  // state below starts null/unseeded and is populated ONCE, from `currentPosition`
  // (this target's real GPS state), by the seed effect immediately following
  // these declarations — never from a hardcoded lat/lng.
  // ════════════════════════════════════════════════════════════════════

  // displayAgentPosition: projected agent position on the route — drives
  // marker rendering. SOURCE_COPY_MOTION_STATE_REF, page.tsx:1206-1220 (seed
  // adapted per above), 1221.
  const [displayAgentPosition, setDisplayAgentPosition] = useState<LatLngPoint | null>(null);
  const displayAgentPositionRef = useRef<LatLngPoint | null>(null);
  const lastDisplayAgentPositionRef = useRef<LatLngPoint | null>(null);
  const lastProjectionRef = useRef<ProjectionLock | null>(null);
  const projectionPoorFitCountRef = useRef<number>(0);
  const lastProjectionStaleWarningAtRef = useRef<number>(0);
  const lastProjectedGpsAtRef = useRef<number>(0);
  const lastProjectedRouteVersionRef = useRef<number>(-1);
  // M1.5R-C: Motion Route SSOT version counter — increments when Motion Route
  // (stableRouteSourcePath) changes. page.tsx:1229.
  const motionRouteVersionRef = useRef<number>(0);
  const lastProjectedMotionRouteVersionRef = useRef<number>(-1);

  // Visual agent position layer, page.tsx:1236-1241.
  const [visualAgentPosition, setVisualAgentPosition] = useState<LatLngPoint | null>(null);
  const visualAgentPositionRef = useRef<LatLngPoint | null>(null);
  const snappedAgentTargetRef = useRef<LatLngPoint | null>(null);
  const lastValidSnappedRef = useRef<LatLngPoint | null>(null);
  // M0.5A: MotionState — presentation-layer single source of truth.
  const motionStateRef = useRef<MotionState | null>(null);

  // High-speed marker smoothing refs, page.tsx:1256-1261. latestGpsSpeedRef
  // already exists in this file (line ~598, pre-existing, currently a no-op
  // placeholder) — kept untouched; latestAgentSpeedMpsRef below is the
  // distinct, production-critical "effective speed" ref the integrator
  // actually reads (page.tsx:3904), not the same ref as latestGpsSpeedRef.
  const latestAgentSpeedMpsRef = useRef<number>(0);
  const estimatedAgentSpeedMpsRef = useRef<number>(0);
  const lastGpsPositionForSpeedRef = useRef<LatLngPoint | null>(null);
  const lastGpsPositionAtMsRef = useRef<number>(0);
  const lastSpeedEstimateIgnoredLogAtRef = useRef<number>(0);

  const resetVisualAgentSpeedRefs = useCallback(() => {
    latestAgentSpeedMpsRef.current = 0;
    estimatedAgentSpeedMpsRef.current = 0;
    lastGpsPositionForSpeedRef.current = null;
    lastGpsPositionAtMsRef.current = 0;
  }, []);

  // rAF lifecycle refs, page.tsx:1263-1265,6002-6009.
  const visualAnimFrameRef = useRef<number | null>(null);
  const lastVisualFrameTimeRef = useRef<number>(0);
  const isVisualLoopRunningRef = useRef<boolean>(false);

  // Route-tail anchor production state, page.tsx:1269-1270.
  const [routeTailAnchor, setRouteTailAnchor] = useState<RouteTailAnchor | null>(null);
  const routeTailAnchorRef = useRef<RouteTailAnchor | null>(null);

  // Route-apply/body-lock production state (Blocker C resolution), page.tsx:
  // 1271-1280,1284-1295 (production subset only).
  const [stableRouteSourcePath, setStableRouteSourcePath] = useState<LatLngPoint[]>([]);
  const stableRouteSourcePathRef = useRef<LatLngPoint[]>([]);
  const lastRouteSourceBodySignatureRef = useRef<string>('empty');
  const lastRouteSourceRouteVersionRef = useRef<number>(routeVersion);
  const routeSourceKeyRef = useRef<number>(routeSourceKey);
  const routeVersionRef = useRef<number>(routeVersion);
  const prevRouteSourceKeyForInstRef = useRef<number>(routeSourceKey);
  const routeBodyLockActiveRef = useRef<boolean>(false);
  const pathRef = useRef<LatLngPoint[]>(path);

  // Wrong-way / route-geometry-bearing production refs, page.tsx (Phase 9
  // block + getRouteGeometryBearingCandidate dependencies).
  const lastMovementBearingRef = useRef<number | null>(null);
  const lastMovementBearingSampleRef = useRef<LatLngPoint>({ lat: 0, lng: 0 });
  const wrongWayRef = useRef<boolean>(false);
  const wrongWayTicksRef = useRef<number>(0);
  const wrongWayClearTicksRef = useRef<number>(0);
  const lastWrongWayLogAtRef = useRef<number>(0);
  const lastWrongWayOverrideLogAtRef = useRef<number>(0);
  const targetMarkerBearingRef = useRef<number>(0);

  // ════════════════════════════════════════════════════════════════════
  // SOURCE_COPY_CAMERA_STATE_REF — camera subsystem state/refs, ported from
  // page.tsx:1067-1073,1099-1113,1514-1516,2792-2837 (production subset).
  // cameraModeRef/isCameraFollowingRef existed already as dormant refs from
  // Phase 5C-10 (wrong-way's read dependency, never updated); this phase adds
  // the real reactive state and every writer, activating wrong-way detection
  // as a side effect (per source semantics — no wrong-way logic changed).
  // ════════════════════════════════════════════════════════════════════
  const [cameraMode, setCameraMode] = useState<CameraMode>('top_down');
  const cameraModeRef = useRef<CameraMode>('top_down');
  const [isCameraFollowing, setIsCameraFollowing] = useState(false);
  const isCameraFollowingRef = useRef(false);
  const [hasStartedMoving, setHasStartedMoving] = useState(false);
  const hasStartedMovingRef = useRef(false);
  const [hasUserExploredMap, setHasUserExploredMap] = useState(false);
  const hasUserExploredMapRef = useRef(false);
  const [mapHeading, setMapHeading] = useState(0);
  const mapHeadingRef = useRef(0);
  const [isWrongWay, setIsWrongWay] = useState(false);

  // Movement-detection refs (GPS-watcher-driven), page.tsx:1104-1107.
  const prevPosForMoveRef = useRef<LatLngPoint | null>(null);
  const ignoreFirstGpsSampleRef = useRef(true);
  const consecutiveMovementCountRef = useRef(0);
  const lastMovementCheckLogAtRef = useRef(0);

  // Camera bearing management refs, page.tsx:2807-2813.
  const lastAppliedCameraBearingRef = useRef(0);
  const lastRequestedCameraBearingRef = useRef(0);
  const isBearingEasingRef = useRef(false);
  const isModeTransitionRef = useRef(false);
  const bearingEaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Soft-follow ramp refs, page.tsx:2815-2828.
  const softFollowStartAtRef = useRef(0);
  const softFollowInitialPitchRef = useRef(0);
  const softFollowInitialZoomRef = useRef(0);
  const softFollowInitialPaddingBottomRef = useRef(0);
  const lastSoftFollowLogAtRef = useRef(0);
  const lastCamBearingLogAtRef = useRef(0);
  const targetCameraBearingRef = useRef(0);
  const targetCameraBearingSourceRef = useRef<RouteUpBearingSource>('fallback');
  const targetCameraBearingSegmentRef = useRef<number | null>(null);
  const visualCameraBearingRef = useRef(0);
  const lastCameraTurnFrameLogAtRef = useRef(0);
  const lastCameraTurnTargetLogAtRef = useRef(0);
  const lastCameraTurnApplyLogAtRef = useRef(0);
  const lastCameraTurnSkipLogAtRef = useRef(0);
  const lastCamVisualLogAtRef = useRef(0);

  // Camera center smoothing refs, page.tsx:2831-2837.
  const visualCameraCenterRef = useRef<LatLngPoint | null>(null);
  const userCameraOverrideRef = useRef(false);
  const lastRecenterVisibilityLogAtRef = useRef(0);
  const pendingTouchRef = useRef<PendingTouchGesture | null>(null);
  const lastFreeExploreSkipLogAtRef = useRef(0);

  // Marker-bearing/camera coordination refs, page.tsx:1513-1516,2795-2798.
  const lastMarkerRotationModeLogAtRef = useRef(0);
  const currentMarkerBearingSourceRef = useRef<MarkerBearingSource>('fallback');
  const currentMarkerBearingSegmentRef = useRef<number | null>(null);
  const prevIsCameraFollowingForMarkerRef = useRef(false);
  const lastLookAheadLogAtRef = useRef(0);
  const prevMarkerBearingSourceRef = useRef<MarkerBearingSource>('fallback');
  const lastMarkerBearingLogAtRef = useRef(0);
  const lastMarkerBearingRef = useRef<StableMarkerBearingInfo | null>(null);

  // Marker bearing lerp production state, page.tsx:1509-1511.
  const [visualMarkerBearing, setVisualMarkerBearing] = useState<number>(0);
  const visualMarkerBearingRef = useRef<number>(0);

  // Logging throttle refs used by the ported production blocks (kept as
  // navDebugLog/console.warn throttles, not instrumentation).
  const lastProjectionLogAtRef = useRef<number>(0);
  const lastDisplayPositionLogAtRef = useRef<number>(0);
  const lastRouteTailAnchorLogAtRef = useRef<number>(0);
  const tailAnchorUpdateCountWindowRef = useRef<{ startMs: number; count: number }>({ startMs: Date.now(), count: 0 });
  const lastMarkerBearingVisualLogAtRef = useRef<number>(0);
  const lastRouteSourceDiagAtRef = useRef<number>(0);
  const sourceUpdateCountWindowRef = useRef<{ startMs: number; count: number }>({ startMs: Date.now(), count: 0 });
  const pathCandidateCountWindowRef = useRef<{ startMs: number; count: number }>({ startMs: Date.now(), count: 0 });

  // Seed motion/visual state ONCE, from currentPosition, the first time it
  // becomes available (see rule-5 note above — never from a hardcoded coord).
  useEffect(() => {
    if (!currentPosition || motionStateRef.current) return;
    motionStateRef.current = createInitialMotionState(currentPosition);
    displayAgentPositionRef.current = currentPosition;
    lastDisplayAgentPositionRef.current = currentPosition;
    visualAgentPositionRef.current = currentPosition;
    snappedAgentTargetRef.current = currentPosition;
    lastMovementBearingSampleRef.current = currentPosition;
    visualCameraCenterRef.current = currentPosition;
    setDisplayAgentPosition(currentPosition);
    setVisualAgentPosition(currentPosition);
  }, [currentPosition]);

  // Ref mirrors for camera state, same stale-closure-avoidance purpose as
  // routeSourceKeyRef/routeVersionRef/pathRef above.
  useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode]);
  useEffect(() => { isCameraFollowingRef.current = isCameraFollowing; }, [isCameraFollowing]);
  useEffect(() => { hasStartedMovingRef.current = hasStartedMoving; }, [hasStartedMoving]);
  useEffect(() => { hasUserExploredMapRef.current = hasUserExploredMap; }, [hasUserExploredMap]);
  useEffect(() => { mapHeadingRef.current = mapHeading; }, [mapHeading]);

  // Keep ref mirrors in sync with context/props each render — same purpose as
  // page.tsx's own routeSourceKeyRef sync effect (line 1286) and pathRef usage
  // throughout the rAF loop (avoids stale closures inside the frame callback).
  useEffect(() => { routeSourceKeyRef.current = routeSourceKey; }, [routeSourceKey]);
  useEffect(() => { routeVersionRef.current = routeVersion; }, [routeVersion]);
  useEffect(() => { pathRef.current = path; }, [path]);

  // 3. ติดตามพิกัดตัวเรา (Watch Position)
  // dependency = [] intentionally — mirrors the source watcher lifecycle.
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCurrentPosition(newPos);
        setGpsError(false);

        const speed = pos.coords.speed ?? 0;
        const accuracy = pos.coords.accuracy ?? null;
        const rawHeading = pos.coords.heading;
        latestGpsSpeedRef.current = speed;

        // SOURCE_COPY_GPS_MOTION_FEED — ported from page.tsx:7400-7414. Shadows
        // the GPS layer into MotionState for the rAF integrator to consume.
        // Movement-detection/camera-trigger logic that lived alongside this in
        // source (page.tsx:7489-7627) is camera-only and excluded (rule 11).
        if (motionStateRef.current) {
          motionStateRef.current.rawGpsPosition = newPos;
          motionStateRef.current.lastGpsAt = performance.now();
          motionStateRef.current.rawGpsAccuracyM = accuracy ?? 0;
        }
        displayAgentPositionRef.current = displayAgentPositionRef.current ?? newPos;

        // SOURCE_COPY_GPS_MOTION_FEED — effective-speed estimation, ported
        // from page.tsx:7416-7487. Feeds latestAgentSpeedMpsRef, which the
        // integrator reads at page.tsx:3904 — distinct from the pre-existing
        // latestGpsSpeedRef above (raw hardware speed only, unused elsewhere).
        {
          const nowMs = Date.now();
          const prevPos = lastGpsPositionForSpeedRef.current;
          const prevAt = lastGpsPositionAtMsRef.current;
          const poorAccuracy = accuracy !== null && (!isFinite(accuracy) || accuracy > MOVEMENT_ACCURACY_MAX_M);

          if (!poorAccuracy && prevPos && prevAt > 0) {
            const dtMsSpeed = nowMs - prevAt;
            const movedM = distanceMeters(prevPos, newPos);
            const isLargeJump = movedM > 100;
            const isValidDt = dtMsSpeed > 200 && dtMsSpeed < 5000;

            if (isValidDt && !isLargeJump) {
              const est = movedM / (dtMsSpeed / 1000);
              estimatedAgentSpeedMpsRef.current = Math.max(0, Math.min(60, est));
            } else {
              const ignNow = Date.now();
              if (ignNow - lastSpeedEstimateIgnoredLogAtRef.current >= 2000) {
                lastSpeedEstimateIgnoredLogAtRef.current = ignNow;
                navDebugLog('[NAV] VISUAL_AGENT_SPEED_ESTIMATE_IGNORED', {
                  reason: isLargeJump ? 'large_gps_jump' : 'invalid_dt',
                  movedM: Math.round(movedM * 10) / 10,
                  dtMs: Math.round(dtMsSpeed),
                  accuracy: accuracy !== null ? Math.round(accuracy) : null,
                  estimatedSpeedMps: Math.round(estimatedAgentSpeedMpsRef.current * 10) / 10,
                  latestGpsSpeedMps: Math.round(speed * 10) / 10,
                });
              }
            }
            lastGpsPositionForSpeedRef.current = newPos;
            lastGpsPositionAtMsRef.current = nowMs;
          } else if (poorAccuracy) {
            const ignNow = Date.now();
            if (ignNow - lastSpeedEstimateIgnoredLogAtRef.current >= 2000) {
              lastSpeedEstimateIgnoredLogAtRef.current = ignNow;
              navDebugLog('[NAV] VISUAL_AGENT_SPEED_ESTIMATE_IGNORED', {
                reason: 'poor_accuracy',
                movedM: null,
                dtMs: prevAt > 0 ? nowMs - prevAt : null,
                accuracy: accuracy !== null ? Math.round(accuracy) : null,
                estimatedSpeedMps: Math.round(estimatedAgentSpeedMpsRef.current * 10) / 10,
                latestGpsSpeedMps: Math.round(speed * 10) / 10,
              });
            }
          } else {
            lastGpsPositionForSpeedRef.current = newPos;
            lastGpsPositionAtMsRef.current = nowMs;
          }

          const validGpsSpeed = speed > 0 && isFinite(speed) && speed < 60;
          latestAgentSpeedMpsRef.current = validGpsSpeed ? speed : estimatedAgentSpeedMpsRef.current;
        }

        // SOURCE_COPY_CAMERA_STATE_REF — movement detection, ported verbatim
        // from page.tsx:7489-7593. Makes camera follow mode active.
        if (!hasStartedMovingRef.current) {
          if (pathRef.current.length < 2) {
            navDebugLog('[CAM] CAMERA_MOVEMENT_IGNORED_NO_ROUTE', {
              pathLen: pathRef.current.length,
              accuracy: accuracy !== null ? Math.round(accuracy) : null,
            });
            prevPosForMoveRef.current = newPos;
          } else if (accuracy !== null && accuracy > MOVEMENT_ACCURACY_MAX_M) {
            navDebugLog('[CAM] CAMERA_MOVEMENT_IGNORED_GPS_COLD_START', {
              accuracy: Math.round(accuracy),
              threshold: MOVEMENT_ACCURACY_MAX_M,
              reason: 'accuracy_too_low',
            });
          } else if (ignoreFirstGpsSampleRef.current) {
            ignoreFirstGpsSampleRef.current = false;
            prevPosForMoveRef.current = newPos;
            navDebugLog('[CAM] CAMERA_GPS_FIRST_SAMPLE_IGNORED', {
              accuracy: accuracy !== null ? Math.round(accuracy) : null,
              reason: 'first_valid_sample_used_as_baseline',
            });
          } else {
            let detected = false;
            let moveSource = '';
            let distM = -1;

            if (speed > 0.8) {
              detected = true;
              moveSource = 'speed';
            } else if (prevPosForMoveRef.current) {
              const dlat = (newPos.lat - prevPosForMoveRef.current.lat) * 111320;
              const dlng = (newPos.lng - prevPosForMoveRef.current.lng) * 111320
                * Math.cos(newPos.lat * Math.PI / 180);
              distM = Math.sqrt(dlat * dlat + dlng * dlng);

              if (distM >= MOVEMENT_DISTANCE_THRESHOLD_M) {
                consecutiveMovementCountRef.current += 1;
                if (consecutiveMovementCountRef.current >= MOVEMENT_CONSECUTIVE_REQUIRED) {
                  detected = true;
                  moveSource = 'distance';
                } else {
                  navDebugLog('[CAM] CAMERA_MOVEMENT_CANDIDATE', {
                    distM: Math.round(distM),
                    consecutiveMovementCount: consecutiveMovementCountRef.current,
                    required: MOVEMENT_CONSECUTIVE_REQUIRED,
                  });
                }
              } else {
                if (consecutiveMovementCountRef.current > 0) {
                  navDebugLog('[CAM] CAMERA_MOVEMENT_CANDIDATE_RESET', {
                    distM: Math.round(distM),
                    prevCount: consecutiveMovementCountRef.current,
                  });
                }
                consecutiveMovementCountRef.current = 0;
              }
            }

            const mvNow = Date.now();
            if (mvNow - lastMovementCheckLogAtRef.current >= 2000) {
              lastMovementCheckLogAtRef.current = mvNow;
              navDebugLog('[CAM] CAMERA_MOVEMENT_CHECK', {
                speed: Math.round(speed * 10) / 10,
                accuracy: accuracy !== null ? Math.round(accuracy) : null,
                distM: distM >= 0 ? Math.round(distM) : null,
                pathLen: pathRef.current.length,
                consecutiveMovementCount: consecutiveMovementCountRef.current,
                willTrigger: detected,
              });
            }

            if (detected) {
              hasStartedMovingRef.current = true;
              userCameraOverrideRef.current = false;
              hasUserExploredMapRef.current = false;
              isCameraFollowingRef.current = true;
              setHasStartedMoving(true);
              setHasUserExploredMap(false);
              setIsCameraFollowing(true);
              setCameraMode('navigation_follow');
              navDebugLog('[CAM] MOVEMENT_DETECTED', {
                source: moveSource,
                speed: Math.round(speed * 10) / 10,
                distM: distM >= 0 ? Math.round(distM) : null,
                accuracy: accuracy !== null ? Math.round(accuracy) : null,
                consecutiveMovementCount: consecutiveMovementCountRef.current,
                heading: rawHeading !== null ? Math.round(rawHeading) : null,
              });
            }

            prevPosForMoveRef.current = newPos;
          }
        }

        // Low-pass filter: 80% previous + 20% raw — prevents jitter
        if (speed > 0.5 && rawHeading !== null && !isNaN(rawHeading)) {
          const prevBearing = prevHeadingRef.current;
          let headingDelta = normalizeBearing(rawHeading) - normalizeBearing(prevBearing);
          if (headingDelta > 180) headingDelta -= 360;
          if (headingDelta < -180) headingDelta += 360;
          const smoothed = normalizeBearing(prevBearing + headingDelta * 0.2);
          prevHeadingRef.current = smoothed;
          hasNavigationBearingRef.current = true;
          setHasGpsHeading(true);
          setGpsHeading(smoothed);
          // SOURCE_COPY_CAMERA_STATE_REF — feed the camera bearing target at
          // GPS cadence, ported from page.tsx:7617-7627 (diagnostic logs
          // between the low-pass filter and this call omitted, kept the
          // production call itself).
          updateTargetCameraBearing('gps_update');
        }

        // M1: update compass bearing at GPS cadence (replaces 800ms bearing animate)
        setDisplayBearing(prevHeadingRef.current);
      },
      (err) => {
        setGpsError(true);
        console.error("GPS Error:", err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  void gpsHeading;
  void hasGpsHeading;
  void hasNavigationBearingRef;
  void latestGpsSpeedRef;
  void arrivalDistance;

  const queryResult = router.isReady ? parseNavigationQuery(router.query) : null;
  const pollingUsersId = queryResult?.ok ? queryResult.value.usersId : null;
  const pollingTakecareId = queryResult?.ok ? queryResult.value.takecareId : null;

  // 1. ดึงพิกัดคนไข้ผ่าน AdaptivePollingService
  useEffect(() => {
    if (pollingUsersId === null || pollingTakecareId === null) return;

    const pollingService = new AdaptivePollingService(pollingUsersId, pollingTakecareId, (location) => {
      if (location.latitude && location.longitude) {
        lastPatientLocationUpdateAtRef.current = Date.now();
        setPatientLocation({ lat: Number(location.latitude), lng: Number(location.longitude) });
      }
    });
    pollingService.start();
    return () => pollingService.stop();
  }, [pollingUsersId, pollingTakecareId]);

  useEffect(() => {
    if (!patientLocation) return;

    setVisualPatientLocation((previous) => {
      if (!previous) {
        markerSmoothingDecisionRef.current = {
          deadZoneTriggered: false,
          animationState: 'initial',
          previousVisual: null,
          nextVisual: patientLocation,
          rawToVisualBeforeM: 0,
          rawToVisualAfterM: 0,
        };
        lastVisualPatientUpdateAtRef.current = Date.now();
        return patientLocation;
      }

      const deltaM = distanceMeters(previous, patientLocation);
      if (!Number.isFinite(deltaM)) {
        markerSmoothingDecisionRef.current = {
          deadZoneTriggered: false,
          animationState: 'snap_invalid',
          previousVisual: previous,
          nextVisual: patientLocation,
          rawToVisualBeforeM: null,
          rawToVisualAfterM: 0,
        };
        lastVisualPatientUpdateAtRef.current = Date.now();
        return patientLocation;
      }
      if (deltaM <= PATIENT_MARKER_DEAD_ZONE_M) {
        markerSmoothingDecisionRef.current = {
          deadZoneTriggered: true,
          animationState: 'dead_zone_hold',
          previousVisual: previous,
          nextVisual: previous,
          rawToVisualBeforeM: deltaM,
          rawToVisualAfterM: deltaM,
        };
        return previous;
      }
      if (deltaM >= PATIENT_MARKER_MAX_JUMP_M) {
        markerSmoothingDecisionRef.current = {
          deadZoneTriggered: false,
          animationState: 'snap_large_jump',
          previousVisual: previous,
          nextVisual: patientLocation,
          rawToVisualBeforeM: deltaM,
          rawToVisualAfterM: 0,
        };
        lastVisualPatientUpdateAtRef.current = Date.now();
        return patientLocation;
      }

      const nextVisual = {
        lat: previous.lat + (patientLocation.lat - previous.lat) * PATIENT_MARKER_INTERP_ALPHA,
        lng: previous.lng + (patientLocation.lng - previous.lng) * PATIENT_MARKER_INTERP_ALPHA,
      };
      markerSmoothingDecisionRef.current = {
        deadZoneTriggered: false,
        animationState: 'interpolating',
        previousVisual: previous,
        nextVisual,
        rawToVisualBeforeM: deltaM,
        rawToVisualAfterM: distanceMeters(nextVisual, patientLocation),
      };
      lastVisualPatientUpdateAtRef.current = Date.now();
      return nextVisual;
    });
  }, [patientLocation]);

  useEffect(() => {
    if (pollingUsersId === null || pollingTakecareId === null) return;
    if (!currentPosition || !patientLocation) return;
    if (sessionId || status !== 'idle') return;
    if (initInFlightRef.current) return;

    const attemptKey = `${pollingUsersId}:${pollingTakecareId}`;
    if (initAttemptKeyRef.current === attemptKey) return;

    initInFlightRef.current = true;
    initAttemptKeyRef.current = attemptKey;

    void (async () => {
      try {
        await start(
          {
            lat: currentPosition.lat,
            lng: currentPosition.lng,
          },
          {
            lat: patientLocation.lat,
            lng: patientLocation.lng,
          },
        );
      } finally {
        initInFlightRef.current = false;
      }
    })();
  }, [currentPosition, patientLocation, pollingTakecareId, pollingUsersId, sessionId, start, status]);

  useEffect(() => {
    if (pollingUsersId === null || pollingTakecareId === null) return;
    if (!currentPosition || !patientLocation) return;
    if (!sessionId || status !== 'active') return;

    updatePositions(
      {
        lat: currentPosition.lat,
        lng: currentPosition.lng,
      },
      {
        lat: patientLocation.lat,
        lng: patientLocation.lng,
      },
    );
  }, [currentPosition, patientLocation, pollingTakecareId, pollingUsersId, sessionId, status, updatePositions]);

  const resetArrivalState = useCallback((reason: string) => {
    if (arrivalCandidateTimeoutRef.current) {
      clearTimeout(arrivalCandidateTimeoutRef.current);
      arrivalCandidateTimeoutRef.current = null;
    }
    arrivalCandidateStartedAtRef.current = 0;
    hasArrivedRef.current = false;
    hasSpokenArrivalRef.current = false;
    setHasArrived(false);
    setArrivalDistance(null);
    navDebugLog('[NAV] NAV_ARRIVAL_STATE_RESET', {
      reason,
      currentStatus: status,
      targetPos: patientLocation,
    });
  }, [patientLocation, status]);

  useEffect(() => {
    if (status === 'loading' || status === 'idle' || status === 'error') {
      const resetKey = `${status}:${routeVersion}`;
      if (lastArrivalResetKeyRef.current !== resetKey) {
        lastArrivalResetKeyRef.current = resetKey;
        resetArrivalState(`status_${status}`);
        resetVisualAgentSpeedRefs();
      }
    }
  }, [status, routeVersion, resetArrivalState, resetVisualAgentSpeedRefs]);

  useEffect(() => {
    if (status !== 'active' && status !== 'arrived') return;
    if (!patientLocation) return;

    const agentPos = visualAgentPositionRef.current || displayAgentPositionRef.current || currentPosition;
    if (!agentPos) return;

    const distanceToTarget = distanceMeters(agentPos, patientLocation);
    if (!Number.isFinite(distanceToTarget)) return;

    setArrivalDistance(distanceToTarget);

    const logPayloadBase = {
      distanceToTarget: Math.round(distanceToTarget * 100) / 100,
      threshold: {
        nearM: NAV_ARRIVAL_NEAR_THRESHOLD_M,
        arrivedM: NAV_ARRIVAL_REACHED_THRESHOLD_M,
        dwellMs: 3000,
      },
      hasArrived: hasArrivedRef.current || status === 'arrived',
      currentStatus: status,
      targetPos: patientLocation,
      agentPos,
    };

    if (hasArrivedRef.current || status === 'arrived') {
      if (!hasArrivedRef.current || !hasArrived) {
        hasArrivedRef.current = true;
        setHasArrived(true);
      }
      return;
    }

    const now = performance.now();
    if (distanceToTarget <= NAV_ARRIVAL_NEAR_THRESHOLD_M && now - lastArrivalNearLogAtRef.current >= 2000) {
      lastArrivalNearLogAtRef.current = now;
      navDebugLog('[NAV] NAV_ARRIVAL_NEAR', logPayloadBase);
    }

    if (distanceToTarget <= NAV_ARRIVAL_REACHED_THRESHOLD_M) {
      if (!arrivalCandidateStartedAtRef.current) {
        arrivalCandidateStartedAtRef.current = now;
        navDebugLog('[NAV] NAV_ARRIVAL_CANDIDATE_STARTED', {
          ...logPayloadBase,
          candidateDurationMs: 0,
        });
      }

      if (!arrivalCandidateTimeoutRef.current) {
        arrivalCandidateTimeoutRef.current = setTimeout(() => {
          arrivalCandidateTimeoutRef.current = null;
          const latestAgentPos = visualAgentPositionRef.current || displayAgentPositionRef.current || currentPosition;
          if (!latestAgentPos) return;
          const latestDistanceToTarget = distanceMeters(latestAgentPos, patientLocation);
          const candidateDurationMs = performance.now() - arrivalCandidateStartedAtRef.current;

          if (
            !hasArrivedRef.current
            && arrivalCandidateStartedAtRef.current
            && latestDistanceToTarget <= NAV_ARRIVAL_REACHED_THRESHOLD_M
            && candidateDurationMs >= 3000
          ) {
            hasArrivedRef.current = true;
            setHasArrived(true);
            setArrivalDistance(latestDistanceToTarget);
            markArrived();
            navDebugLog('[NAV] NAV_ARRIVAL_CONFIRMED', {
              distanceToTarget: Math.round(latestDistanceToTarget * 100) / 100,
              threshold: NAV_ARRIVAL_REACHED_THRESHOLD_M,
              candidateDurationMs: Math.round(candidateDurationMs),
              hasArrived: true,
              currentStatus: status,
              targetPos: patientLocation,
              agentPos: latestAgentPos,
            });

            if (isSoundOn && !hasSpokenArrivalRef.current && typeof window !== 'undefined' && 'speechSynthesis' in window) {
              hasSpokenArrivalRef.current = true;
              const utterance = new SpeechSynthesisUtterance('ถึงจุดหมายแล้ว');
              utterance.lang = 'th-TH';
              window.speechSynthesis.speak(utterance);
              navDebugLog('[NAV] NAV_ARRIVAL_TTS_SPOKEN', {
                message: 'ถึงจุดหมายแล้ว',
                distanceToTarget: Math.round(latestDistanceToTarget * 100) / 100,
              });
            }
          }
        }, 3000);
      }
      return;
    }

    if (distanceToTarget > NAV_ARRIVAL_NEAR_THRESHOLD_M && arrivalCandidateStartedAtRef.current) {
      const candidateDurationMs = now - arrivalCandidateStartedAtRef.current;
      arrivalCandidateStartedAtRef.current = 0;
      if (arrivalCandidateTimeoutRef.current) {
        clearTimeout(arrivalCandidateTimeoutRef.current);
        arrivalCandidateTimeoutRef.current = null;
      }
      navDebugLog('[NAV] NAV_ARRIVAL_CANDIDATE_CLEARED', {
        ...logPayloadBase,
        candidateDurationMs: Math.round(candidateDurationMs),
      });
    }
  }, [currentPosition, patientLocation, status, markArrived, isSoundOn, hasArrived]);

  useEffect(() => {
    return () => {
      if (arrivalCandidateTimeoutRef.current) {
        clearTimeout(arrivalCandidateTimeoutRef.current);
        arrivalCandidateTimeoutRef.current = null;
      }
    };
  }, []);

  // SOURCE_COPY_ROUTE_HANDOFF — route-apply/body-lock effect, ported from
  // page.tsx:1601-2617 (Blocker C resolution, Phase 5C-10 Section 2). This is
  // the production-minimum subset: PR1 shadow capture (page.tsx:2114-2463,
  // 2556-2616 — proven `if (!NAV_DEBUG) return;`-gated / diagnostics-only),
  // every instrumentation-recorder call on the motion instrumentation
  // singleton, and every target/route-endpoint diagnostic-evidence (C6) call
  // are omitted —
  // AUTHORIZED_CAMERA_DEBUG_SHADOW_OMISSION. `applySourcePathWithTransactionGate`
  // calls are replaced with direct `applySourcePathLegacy` calls — proven
  // behaviorally identical when TRANSACTION_GATE_COMPILED is false (source's
  // own comment, page.tsx:1781-1783); the PR2a wrapper/gate machinery itself
  // is not ported. This produces `stableRouteSourcePath`/`motionRouteVersionRef`,
  // the real geometry basis the motion/trim system needs — it does NOT change
  // routeGeoJSON/routeSourceData (still `path`-based, Phase 5C-8, protected by
  // rule 10 this phase) or the Mapbox Source/Layer identity in any way.
  useEffect(() => {
    const now = Date.now();
    const bumpWindow = (ref: React.MutableRefObject<{ startMs: number; count: number }>) => {
      if (now - ref.current.startMs >= 1000) {
        const previousCount = ref.current.count;
        ref.current = { startMs: now, count: 1 };
        return previousCount;
      }
      ref.current.count += 1;
      return ref.current.count;
    };
    bumpWindow(pathCandidateCountWindowRef);

    if (path.length < 2) {
      if (status === 'idle' && stableRouteSourcePathRef.current.length >= 2) {
        stableRouteSourcePathRef.current = [];
        routeBodyLockActiveRef.current = false;
        lastRouteSourceSignatureRef.current = 'empty';
        lastRouteSourceBodySignatureRef.current = 'empty';
        lastRouteSourceRouteVersionRef.current = routeVersion;
        setStableRouteSourcePath([]);
        navDebugLog('[NAV] ROUTE_SOURCE_KEPT_PREVIOUS_INVALID_PATH', {
          action: 'cleared_on_idle',
          status,
          routeVersion,
        });
      } else if (stableRouteSourcePathRef.current.length >= 2) {
        navDebugLog('[NAV] ROUTE_SOURCE_KEPT_PREVIOUS_INVALID_PATH', {
          action: 'kept_previous_route',
          status,
          routeVersion,
          incomingPathLen: path.length,
          stableSourcePathLen: stableRouteSourcePathRef.current.length,
        });
      }
      return;
    }

    const candidate = path;
    const previousPath = stableRouteSourcePathRef.current;
    const previousSignature = lastRouteSourceSignatureRef.current;
    const previousBodySignature = lastRouteSourceBodySignatureRef.current;
    const nextSignature = computeRouteSourceSignature(candidate);
    const nextBodySignature = computeRouteSourceBodySignature(candidate);
    const routeVersionChanged = routeVersion !== lastRouteSourceRouteVersionRef.current;
    const sourceKeyChanged = routeSourceKey !== prevRouteSourceKeyForInstRef.current;
    const previousFirst = previousPath.length >= 1 ? previousPath[0] : null;
    const previousLast = previousPath.length >= 1 ? previousPath[previousPath.length - 1] : null;
    const nextFirst = candidate[0];
    const nextLast = candidate[candidate.length - 1];
    const firstMoveM = previousFirst ? distanceMeters(previousFirst, nextFirst) : Infinity;
    const lastPointMoveM = previousLast ? distanceMeters(previousLast, nextLast) : Infinity;
    const sameSignature = previousSignature === nextSignature;
    const sameBody = previousBodySignature === nextBodySignature;
    const changedPointCountApprox = estimateChangedPointCount(previousPath, candidate);

    navDebugLog('[NAV] ROUTE_SOURCE_RENDER_CANDIDATE', {
      routeVersion,
      pathLength: path.length,
      stableSourcePathLength: previousPath.length,
      sourceSignature: nextSignature,
      reason: sameSignature ? 'duplicate_candidate' : sameBody ? 'tail_candidate' : 'body_candidate',
      first: candidate[0],
      last: nextLast,
    });

    const applySourcePathLegacy = (reason: string) => {
      const nextPath = candidate.map((point) => ({ lat: point.lat, lng: point.lng }));
      console.log('[NAV] ENDPOINT_COMPARE_RENDER', {
        stableRouteSourceLast: previousLast,
        routeGeoJSONLast: nextPath.length > 0 ? nextPath[nextPath.length - 1] : null,
        responsePathLast: endpointDiagnostics?.responsePathLast ?? nextLast ?? null,
        pathEndpoint: endpointDiagnostics?.pathEndpoint ?? null,
        routeGoalPoint: endpointDiagnostics?.routeGoalPoint ?? null,
        routeVersion,
        sourceUpdateReason: reason,
      });
      stableRouteSourcePathRef.current = nextPath;
      motionRouteVersionRef.current += 1; // M1.5R-C: notify rAF that Motion Route changed
      routeBodyLockActiveRef.current = false;
      lastRouteSourceSignatureRef.current = nextSignature;
      lastRouteSourceBodySignatureRef.current = nextBodySignature;
      lastRouteSourceRouteVersionRef.current = routeVersion;
      setStableRouteSourcePath(nextPath);
      console.log('[NAV] ROUTE_SETDATA_UPDATE', {
        routeVersion,
        routeSourceKey,
        pathLen: nextPath.length,
        signature: nextSignature,
        reason,
      });
      console.log('[NAV] NAV_ROUTE_SOURCE_TRUTH', {
        routeVersion,
        routeVersionChanged,
        pathStateLen: path.length,
        stableRouteSourcePathLen: previousPath.length,
        incomingRenderedPathLen: candidate.length,
        appliedSourcePathLen: nextPath.length,
        appliedSourceSignature: nextSignature,
        applyReason: reason,
        skipReason: null,
      });
      const sourceUpdateCountLastSecond = bumpWindow(sourceUpdateCountWindowRef);
      navDebugLog('[NAV] ROUTE_SOURCE_APPLIED_MATERIAL_CHANGE', {
        previousSignature,
        nextSignature,
        changedPointCountApprox,
        routeVersionChanged,
        reason,
        firstMoveM: Number.isFinite(firstMoveM) ? Math.round(firstMoveM * 100) / 100 : null,
        lastPointMoveM: Number.isFinite(lastPointMoveM) ? Math.round(lastPointMoveM * 100) / 100 : null,
        sourceUpdateCountLastSecond,
      });
      navDebugLog('[NAV] ROUTE_SOURCE_SETDATA_APPLIED', {
        previousSignature,
        nextSignature,
        changedPointCountApprox,
        routeVersionChanged,
        reason,
      });
      if (now - lastRouteSourceDiagAtRef.current >= 1000) {
        lastRouteSourceDiagAtRef.current = now;
        navDebugLog('[NAV] ROUTE_FLICKER_DIAGNOSTIC', {
          routeVersion,
          sourceSignature: nextSignature,
          sourceUpdateCountLastSecond,
          tailAnchorUpdateCountLastSecond: tailAnchorUpdateCountWindowRef.current.count,
          routeVersionChanged,
          reason,
        });
      }
    };

    const skipSourcePath = (reason: 'duplicate' | 'tail_only_agent_movement') => {
      navDebugLog('[NAV] ROUTE_SOURCE_SETDATA_SKIPPED', {
        reason,
        signature: nextSignature,
        routeVersion,
      });
    };

    if (routeVersionChanged) {
      prevRouteSourceKeyForInstRef.current = sourceKeyChanged ? routeSourceKey : prevRouteSourceKeyForInstRef.current;
    }

    // F2: Route Presentation Guard — protects visual route from abrupt collapse
    const presentationGuard = shouldApplyPresentationPath({
      status,
      incomingPathLength: candidate.length,
      currentVisiblePathLength: previousPath.length,
      isIdentityChange: sourceKeyChanged,
    });

    const holdPresentationPath = (holdReason: string) => {
      navDebugLog('[NAV] ROUTE_PRESENTATION_HELD', { holdReason, routeVersion, routeSourceKey });
    };

    const evalBodyLock = (epDeltaM: number): { hold: boolean; reason: string } => {
      return shouldHoldRouteBodyLock({
        status,
        isIdentityChange: sourceKeyChanged,
        currentVisiblePathLength: previousPath.length,
        incomingPathLength: candidate.length,
        endpointDeltaM: epDeltaM,
      });
    };

    const holdBodyLock = () => {
      routeBodyLockActiveRef.current = true;
    };

    if (previousPath.length < 2) {
      // Case 1: initial seed — F3 not applicable, no visible path yet
      applySourcePathLegacy('initial_seed');
    } else if (sameSignature) {
      // Case 2: exact duplicate — no source change at all
      lastRouteSourceRouteVersionRef.current = routeVersion;
      skipSourcePath('duplicate');
    } else if (routeVersionChanged) {
      if (sourceKeyChanged) {
        // Case 3a: Mapbox refetch (identity change) — F3 must not block new geometry
        if (presentationGuard.apply) {
          applySourcePathLegacy('route_version_changed');
        } else {
          holdPresentationPath(presentationGuard.reason);
        }
      } else {
        // Case 3b: MT-D* incremental — routeVersion incremented but NOT a Mapbox refetch.
        if (presentationGuard.apply) {
          const epDelta3 = Number.isFinite(lastPointMoveM) ? lastPointMoveM : 0;
          const bodyLock3 = evalBodyLock(epDelta3);
          if (bodyLock3.hold) {
            holdBodyLock();
          } else {
            applySourcePathLegacy('route_version_changed');
          }
        } else {
          holdPresentationPath(presentationGuard.reason);
        }
      }
    } else if (Number.isFinite(lastPointMoveM) && lastPointMoveM > ROUTE_SOURCE_ENDPOINT_MOVE_M) {
      // Case 4: endpoint moved > 1m
      if (presentationGuard.apply) {
        const bodyLock4 = evalBodyLock(lastPointMoveM);
        if (bodyLock4.hold) {
          holdBodyLock();
        } else {
          applySourcePathLegacy('route_endpoint_changed');
        }
      } else {
        holdPresentationPath(presentationGuard.reason);
      }
    } else if (sameBody) {
      // Case 5: same endpoint — agent-side tail trim only, F3 not needed
      skipSourcePath('tail_only_agent_movement');
    } else {
      // Case 6: body changed (endpoint shifted < 1m or < 0.1m hash boundary)
      if (presentationGuard.apply) {
        const epDelta6 = Number.isFinite(lastPointMoveM) ? lastPointMoveM : 0;
        const bodyLock6 = evalBodyLock(epDelta6);
        if (bodyLock6.hold) {
          holdBodyLock();
        } else {
          applySourcePathLegacy('route_body_changed');
        }
      } else {
        holdPresentationPath(presentationGuard.reason);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, routeVersion, status, endpointDiagnostics]);

  // SOURCE_COPY_ROUTE_TAIL_CORE — renderedRoutePath, ported from page.tsx:
  // 1518-1570. Marker/camera visual geometry only — Mapbox Source itself
  // stays locked to routeGeoJSON/path per Phase 5C-8 (rule 10, this phase).
  // Needed here as a fallback tier inside getRouteGeometryBearingCandidate
  // (wrong-way detection's bearing source, page.tsx:6043-6050).
  const renderedRoutePath: LatLngPoint[] = useMemo(() => {
    const usingFallback = (status === 'active' || status === 'loading')
      && path.length >= 2
      && (
        (path.length < MIN_ROUTE_PRESENTATION_PTS
          && stableRouteSourcePath.length >= MIN_ROUTE_PRESENTATION_PTS)
        ||
        (stableRouteSourcePath.length >= ROUTE_BODY_LOCK_MIN_VISIBLE_PTS
          && stableRouteSourcePath.length > path.length
          && path.length >= MIN_ROUTE_PRESENTATION_PTS)
      );
    const geomPath = usingFallback ? stableRouteSourcePath : path;

    if (geomPath.length < 2) return geomPath;

    const validTailAnchor = !usingFallback
      && !!routeTailAnchor
      && routeTailAnchor.routeVersion === routeVersion
      && routeTailAnchor.routePathLen === path.length
      && routeTailAnchor.segmentIndex < path.length - 1;

    if (validTailAnchor && routeTailAnchor) {
      const tail = path.slice(routeTailAnchor.segmentIndex + 1);
      if (tail.length > 0) {
        const rendered: LatLngPoint[] = [routeTailAnchor.point, ...tail];
        if (rendered.length >= 2) return rendered;
      }
    }

    const lockedProjection = lastProjectionRef.current;
    const canUseLockedSegment = !usingFallback
      && !!lockedProjection
      && lockedProjection.routeVersion === routeVersion
      && lockedProjection.routePathLen === path.length
      && lockedProjection.segmentIndex < path.length - 1
      && !!displayAgentPosition
      && distanceMeters(displayAgentPosition, lockedProjection.projectedPoint) <= 5;

    const proj = canUseLockedSegment
      ? lockedProjection
      : (displayAgentPosition ? projectPointToRoute(displayAgentPosition, geomPath) : null);
    if (!proj || proj.distanceM > AGENT_PROJECTION_MAX_DIST_M) return geomPath;
    const tail = geomPath.slice(proj.segmentIndex + 1);
    if (tail.length === 0) return geomPath;
    const rendered: LatLngPoint[] = [proj.projectedPoint, ...tail];
    return rendered.length >= 2 ? rendered : geomPath;
  }, [displayAgentPosition, path, stableRouteSourcePath, routeVersion, routeTailAnchor, status]);
  const renderedRoutePathRef = useRef<LatLngPoint[]>([]);
  useEffect(() => { renderedRoutePathRef.current = renderedRoutePath; }, [renderedRoutePath]);

  // SOURCE_COPY_TRIM_PAINT — ported from page.tsx:2862-2916. mapRef binding
  // adapted: AFE's react-map-gl MapRef type (create-ref.d.ts) intentionally
  // excludes setPaintProperty from the wrapped ref itself and requires
  // .getMap() first — using that directly-typed call instead of source's
  // defensive unknown-cast is TypeScript-compatibility-only; guard semantics,
  // layer IDs, paint property name/value, and call ordering are unchanged.
  const setRouteTrimPaint = (
    progress: number,
    reason: string,
    trimDiag?: RouteTrimProgress,
  ): boolean => {
    const map = mapRef.current?.getMap();
    if (!map?.setPaintProperty || !map?.getLayer) return false;

    const clampedProgress = Math.max(0, Math.min(0.995, progress));
    let appliedCount = 0;

    for (const layerId of ROUTE_LINE_LAYER_IDS) {
      if (!map.getLayer(layerId)) continue;
      try {
        map.setPaintProperty(layerId, 'line-trim-offset', [0, clampedProgress]);
        appliedCount += 1;
      } catch {
        // A partial trim write must not be reported as synchronized.
      }
    }

    const applied = appliedCount === ROUTE_LINE_LAYER_IDS.length;
    const now = Date.now();
    if (applied && now - lastRouteTrimLogAtRef.current >= 1000) {
      lastRouteTrimLogAtRef.current = now;
      navDebugLog('[NAV] ROUTE_STYLE_TRIM_APPLIED', {
        reason,
        progress: Math.round(clampedProgress * 10000) / 10000,
        segmentIndex: trimDiag?.segmentIndex ?? null,
        projectionDistanceM: trimDiag ? Math.round(trimDiag.distanceM * 100) / 100 : null,
        distanceAlongRouteM: trimDiag ? Math.round(trimDiag.distanceAlongRouteM * 100) / 100 : null,
        totalLengthM: trimDiag ? Math.round(trimDiag.totalLengthM) : null,
        sourcePathLen: stableRouteSourcePathRef.current.length,
        routeVersion,
        sourceDataMutated: false,
      });
    } else if (!applied && now - lastRouteTrimWarningAtRef.current >= 2000) {
      lastRouteTrimWarningAtRef.current = now;
      navDebugLog('[NAV] ROUTE_STYLE_TRIM_SKIPPED', {
        reason: 'route_layers_not_ready',
        requestedReason: reason,
        progress: Math.round(clampedProgress * 10000) / 10000,
        appliedLayerCount: appliedCount,
        requiredLayerCount: ROUTE_LINE_LAYER_IDS.length,
      });
    }

    return applied;
  };

  // SOURCE_COPY_TRIM_COMPUTATION (seed only) — ported from page.tsx:2918-2936.
  // Now that Phase 5C-10 ports the motion-layer state, the full source
  // candidate chain is restored except `displayPositionRef` (a GPS-cadence
  // mirror ref this port did not separately plumb — `displayAgentPosition`,
  // immediately above it in source's own priority order, serves the same
  // "last stable position" role and is included). currentPosition remains the
  // final fallback, as in source.
  const getInitialRouteTrimPosition = (): { position: LatLngPoint; source: string } | null => {
    const candidates: Array<{ position: LatLngPoint | null | undefined; source: string }> = [
      { position: visualAgentPositionRef.current, source: 'visualAgentPosition' },
      { position: lastValidSnappedRef.current, source: 'lastValidSnapped' },
      { position: snappedAgentTargetRef.current, source: 'snappedAgentTarget' },
      { position: displayAgentPosition, source: 'displayAgentPosition' },
      { position: currentPosition, source: 'currentPosition' },
    ];
    for (const candidate of candidates) {
      const point = candidate.position;
      if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
        return { position: point, source: candidate.source };
      }
    }
    return null;
  };

  // SOURCE_COPY_TRIM_COMPUTATION — ported from page.tsx:2938-2949.
  const logInitialRouteTrimSeedSkipped = (reason: string) => {
    const now = Date.now();
    if (now - lastRouteTrimSeedLogAtRef.current < 2000) return;
    lastRouteTrimSeedLogAtRef.current = now;
    navDebugLog('[NAV] ROUTE_STYLE_TRIM_INITIAL_SEED_SKIPPED', {
      reason,
      routeVersion,
      sourceLen: stableRouteSourcePathRef.current.length,
      alreadySeeded: hasSeededInitialRouteTrimRef.current,
      seededRouteVersion: seededRouteTrimVersionRef.current,
    });
  };

  // SOURCE_COPY_TRIM_COMPUTATION + SOURCE_COPY_TRIM_REBASE — ported from
  // page.tsx:2951-3022. routeVersionRef.current substituted with the
  // `routeVersion` context value directly (no stale-closure risk — this
  // function is redefined every render, unlike source's persistent rAF-loop
  // closure that routeVersionRef exists to solve). stableRouteSourcePathRef
  // and lastRouteSourceSignatureRef are now the real production refs (ported
  // in the route-apply effect above), matching source exactly.
  const seedInitialRouteTrim = (reason: string): boolean => {
    const activeRouteVersion = routeVersion;
    if (hasSeededInitialRouteTrimRef.current && seededRouteTrimVersionRef.current === activeRouteVersion) {
      logInitialRouteTrimSeedSkipped('already_seeded');
      return true;
    }

    const sourcePath = stableRouteSourcePathRef.current;
    if (sourcePath.length < 2) {
      logInitialRouteTrimSeedSkipped('no_route');
      return false;
    }

    const positionCandidate = getInitialRouteTrimPosition();
    if (!positionCandidate) {
      logInitialRouteTrimSeedSkipped('no_position');
      return false;
    }

    const trim = computeRouteTrimProgress(
      positionCandidate.position,
      sourcePath,
      ROUTE_TRIM_MAX_PROJECTION_DIST_M,
    );
    if (!trim) {
      logInitialRouteTrimSeedSkipped('projection_failed');
      return false;
    }

    const previousProgress = routeTrimProgressRef.current;
    const previousDistanceM = lastRouteTrimDistanceMRef.current;
    const currentTrimGeometrySignature = lastRouteSourceSignatureRef.current;
    const geometryBasisChanged = hasRouteTrimGeometryBasisChanged(
      currentTrimGeometrySignature,
      presentationShadowTrimBasisSignatureRef.current,
    );
    const progress = geometryBasisChanged ? trim.progress : Math.max(previousProgress, trim.progress);
    const distanceAlongRouteM = geometryBasisChanged
      ? trim.distanceAlongRouteM
      : Math.max(previousDistanceM, trim.distanceAlongRouteM);
    const applied = setRouteTrimPaint(
      progress,
      geometryBasisChanged ? 'initial_geometry_basis_rebase' : reason,
      trim,
    );
    if (!applied) {
      logInitialRouteTrimSeedSkipped('layer_not_ready');
      return false;
    }

    routeTrimProgressRef.current = progress;
    presentationShadowTrimBasisSignatureRef.current = currentTrimGeometrySignature;
    lastRouteTrimDistanceMRef.current = distanceAlongRouteM;
    routeTrimRouteVersionRef.current = activeRouteVersion;
    lastRouteTrimPaintAtRef.current = Date.now();
    hasSeededInitialRouteTrimRef.current = true;
    seededRouteTrimVersionRef.current = activeRouteVersion;

    navDebugLog('[NAV] ROUTE_STYLE_TRIM_INITIAL_SEEDED', {
      routeVersion: activeRouteVersion,
      progress: Math.round(progress * 10000) / 10000,
      sourceLen: sourcePath.length,
      positionSource: positionCandidate.source,
      reason,
      projectionDistanceM: Math.round(trim.distanceM * 100) / 100,
      distanceAlongRouteM: Math.round(distanceAlongRouteM * 100) / 100,
      sourceDataMutated: false,
    });

    return true;
  };

  // SOURCE_COPY_TRIM_REBASE — ported verbatim from page.tsx:3138-3141.
  useEffect(() => {
    if (stableRouteSourcePath.length < 2) return;
    seedInitialRouteTrim('stable_source_ready');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableRouteSourcePath, routeVersion]);

  // SOURCE_COPY_TRIM_REBASE (reset subset) — ported from page.tsx:3024-3033.
  // routeTailAnchorRef/setRouteTailAnchor (camera/marker subsystem, not trim)
  // and the diagnostics-cleanup refs at page.tsx:3034-3038 (source's own
  // "diagnostics cleanup only" comments) are omitted —
  // AUTHORIZED_MOTION_CAMERA_DEBUG_OMISSION.
  useEffect(() => {
    if (path.length >= 2) return;
    routeTrimProgressRef.current = 0;
    lastRouteTrimDistanceMRef.current = 0;
    hasSeededInitialRouteTrimRef.current = false;
    seededRouteTrimVersionRef.current = null;
    hasLoggedFirstMovementTrimNoJumpRef.current = false;
    setRouteTrimPaint(0, 'route_cleared');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // SOURCE_COPY_WRONG_WAY_CORE — route geometry bearing candidate, ported from
  // page.tsx:6012-6067 (RouteUpBearingCandidate renamed RouteGeometryBearingCandidate
  // — AUTHORIZED_TYPESCRIPT_COMPATIBILITY, no source symbol collision; return
  // shape/values unchanged). getRouteUpBearingCandidate's wrong-way-aware
  // wrapper (page.tsx:6070-6085) is not needed — camera is the only OTHER
  // consumer, and wrong-way detection itself calls this geometry-only
  // candidate function directly (page.tsx:4146), not the wrapper.
  const getRouteGeometryBearingCandidate = (): RouteGeometryBearingCandidate => {
    const currentPath = pathRef.current;
    const lockedProj = lastProjectionRef.current;

    if (
      lockedProj &&
      lockedProj.routeVersion === routeVersionRef.current &&
      lockedProj.routePathLen === currentPath.length &&
      lockedProj.segmentIndex < currentPath.length - 1
    ) {
      const from = currentPath[lockedProj.segmentIndex];
      const to = currentPath[lockedProj.segmentIndex + 1];
      return {
        bearing: computeBearingBetween(from, to),
        source: 'locked_projection_segment',
        segmentIndex: lockedProj.segmentIndex,
        from,
        to,
      };
    }

    const rendered = renderedRoutePathRef.current;
    if (rendered.length >= 2) {
      return {
        bearing: computeBearingBetween(rendered[0], rendered[1]),
        source: 'rendered_route_tangent',
        from: rendered[0],
        to: rendered[1],
      };
    }

    if (currentPath.length >= 2) {
      return {
        bearing: computeBearingBetween(currentPath[0], currentPath[1]),
        source: 'path_start_tangent',
        from: currentPath[0],
        to: currentPath[1],
      };
    }

    if (hasNavigationBearingRef.current && Number.isFinite(prevHeadingRef.current)) {
      return { bearing: normalizeBearing(prevHeadingRef.current), source: 'gps' };
    }

    return { bearing: normalizeBearing(prevHeadingRef.current ?? 0), source: 'fallback' };
  };

  // SOURCE_COPY_CAMERA_STATE_REF — wrong-way-aware wrapper, ported from
  // page.tsx:6070-6085.
  const getRouteUpBearingCandidate = (): RouteGeometryBearingCandidate => {
    if (
      wrongWayRef.current
      && cameraModeRef.current === 'navigation_follow'
      && isCameraFollowingRef.current
      && lastMovementBearingRef.current !== null
      && Number.isFinite(lastMovementBearingRef.current)
    ) {
      return {
        bearing: normalizeBearing(lastMovementBearingRef.current),
        source: 'wrong_way_movement_bearing',
      };
    }
    return getRouteGeometryBearingCandidate();
  };

  // M2-A: Motion-aligned camera bearing selector, ported from page.tsx:6087-6105.
  const getCameraBearing = (): { bearing: number; source: RouteUpBearingSource } => {
    const ms = motionStateRef.current;
    if (
      ms
      && !wrongWayRef.current
      && ms.integratorRouteProgressValid
      && ms.integratorRouteBearingSource === 'route'
    ) {
      return { bearing: normalizeBearing(ms.integratorBearingDeg), source: 'integrator' };
    }
    const candidate = getRouteUpBearingCandidate();
    return { bearing: normalizeBearing(candidate.bearing), source: candidate.source };
  };

  // SOURCE_COPY_CAMERA_STATE_REF — ported verbatim from page.tsx:6107-6116.
  const getNavigationBearing = (fallbackBearing = prevHeadingRef.current) => {
    const candidate = getRouteUpBearingCandidate();
    if (candidate.source !== 'gps' && candidate.source !== 'fallback') {
      return candidate.bearing;
    }
    if (hasNavigationBearingRef.current && Number.isFinite(prevHeadingRef.current)) {
      return normalizeBearing(prevHeadingRef.current);
    }
    return normalizeBearing(Number.isFinite(fallbackBearing) ? fallbackBearing : 0);
  };

  // SOURCE_COPY_MARKER_BEARING — ported from page.tsx:6118-6203.
  const getMarkerWorldBearingCandidate = (): {
    bearing: number;
    source: MarkerBearingSource;
    segmentIndex: number | null;
  } => {
    if (
      wrongWayRef.current
      && lastMovementBearingRef.current !== null
      && Number.isFinite(lastMovementBearingRef.current)
    ) {
      return {
        bearing: normalizeBearing(lastMovementBearingRef.current),
        source: 'wrong_way_movement_bearing',
        segmentIndex: null,
      };
    }

    const currentPath = pathRef.current;
    const lockedProjection = lastProjectionRef.current;

    if (
      lockedProjection
      && lockedProjection.routeVersion === routeVersionRef.current
      && lockedProjection.routePathLen === currentPath.length
      && lockedProjection.segmentIndex < currentPath.length - 1
    ) {
      return {
        bearing: computeBearingBetween(
          currentPath[lockedProjection.segmentIndex],
          currentPath[lockedProjection.segmentIndex + 1],
        ),
        source: 'route_tangent',
        segmentIndex: lockedProjection.segmentIndex,
      };
    }

    const visualPos = visualAgentPositionRef.current;
    const visualProjection = visualPos ? projectPointToRoute(visualPos, currentPath) : null;
    if (
      visualProjection
      && visualProjection.distanceM <= AGENT_PROJECTION_MAX_DIST_M
      && visualProjection.segmentIndex < currentPath.length - 1
    ) {
      return {
        bearing: computeBearingBetween(
          currentPath[visualProjection.segmentIndex],
          currentPath[visualProjection.segmentIndex + 1],
        ),
        source: 'route_tangent',
        segmentIndex: visualProjection.segmentIndex,
      };
    }

    const rendered = renderedRoutePathRef.current;
    if (rendered.length >= 2) {
      return {
        bearing: computeBearingBetween(rendered[0], rendered[1]),
        source: 'route_tangent',
        segmentIndex: null,
      };
    }

    if (
      lastMovementBearingRef.current !== null
      && Number.isFinite(lastMovementBearingRef.current)
    ) {
      return {
        bearing: normalizeBearing(lastMovementBearingRef.current),
        source: 'movement_bearing',
        segmentIndex: null,
      };
    }

    if (hasNavigationBearingRef.current && Number.isFinite(prevHeadingRef.current)) {
      return {
        bearing: normalizeBearing(prevHeadingRef.current),
        source: 'gps',
        segmentIndex: null,
      };
    }

    return {
      bearing: normalizeBearing(mapHeadingRef.current ?? 0),
      source: 'fallback',
      segmentIndex: null,
    };
  };

  // SOURCE_COPY_CAMERA_BEARING — ported verbatim from page.tsx:6205-6232.
  const updateTargetCameraBearing = (reason: string): RouteGeometryBearingCandidate => {
    const candidate = getRouteUpBearingCandidate();
    const nextTarget = normalizeBearing(candidate.bearing);
    const prevTarget = targetCameraBearingRef.current;
    const delta = shortestBearingDelta(prevTarget, nextTarget);

    targetCameraBearingRef.current = nextTarget;
    targetMarkerBearingRef.current = nextTarget; // M1: unify bearing targets — both lerps converge to same value
    targetCameraBearingSourceRef.current = candidate.source;
    targetCameraBearingSegmentRef.current = candidate.segmentIndex ?? null;

    const nowLog = Date.now();
    if (Math.abs(delta) >= CAMERA_TURN_DEAD_ZONE_DEG && nowLog - lastCameraTurnTargetLogAtRef.current >= 1000) {
      lastCameraTurnTargetLogAtRef.current = nowLog;
      navDebugLog('[CAM] CAMERA_TURN_TARGET_UPDATED', {
        reason,
        source: candidate.source,
        segmentIndex: candidate.segmentIndex ?? null,
        prevTargetCameraBearing: Math.round(prevTarget),
        targetCameraBearing: Math.round(nextTarget),
        delta: Math.round(delta * 100) / 100,
        routeVersion: routeVersionRef.current,
        pathLen: pathRef.current.length,
      });
    }

    return candidate;
  };

  // SOURCE_COPY_CAMERA_BEARING — ported verbatim from page.tsx:6234-6258.
  const computeAndLogLookAheadCenter = (
    agentPos: LatLngPoint,
    bearing: number,
    source: string,
    forceLog = false,
  ) => {
    const lookAheadCenter = computeLookAheadCenter(agentPos, bearing, LOOK_AHEAD_M);
    const nowLog = Date.now();

    if (forceLog || nowLog - lastLookAheadLogAtRef.current >= CAMERA_LOOKAHEAD_LOG_INTERVAL_MS) {
      lastLookAheadLogAtRef.current = nowLog;
      navDebugLog('[CAM] CAMERA_LOOKAHEAD_CENTER_COMPUTED', {
        source,
        agentPos,
        bearing: Math.round(bearing),
        lookAheadM: LOOK_AHEAD_M,
        lookAheadCenter,
        cameraMode: cameraModeRef.current,
        pitch: NAV_FOLLOW_PITCH,
        zoom: NAV_FOLLOW_ZOOM,
      });
    }

    return lookAheadCenter;
  };

  // SOURCE_COPY_CAMERA_STATE_REF — Phase 3 user camera override (free-explore),
  // ported verbatim from page.tsx:6264-6337.
  const applyUserCameraOverride = (reason: string, eventInfo: Record<string, unknown>) => {
    const cameraModeBefore = cameraModeRef.current;
    const isCameraFollowingBefore = isCameraFollowingRef.current;
    const hasStartedMovingBefore = hasStartedMovingRef.current;
    const isNavigationActive = pathRef.current.length >= 2 || routeVersionRef.current > 0;
    const phase = hasStartedMovingBefore ? 'active_navigation' : 'pre_drive';

    if (!isNavigationActive) {
      navDebugLog('[CAM] CAMERA_USER_OVERRIDE_IGNORED', {
        reason,
        ignoredReason: 'navigation_not_active',
        cameraMode: cameraModeBefore,
        hasStartedMoving: hasStartedMovingBefore,
        isCameraFollowing: isCameraFollowingBefore,
        ...eventInfo,
      });
      return;
    }

    if (!isCameraFollowingBefore && userCameraOverrideRef.current) {
      navDebugLog('[CAM] CAMERA_USER_OVERRIDE_IGNORED', {
        reason,
        ignoredReason: 'already_user_control',
        cameraMode: cameraModeBefore,
        hasStartedMoving: hasStartedMovingBefore,
        isCameraFollowing: false,
        userCameraOverride: userCameraOverrideRef.current,
        ...eventInfo,
      });
      return;
    }

    if (softFollowStartAtRef.current > 0) {
      softFollowStartAtRef.current = 0;
      navDebugLog('[CAM] CAMERA_SOFT_FOLLOW_CANCELLED_BY_USER', {
        reason,
        hasStartedMoving: hasStartedMovingRef.current,
        cameraMode: cameraModeRef.current,
      });
    }

    isCameraFollowingRef.current = false;
    setIsCameraFollowing(false);
    userCameraOverrideRef.current = true;
    hasUserExploredMapRef.current = true;
    setHasUserExploredMap(true);

    if (bearingEaseTimeoutRef.current !== null) {
      clearTimeout(bearingEaseTimeoutRef.current);
      bearingEaseTimeoutRef.current = null;
    }
    isBearingEasingRef.current = false;

    navDebugLog('[CAM] CAMERA_USER_OVERRIDE_APPLIED', {
      reason,
      cameraModeBefore,
      hasStartedMoving: hasStartedMovingBefore,
      isCameraFollowingBefore,
      isCameraFollowingAfter: false,
      phase,
      userCameraOverride: true,
      ...eventInfo,
    });
    if (!hasStartedMovingBefore) {
      navDebugLog('[CAM] NAV_PRE_DRIVE_GESTURE_ALLOWED', {
        reason,
        cameraMode: cameraModeBefore,
        hasStartedMoving: false,
      });
    }
  };

  // SOURCE_COPY_CAMERA_STATE_REF — user gesture detection, ported verbatim
  // from page.tsx:6339-6480.
  const isUserGesture = (e: ViewStateChangeEvent): boolean => {
    return !!(e as { originalEvent?: unknown }).originalEvent;
  };

  const handleUserGestureEvent = (reason: string, e: ViewStateChangeEvent) => {
    const hasOE = isUserGesture(e);
    const oeType = ((e as { originalEvent?: { type?: string } }).originalEvent)?.type ?? 'none';

    navDebugLog('[CAM] CAMERA_USER_GESTURE_RECEIVED', {
      reason,
      hasOriginalEvent: hasOE,
      originalEventType: oeType,
      cameraMode: cameraModeRef.current,
      hasStartedMoving: hasStartedMovingRef.current,
      isCameraFollowing: isCameraFollowingRef.current,
    });

    if (!hasOE) {
      navDebugLog('[CAM] CAMERA_USER_OVERRIDE_IGNORED', {
        reason,
        ignoredReason: 'no_original_event',
        hasOriginalEvent: false,
        originalEventType: oeType,
        cameraMode: cameraModeRef.current,
        hasStartedMoving: hasStartedMovingRef.current,
      });
      return;
    }

    applyUserCameraOverride(reason, { originalEventType: oeType });
  };

  const isMapCanvasTouchTarget = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    return element?.tagName === 'CANVAS';
  };

  const clearPendingTouch = () => {
    pendingTouchRef.current = null;
  };

  const handleMapTouchStart = (e: React.TouchEvent) => {
    if (!isMapCanvasTouchTarget(e.target)) return;
    const firstTouch = e.touches[0];
    if (!firstTouch) return;

    pendingTouchRef.current = {
      active: true,
      startX: firstTouch.clientX,
      startY: firstTouch.clientY,
      startTime: Date.now(),
      touchCount: e.touches.length,
    };

    navDebugLog('[CAM] MAP_TOUCH_PENDING', {
      touchCount: e.touches.length,
      startX: Math.round(firstTouch.clientX),
      startY: Math.round(firstTouch.clientY),
      cameraMode: cameraModeRef.current,
      hasStartedMoving: hasStartedMovingRef.current,
      thresholdPx: USER_GESTURE_MOVE_THRESHOLD_PX,
    });
  };

  const handleMapTouchMove = (e: React.TouchEvent) => {
    const pending = pendingTouchRef.current;
    if (!pending?.active) return;

    const firstTouch = e.touches[0];
    if (!firstTouch) return;

    const dx = firstTouch.clientX - pending.startX;
    const dy = firstTouch.clientY - pending.startY;
    const distancePx = Math.sqrt(dx * dx + dy * dy);
    const touchCount = e.touches.length;

    if (touchCount >= 2) {
      navDebugLog('[CAM] MAP_TOUCH_MOVE_THRESHOLD_REACHED', {
        reason: 'pinch-touchmove',
        touchMoveDistancePx: Math.round(distancePx),
        touchCount,
        thresholdPx: USER_GESTURE_MOVE_THRESHOLD_PX,
        cameraMode: cameraModeRef.current,
        hasStartedMoving: hasStartedMovingRef.current,
      });
      applyUserCameraOverride('pinch-touchmove', {
        hasOriginalEvent: true,
        originalEventType: e.type,
        touchMoveDistancePx: Math.round(distancePx),
        touchCount,
      });
      clearPendingTouch();
      return;
    }

    if (distancePx >= USER_GESTURE_MOVE_THRESHOLD_PX) {
      navDebugLog('[CAM] MAP_TOUCH_MOVE_THRESHOLD_REACHED', {
        reason: 'touchmove-threshold',
        dx: Math.round(dx),
        dy: Math.round(dy),
        touchMoveDistancePx: Math.round(distancePx),
        touchCount,
        thresholdPx: USER_GESTURE_MOVE_THRESHOLD_PX,
        cameraMode: cameraModeRef.current,
        hasStartedMoving: hasStartedMovingRef.current,
      });
      applyUserCameraOverride('touchmove-threshold', {
        hasOriginalEvent: true,
        originalEventType: e.type,
        touchMoveDistancePx: Math.round(distancePx),
        touchCount,
      });
      clearPendingTouch();
    }
  };

  const cancelPendingTouchWithoutOverride = (eventType: string) => {
    const pending = pendingTouchRef.current;
    if (!pending?.active) return;

    navDebugLog('[CAM] MAP_TOUCH_CANCELLED_NO_OVERRIDE', {
      eventType,
      touchCount: pending.touchCount,
      elapsedMs: Date.now() - pending.startTime,
      cameraMode: cameraModeRef.current,
      hasStartedMoving: hasStartedMovingRef.current,
    });
    clearPendingTouch();
  };

  const handleMapTouchEnd = (e: React.TouchEvent) => {
    cancelPendingTouchWithoutOverride(e.type);
  };

  const handleMapTouchCancel = (e: React.TouchEvent) => {
    cancelPendingTouchWithoutOverride(e.type);
  };

  // SOURCE_COPY_CAMERA_STATE_REF — recenter behavior, ported verbatim from
  // page.tsx:7638-7752.
  const handleRecenter = () => {
    if (!mapRef.current || !visualAgentPositionRef.current) return;

    const isActiveNavigation = hasStartedMovingRef.current && cameraModeRef.current === 'navigation_follow';
    const agentPos = visualAgentPositionRef.current;

    if (!isActiveNavigation) {
      userCameraOverrideRef.current = false;
      hasUserExploredMapRef.current = false;
      isCameraFollowingRef.current = false;
      setHasUserExploredMap(false);
      setIsCameraFollowing(false);

      const center = agentPos;
      const zoom = TOP_DOWN_ZOOM;
      const pitch = 0;
      const bearing = 0;

      mapRef.current.flyTo({
        center: [center.lng, center.lat],
        zoom,
        pitch,
        bearing,
        duration: 650,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
      });

      navDebugLog('[CAM] NAV_PRE_DRIVE_RECENTER_APPLIED', {
        targetCenter: center,
        zoom,
        pitch,
        bearing,
        cameraMode: cameraModeRef.current,
      });

      setTimeout(() => {
        if (mapRef.current) {
          const mc = mapRef.current.getCenter();
          visualCameraCenterRef.current = { lat: mc.lat, lng: mc.lng };
          navDebugLog('[CAM] NAV_PRE_DRIVE_RECENTER_COMPLETE', {
            cameraMode: cameraModeRef.current,
            isCameraFollowing: isCameraFollowingRef.current,
            hasUserExploredMap: hasUserExploredMapRef.current,
          });
        }
      }, 700);
      return;
    }

    userCameraOverrideRef.current = false;
    hasUserExploredMapRef.current = false;
    isCameraFollowingRef.current = true;
    setHasUserExploredMap(false);
    setIsCameraFollowing(true);

    const pitch = NAV_FOLLOW_PITCH;
    const zoom = NAV_FOLLOW_ZOOM;

    const candidate = getRouteUpBearingCandidate();
    const bearing = candidate?.bearing ?? getNavigationBearing();
    const center = computeAndLogLookAheadCenter(agentPos, bearing, 'recenter_free_explore', true);

    lastRequestedCameraBearingRef.current = bearing;
    targetCameraBearingRef.current = normalizeBearing(bearing);
    visualCameraBearingRef.current = mapRef.current.getBearing() ?? mapHeadingRef.current ?? bearing;
    isBearingEasingRef.current = true;

    mapRef.current.flyTo({
      center: [center.lng, center.lat],
      zoom,
      pitch,
      bearing,
      duration: 800,
      padding: { top: 0, bottom: CAMERA_NAV_BOTTOM_PAD_PX, left: 0, right: 0 },
    });

    setTimeout(() => {
      isBearingEasingRef.current = false;
      if (mapRef.current) {
        const mc = mapRef.current.getCenter();
        visualCameraCenterRef.current = { lat: mc.lat, lng: mc.lng };
        const actualBearing = mapRef.current.getBearing();
        lastAppliedCameraBearingRef.current = actualBearing;
        visualCameraBearingRef.current = actualBearing;
        navDebugLog('[CAM] CAMERA_RECENTER_FREE_EXPLORE_COMPLETE', {
          actualBearing: Math.round(actualBearing),
          requestedBearing: Math.round(bearing),
          mapCenter: { lat: mc.lat, lng: mc.lng },
        });
      }
    }, 850);

    navDebugLog('[CAM] CAMERA_RECENTER_FROM_FREE_EXPLORE', {
      agentPos,
      bearing: Math.round(bearing),
      bearingSource: candidate?.source ?? 'navigation_bearing',
      lookAheadCenter: center,
      cameraMode: cameraModeRef.current,
      pitch,
      zoom,
    });
    navDebugLog('[CAM] CAMERA_RECENTER_LOOKAHEAD_APPLIED', {
      agentPos,
      bearing: Math.round(bearing),
      lookAheadM: LOOK_AHEAD_M,
      lookAheadCenter: center,
      cameraMode: 'navigation_follow',
      pitch,
      zoom,
    });
  };

  // ════════════════════════════════════════════════════════════════════
  // SOURCE_COPY_INTEGRATOR_CORE / SOURCE_COPY_PROJECTION_CORE / SOURCE_COPY_
  // ROUTE_HANDOFF / SOURCE_COPY_WRONG_WAY_CORE / SOURCE_COPY_ROUTE_TAIL_CORE /
  // SOURCE_COPY_CONTINUOUS_TRIM / SOURCE_COPY_MARKER_BEARING — the single rAF
  // motion loop, ported from page.tsx:3160-4543 (production subset). Exact
  // ordering preserved (same-frame state dependencies) per rule 7's mandate.
  //
  // Cut from this loop, per rule 7 §7 and the Phase 5C-10A exclusion matrix:
  // every instrumentation-recorder call on the motion instrumentation
  // singleton, the single outer `if (NAV_DEBUG) {...}` diagnostic-sample-
  // assembly block (page.tsx:4899-5932), PR1 shadow prep, PR2a transaction
  // diagnostics, pendingMotionTransitionRef/pendingProjectionDecisionRef/
  // pendingProjectionRouteSnapshotRef writes (Phase 6/8 diagnostics), and the
  // entire camera-follow block (page.tsx:4545-4894 — no map-camera-animation
  // calls, no look-ahead-center computation, no smoothed camera-center/
  // camera-bearing state of any kind, per rule 11). Debug-gated MotionState field
  // writes (`if (NAV_DEBUG) { ms.xxx = ... }`) are also omitted — those fields
  // are DEBUG_ONLY per the 5C-10A MotionState audit. Warning/error logs that
  // are part of a real production fallback path (console.warn on stale/far
  // projection) are kept, per rule 7's explicit allowance.
  // ════════════════════════════════════════════════════════════════════
  useEffect(() => {
    isVisualLoopRunningRef.current = true;
    lastVisualFrameTimeRef.current = performance.now();

    const runFrame = () => {
      if (!isVisualLoopRunningRef.current) return;
      // Lazy-seed guard (Phase 5C-10 rule 5 resolution) — motionStateRef is
      // seeded by the effect above once currentPosition first exists; until
      // then, keep scheduling frames without doing motion work.
      if (!motionStateRef.current) {
        visualAnimFrameRef.current = requestAnimationFrame(runFrame);
        return;
      }

      const now = performance.now();
      const rawDt = now - lastVisualFrameTimeRef.current;
      const dtMs = Math.max(8, Math.min(100, rawDt));
      lastVisualFrameTimeRef.current = now;

      const getMotionRoute = (): LatLngPoint[] => {
        const stable = stableRouteSourcePathRef.current;
        return stable.length >= 2 ? stable : pathRef.current;
      };

      {
        const ms = motionStateRef.current;
        ms.lastFrameAt = now;
        ms.frameCount += 1;
        ms.gpsAge = ms.lastGpsAt > 0 ? now - ms.lastGpsAt : 0;
        ms.isStationary = latestGpsSpeedRef.current < 0.5;
        ms.hasMovementDetected = cameraModeRef.current === 'navigation_follow';
      }

      // ── M1: rAF-frame projection ─────────────────────────────────────
      {
        const currentGpsAt = motionStateRef.current.lastGpsAt;
        const currentRouteVer = routeVersionRef.current;
        const currentMotionRouteVer = motionRouteVersionRef.current;
        const isNewGps = currentGpsAt > lastProjectedGpsAtRef.current && currentGpsAt > 0;
        const isBackendRouteNew = currentRouteVer !== lastProjectedRouteVersionRef.current;
        const isMotionRouteNew = currentMotionRouteVer !== lastProjectedMotionRouteVersionRef.current;

        if (isNewGps || isMotionRouteNew || isBackendRouteNew) {
          lastProjectedGpsAtRef.current = currentGpsAt;
          lastProjectedRouteVersionRef.current = currentRouteVer;
          lastProjectedMotionRouteVersionRef.current = currentMotionRouteVer;

          // M1.5R-C: immediate progress migration — project integratorPosition
          // onto new Motion Route so integrator never falls back to Euclidean
          // during route change (SOURCE_COPY_ROUTE_HANDOFF).
          if (isMotionRouteNew) {
            const newMotionRoute = getMotionRoute();
            if (newMotionRoute.length >= 2) {
              const ms = motionStateRef.current;
              const migrateProj = projectPointToRoute(ms.integratorPosition, newMotionRoute);
              if (migrateProj && migrateProj.distanceM <= AGENT_PROJECTION_MAX_DIST_M) {
                ms.integratorRouteProgressM = computeRouteProgressFromProjection(
                  migrateProj.segmentIndex, migrateProj.t, newMotionRoute,
                );
                ms.integratorRouteProgressValid = true;
                ms.integratorRouteBearingSource = 'route';
              } else {
                ms.integratorRouteProgressValid = false;
                ms.integratorRouteBearingSource = 'euclidean';
              }
            } else {
              motionStateRef.current.integratorRouteProgressValid = false;
            }
          }

          const rawGps = motionStateRef.current.rawGpsPosition;
          const routeForProj = getMotionRoute();

          if (routeForProj.length >= 2) {
            const previousProjection = lastProjectionRef.current;
            const proj = projectPointToRouteStable(
              rawGps,
              routeForProj,
              previousProjection,
              routeVersionRef.current,
            );

            let finalProj = proj;
            let recoveryTriggered = false;
            if (proj && proj.distanceM > PROJECTION_POOR_FIT_DIST_M) {
              projectionPoorFitCountRef.current++;
              const isForceDistance = proj.distanceM > PROJECTION_FORCE_FULL_SCAN_DIST_M;
              const isPoorFitLimit = projectionPoorFitCountRef.current >= PROJECTION_POOR_FIT_MAX_COUNT;
              if (isForceDistance || isPoorFitLimit) {
                const recovered = projectPointToRoute(rawGps, routeForProj);
                if (recovered && recovered.distanceM < proj.distanceM) {
                  const reason: 'poor_fit_count' | 'force_distance' = isForceDistance ? 'force_distance' : 'poor_fit_count';
                  navDebugLog('[NAV] AGENT_PROJECTION_RECOVERY_TRIGGERED', {
                    reason,
                    previousSegmentIndex: proj.segmentIndex,
                    recoveredSegmentIndex: recovered.segmentIndex,
                    oldDistanceM: Math.round(proj.distanceM),
                    newDistanceM: Math.round(recovered.distanceM),
                    poorFitCount: projectionPoorFitCountRef.current,
                  });
                  finalProj = withProjectionSource(recovered, previousProjection, 'full_scan_recovery');
                  recoveryTriggered = true;
                  projectionPoorFitCountRef.current = 0;
                }
              }
            } else if (proj) {
              projectionPoorFitCountRef.current = 0;
            }
            void recoveryTriggered;

            if (previousProjection && finalProj && finalProj.distanceM > PROJECTION_POOR_FIT_DIST_M) {
              const lockAgeMs = Date.now() - previousProjection.lastUpdatedAt;
              if (lockAgeMs > 5000) {
                const warnNow = Date.now();
                if (warnNow - lastProjectionStaleWarningAtRef.current >= 3000) {
                  lastProjectionStaleWarningAtRef.current = warnNow;
                  console.warn('[NAV] AGENT_PROJECTION_LOCK_STALE_WARNING', {
                    lockAgeMs,
                    segmentIndex: previousProjection.segmentIndex,
                    distanceM: Math.round(finalProj.distanceM),
                    poorFitCount: projectionPoorFitCountRef.current,
                  });
                }
              }
            }

            if (finalProj && finalProj.distanceM <= AGENT_PROJECTION_MAX_DIST_M) {
              const nextProjectionLock: ProjectionLock = {
                ...finalProj,
                routeVersion: routeVersionRef.current,
                routePathLen: routeForProj.length,
                lastUpdatedAt: Date.now(),
              };
              lastProjectionRef.current = nextProjectionLock;
              snappedAgentTargetRef.current = finalProj.projectedPoint;
              lastValidSnappedRef.current = finalProj.projectedPoint;
              {
                const ms = motionStateRef.current;
                ms.integratorTargetPosition = finalProj.projectedPoint;
                ms.integratorTargetDistanceM = distanceMeters(ms.integratorPosition, finalProj.projectedPoint);
                ms.integratorLastTargetUpdateAt = now;
                const targetProgressM = computeRouteProgressFromProjection(
                  finalProj.segmentIndex, finalProj.t, routeForProj,
                );
                ms.integratorTargetProgressM = targetProgressM;
                if (!ms.integratorRouteProgressValid) {
                  const initProj = projectPointToRoute(ms.integratorPosition, routeForProj);
                  ms.integratorRouteProgressM = initProj
                    ? computeRouteProgressFromProjection(initProj.segmentIndex, initProj.t, routeForProj)
                    : Math.max(0, targetProgressM - distanceMeters(ms.integratorPosition, finalProj.projectedPoint));
                  ms.integratorRouteProgressValid = true;
                }
              }
              motionStateRef.current.projectedPosition = finalProj.projectedPoint;
              motionStateRef.current.projectionDistanceM = finalProj.distanceM;
              motionStateRef.current.projectionSegmentIdx = finalProj.segmentIndex;
              motionStateRef.current.isProjected = true;

              if (finalProj.backtrackClamped) {
                navDebugLog('[NAV] AGENT_PROJECTION_BACKTRACK_CLAMPED', {
                  segmentIndex: finalProj.segmentIndex,
                  originalT: Math.round(finalProj.backtrackClamped.originalT * 1000) / 1000,
                  clampedT: Math.round(finalProj.backtrackClamped.clampedT * 1000) / 1000,
                  maxBacktrackM: finalProj.backtrackClamped.maxBacktrackM,
                  segmentLengthM: Math.round(finalProj.backtrackClamped.segmentLengthM),
                });
              }

              const deltaM = lastDisplayAgentPositionRef.current
                ? distanceMeters(lastDisplayAgentPositionRef.current, finalProj.projectedPoint)
                : Infinity;
              const projLogNow = Date.now();
              if (deltaM < DISPLAY_AGENT_MIN_MOVE_M) {
                if (projLogNow - lastDisplayPositionLogAtRef.current >= 1000) {
                  lastDisplayPositionLogAtRef.current = projLogNow;
                  navDebugLog('[NAV] AGENT_DISPLAY_POSITION_UPDATE_SKIPPED_SMALL_DELTA', {
                    deltaM: Math.round(deltaM * 100) / 100,
                    thresholdM: DISPLAY_AGENT_MIN_MOVE_M,
                  });
                }
              } else {
                lastDisplayAgentPositionRef.current = finalProj.projectedPoint;
                setDisplayAgentPosition(finalProj.projectedPoint);
                if (projLogNow - lastDisplayPositionLogAtRef.current >= 1000) {
                  lastDisplayPositionLogAtRef.current = projLogNow;
                  navDebugLog('[NAV] AGENT_DISPLAY_POSITION_STABLE_APPLIED', {
                    deltaM: Math.round(deltaM * 100) / 100,
                    segmentIndex: finalProj.segmentIndex,
                    projectedPoint: finalProj.projectedPoint,
                  });
                }
              }
            } else {
              // Projection too far from route — hold last valid snapped to prevent off-road marker.
              lastProjectionRef.current = null;
              projectionPoorFitCountRef.current = 0;
              motionStateRef.current.isProjected = false;
              if (lastValidSnappedRef.current) {
                snappedAgentTargetRef.current = lastValidSnappedRef.current;
                {
                  const ms = motionStateRef.current;
                  ms.integratorTargetPosition = lastValidSnappedRef.current;
                  ms.integratorTargetDistanceM = distanceMeters(ms.integratorPosition, lastValidSnappedRef.current);
                  ms.integratorLastTargetUpdateAt = now;
                }
                if (finalProj) {
                  const projNow = Date.now();
                  if (projNow - lastProjectionLogAtRef.current >= 2000) {
                    lastProjectionLogAtRef.current = projNow;
                    console.warn('[NAV] AGENT_RAW_FALLBACK_BLOCKED_HOLD_LAST_SNAPPED', {
                      rawPosition: rawGps,
                      lastValidSnappedPosition: lastValidSnappedRef.current,
                      projectionDistanceM: Math.round(finalProj.distanceM),
                      reason: 'projection_too_far',
                    });
                  }
                }
              } else {
                snappedAgentTargetRef.current = rawGps;
                {
                  const ms = motionStateRef.current;
                  ms.integratorTargetPosition = rawGps;
                  ms.integratorTargetDistanceM = distanceMeters(ms.integratorPosition, rawGps);
                  ms.integratorLastTargetUpdateAt = now;
                }
                const deltaM = lastDisplayAgentPositionRef.current
                  ? distanceMeters(lastDisplayAgentPositionRef.current, rawGps)
                  : Infinity;
                if (deltaM >= DISPLAY_AGENT_MIN_MOVE_M) {
                  lastDisplayAgentPositionRef.current = rawGps;
                  setDisplayAgentPosition(rawGps);
                }
                const projNow = Date.now();
                if (projNow - lastProjectionLogAtRef.current >= 2000) {
                  lastProjectionLogAtRef.current = projNow;
                  console.warn('[NAV] AGENT_RAW_FALLBACK_USED_NO_ROUTE', {
                    rawPosition: rawGps,
                    reason: 'no_valid_snapped_and_projection_far',
                  });
                }
              }
            }
          } else {
            // No route available
            lastProjectionRef.current = null;
            motionStateRef.current.isProjected = false;
            if (lastValidSnappedRef.current) {
              snappedAgentTargetRef.current = lastValidSnappedRef.current;
            } else {
              const rawGps2 = motionStateRef.current.rawGpsPosition;
              snappedAgentTargetRef.current = rawGps2;
              const deltaM = lastDisplayAgentPositionRef.current
                ? distanceMeters(lastDisplayAgentPositionRef.current, rawGps2)
                : Infinity;
              if (deltaM >= DISPLAY_AGENT_MIN_MOVE_M) {
                lastDisplayAgentPositionRef.current = rawGps2;
                setDisplayAgentPosition(rawGps2);
              }
            }
          }
        }
      }
      // ── end M1 rAF projection ───────────────────────────────────────

      // ── M1.5R-B: route-constrained velocity integrator ───────────────
      let nextVisual: LatLngPoint = motionStateRef.current.integratorPosition;
      {
        const ms = motionStateRef.current;
        const route = getMotionRoute();
        const progressValid = ms.integratorRouteProgressValid && route.length >= 2;

        const intPos = ms.integratorPosition;
        const intTgt = ms.integratorTargetPosition;
        const euclideanDist = distanceMeters(intPos, intTgt);
        const dtSec = dtMs / 1000;
        const gpsAgeSec = ms.lastGpsAt > 0 ? (now - ms.lastGpsAt) / 1000 : 0;
        const effectiveSpeed = latestAgentSpeedMpsRef.current;

        const progressLag = progressValid
          ? Math.max(0, ms.integratorTargetProgressM - ms.integratorRouteProgressM)
          : 0;
        const targetDist = progressValid ? progressLag : euclideanDist;

        const dynamicFastCatchup = Math.max(VISUAL_AGENT_FAST_CATCHUP_DIST_M, effectiveSpeed * 2.0);
        const hardTeleportDistM = Math.max(150, dynamicFastCatchup * 2.5);

        let newVelocity = ms.integratorVelocityMps;
        let newBearing = ms.integratorBearingDeg;
        let mode = 'stopped';
        let desiredSpeed = 0;
        const prevVelocity = newVelocity;
        const prevBearing = newBearing;

        if (euclideanDist > hardTeleportDistM) {
          nextVisual = intTgt;
          newVelocity = 0;
          if (progressValid) ms.integratorRouteProgressM = ms.integratorTargetProgressM;
        } else {
          const isStale = gpsAgeSec > INTEGRATOR_STALE_GPS_SEC;

          if (!isStale && targetDist >= INTEGRATOR_EPSILON_M) {
            if (effectiveSpeed > INTEGRATOR_STOP_SPEED_MPS) {
              desiredSpeed = Math.min(effectiveSpeed, INTEGRATOR_MAX_SPEED_MPS);
            } else {
              desiredSpeed = Math.min(
                targetDist / INTEGRATOR_EXPECTED_GPS_INTERVAL_SEC,
                INTEGRATOR_MAX_SPEED_MPS,
              );
            }
            if (desiredSpeed > 0) {
              const timeToTarget = targetDist / desiredSpeed;
              if (timeToTarget < INTEGRATOR_DECEL_WINDOW_SEC) {
                desiredSpeed *= timeToTarget / INTEGRATOR_DECEL_WINDOW_SEC;
              }
            }
          }

          const velDelta = desiredSpeed - newVelocity;
          newVelocity += Math.max(-INTEGRATOR_MAX_DECEL_MPS2 * dtSec,
            Math.min(INTEGRATOR_MAX_ACCEL_MPS2 * dtSec, velDelta));
          if (newVelocity < 0.01) newVelocity = 0;

          const prevMode = ms.integratorMode;
          if (newVelocity < 0.05) {
            mode = 'stopped';
          } else if (prevMode === 'cruise') {
            if (desiredSpeed > newVelocity + INTEGRATOR_CRUISE_HYSTERESIS_MPS) mode = 'accel';
            else if (desiredSpeed < newVelocity - INTEGRATOR_CRUISE_HYSTERESIS_MPS) mode = 'decel';
            else mode = 'cruise';
          } else {
            if (desiredSpeed > newVelocity + 0.1) mode = 'accel';
            else if (desiredSpeed < newVelocity - 0.1) mode = 'decel';
            else mode = 'cruise';
          }

          if (progressValid) {
            const currentPrg = ms.integratorRouteProgressM;
            const targetPrg = ms.integratorTargetProgressM;

            let catchupMul = 1.0;
            if (progressLag > 8) catchupMul = 1.5;
            else if (progressLag > 3) catchupMul = 1.2;

            const moveDist = newVelocity * dtSec * catchupMul;

            if (progressLag < INTEGRATOR_EPSILON_M) {
              ms.integratorRouteProgressM = targetPrg;
              nextVisual = intTgt;
            } else {
              const newProgress = Math.min(currentPrg + moveDist, targetPrg);
              ms.integratorRouteProgressM = newProgress;

              const sampled = sampleRouteAtDistance(route, newProgress);
              if (sampled) {
                nextVisual = sampled.position;
                {
                  const bDelta = shortestBearingDelta(ms.integratorBearingDeg, sampled.bearing);
                  const maxBD = INTEGRATOR_MAX_ANGULAR_VEL_DEG_S * dtSec;
                  newBearing = normalizeBearing(ms.integratorBearingDeg
                    + Math.max(-maxBD, Math.min(maxBD, bDelta)));
                }
                ms.integratorRouteBearingSource = 'route';
              } else {
                if (euclideanDist >= INTEGRATOR_EPSILON_M && moveDist > 0) {
                  const frac = Math.min(1, moveDist / euclideanDist);
                  nextVisual = {
                    lat: intPos.lat + frac * (intTgt.lat - intPos.lat),
                    lng: intPos.lng + frac * (intTgt.lng - intPos.lng),
                  };
                } else {
                  nextVisual = intPos;
                }
                if (distanceMeters(intPos, nextVisual) > 0.05) {
                  const rawB = bearingBetween(intPos, nextVisual);
                  const bDelta = shortestBearingDelta(ms.integratorBearingDeg, rawB);
                  const maxBD = INTEGRATOR_MAX_ANGULAR_VEL_DEG_S * dtSec;
                  newBearing = normalizeBearing(ms.integratorBearingDeg
                    + Math.max(-maxBD, Math.min(maxBD, bDelta)));
                }
                ms.integratorRouteBearingSource = 'euclidean';
              }
            }
          } else {
            const moveDist = newVelocity * dtSec;
            if (euclideanDist < INTEGRATOR_EPSILON_M || moveDist >= euclideanDist) {
              nextVisual = intTgt;
            } else if (moveDist > 0) {
              const frac = moveDist / euclideanDist;
              nextVisual = {
                lat: intPos.lat + (intTgt.lat - intPos.lat) * frac,
                lng: intPos.lng + (intTgt.lng - intPos.lng) * frac,
              };
            } else {
              nextVisual = intPos;
            }
            if (distanceMeters(intPos, nextVisual) > 0.05) {
              const rawB = bearingBetween(intPos, nextVisual);
              const bDelta = shortestBearingDelta(ms.integratorBearingDeg, rawB);
              const maxBD = INTEGRATOR_MAX_ANGULAR_VEL_DEG_S * dtSec;
              newBearing = normalizeBearing(ms.integratorBearingDeg
                + Math.max(-maxBD, Math.min(maxBD, bDelta)));
            }
            ms.integratorRouteBearingSource = 'euclidean';
          }
        }

        ms.integratorAccelMps2 = dtSec > 0 ? (newVelocity - prevVelocity) / dtSec : 0;
        ms.integratorAngularVelDegS = dtSec > 0
          ? Math.abs(shortestBearingDelta(prevBearing, newBearing)) / dtSec : 0;
        ms.integratorPosition = nextVisual;
        ms.integratorVelocityMps = newVelocity;
        ms.integratorBearingDeg = newBearing;
        ms.integratorTargetDistanceM = progressValid
          ? Math.max(0, ms.integratorTargetProgressM - ms.integratorRouteProgressM)
          : distanceMeters(nextVisual, intTgt);
        ms.integratorDesiredSpeedMps = desiredSpeed;
        ms.integratorIsSettled = newVelocity < 0.05 && ms.integratorTargetDistanceM < INTEGRATOR_EPSILON_M;
        ms.integratorMode = mode;

        if (progressValid) {
          const aheadS = sampleRouteAtDistance(route, ms.integratorRouteProgressM + INTEGRATOR_TURN_LOOKAHEAD_M);
          const tDelta = aheadS ? Math.abs(shortestBearingDelta(ms.integratorBearingDeg, aheadS.bearing)) : 0;
          ms.integratorTurnHeadingDeltaDeg = tDelta;
          ms.integratorTurnPhase = tDelta > INTEGRATOR_TURN_DETECT_DEG ? 'TURNING' : 'STRAIGHT';
        }
      }
      // ── end M1.5R-B integrator ────────────────────────────────────────
      visualAgentPositionRef.current = nextVisual;
      setVisualAgentPosition(nextVisual);
      motionStateRef.current.visualPosition = nextVisual;

      // ── Wrong-way detection / movement-bearing fallback (Phase 9) ────
      {
        const sampleFrom = lastMovementBearingSampleRef.current;
        const movementDistanceM = distanceMeters(sampleFrom, nextVisual);
        if (movementDistanceM >= WRONG_WAY_MOVEMENT_MIN_M) {
          const movementBearing = computeBearingBetween(sampleFrom, nextVisual);
          lastMovementBearingRef.current = movementBearing;
          lastMovementBearingSampleRef.current = nextVisual;

          const routeCandidate = getRouteGeometryBearingCandidate();
          const routeBearing = routeCandidate.bearing;
          const delta = Math.abs(shortestBearingDelta(routeBearing, movementBearing));
          const speed = latestGpsSpeedRef.current;
          const isEligible = cameraModeRef.current === 'navigation_follow'
            && isCameraFollowingRef.current
            && routeCandidate.source !== 'gps'
            && routeCandidate.source !== 'fallback'
            && (movementDistanceM >= WRONG_WAY_MOVEMENT_MIN_M || speed >= WRONG_WAY_SPEED_MIN_MPS);

          if (isEligible) {
            if (delta > WRONG_WAY_DETECT_DELTA_DEG) {
              wrongWayTicksRef.current += 1;
              wrongWayClearTicksRef.current = 0;
              if (!wrongWayRef.current && wrongWayTicksRef.current >= WRONG_WAY_TICKS_REQUIRED) {
                wrongWayRef.current = true;
                setIsWrongWay(true);
                navDebugLog('[NAV] WRONG_WAY_DETECTED', {
                  routeBearing: Math.round(routeBearing),
                  movementBearing: Math.round(movementBearing),
                  delta: Math.round(delta),
                  movementDistanceM: Math.round(movementDistanceM * 100) / 100,
                  speed: Math.round(speed * 10) / 10,
                });
              }
            } else if (delta < WRONG_WAY_CLEAR_DELTA_DEG) {
              wrongWayClearTicksRef.current += 1;
              wrongWayTicksRef.current = 0;
              if (wrongWayRef.current && wrongWayClearTicksRef.current >= WRONG_WAY_TICKS_REQUIRED) {
                wrongWayRef.current = false;
                setIsWrongWay(false);
                navDebugLog('[NAV] WRONG_WAY_CLEARED', {
                  routeBearing: Math.round(routeBearing),
                  movementBearing: Math.round(movementBearing),
                  delta: Math.round(delta),
                });
              }
            } else {
              wrongWayTicksRef.current = 0;
              wrongWayClearTicksRef.current = 0;
            }
          }

          const wwNow = Date.now();
          if (wwNow - lastWrongWayLogAtRef.current >= 1000) {
            lastWrongWayLogAtRef.current = wwNow;
            navDebugLog('[NAV] WRONG_WAY_CHECK', {
              routeBearing: Math.round(routeBearing),
              movementBearing: Math.round(movementBearing),
              delta: Math.round(delta),
              movementDistanceM: Math.round(movementDistanceM * 100) / 100,
              speed: Math.round(speed * 10) / 10,
              wrongWayTicks: wrongWayTicksRef.current,
              clearTicks: wrongWayClearTicksRef.current,
              wrongWay: wrongWayRef.current,
              eligible: isEligible,
              routeBearingSource: routeCandidate.source,
            });
          }
        }

        if (wrongWayRef.current && lastMovementBearingRef.current !== null) {
          const overrideBearing = normalizeBearing(lastMovementBearingRef.current);
          targetMarkerBearingRef.current = overrideBearing;

          const overrideNow = Date.now();
          if (overrideNow - lastWrongWayOverrideLogAtRef.current >= 1000) {
            lastWrongWayOverrideLogAtRef.current = overrideNow;
            navDebugLog('[NAV] WRONG_WAY_BEARING_OVERRIDE_APPLIED', {
              targetMarkerBearing: Math.round(overrideBearing),
              source: 'wrong_way_movement_bearing',
            });
          }
        }
      }

      // ── Route tail anchor sync (Phase 6) ──────────────────────────────
      {
        const routeForTail = getMotionRoute();
        if (routeForTail.length >= 2) {
          const tailNow = Date.now();
          const currentAnchor = routeTailAnchorRef.current;
          const lockedProjection = lastProjectionRef.current;
          const validLockedSegment = lockedProjection
            && lockedProjection.routeVersion === routeVersionRef.current
            && lockedProjection.routePathLen === routeForTail.length
            && lockedProjection.segmentIndex < routeForTail.length - 1;
          const projectedTail = validLockedSegment
            ? projectPointToRouteRange(
              nextVisual,
              routeForTail,
              Math.max(0, lockedProjection.segmentIndex - 1),
              Math.min(routeForTail.length - 2, lockedProjection.segmentIndex + 1),
            )
            : projectPointToRoute(nextVisual, routeForTail);

          const currentRouteStart = currentAnchor
            && currentAnchor.routeVersion === routeVersionRef.current
            && currentAnchor.routePathLen === routeForTail.length
            ? currentAnchor.point
            : (renderedRoutePathRef.current.length >= 1 ? renderedRoutePathRef.current[0] : displayAgentPosition);
          const gapBeforeM = currentRouteStart ? distanceMeters(nextVisual, currentRouteStart) : Infinity;

          if (!projectedTail || projectedTail.distanceM > ROUTE_TAIL_ANCHOR_MAX_PROJECTION_DIST_M) {
            if (tailNow - lastRouteTailAnchorLogAtRef.current >= 1000) {
              lastRouteTailAnchorLogAtRef.current = tailNow;
              navDebugLog('[NAV] ROUTE_TAIL_ANCHOR_SKIPPED', {
                reason: 'projection_failed',
                gapM: Math.round(gapBeforeM * 100) / 100,
                projectionDistanceM: projectedTail ? Math.round(projectedTail.distanceM * 100) / 100 : null,
                thresholdM: ROUTE_TAIL_ANCHOR_MAX_PROJECTION_DIST_M,
                timeSinceLastUpdateMs: currentAnchor ? tailNow - currentAnchor.updatedAt : null,
              });
            }
          } else {
            const nextAnchor: RouteTailAnchor = {
              point: projectedTail.projectedPoint,
              segmentIndex: projectedTail.segmentIndex,
              routeVersion: routeVersionRef.current,
              routePathLen: routeForTail.length,
              updatedAt: tailNow,
              source: 'visual_projection',
            };
            const hasValidCurrentAnchor = currentAnchor
              && currentAnchor.routeVersion === routeVersionRef.current
              && currentAnchor.routePathLen === routeForTail.length
              && currentAnchor.segmentIndex < routeForTail.length - 1;
            const movedM = hasValidCurrentAnchor
              ? distanceMeters(currentAnchor.point, nextAnchor.point)
              : Infinity;
            const timeSinceLastUpdateMs = hasValidCurrentAnchor
              ? tailNow - currentAnchor.updatedAt
              : Infinity;
            const gapAfterM = distanceMeters(nextVisual, nextAnchor.point);

            let skipReason: 'small_move' | 'throttled' | null = null;
            if (hasValidCurrentAnchor && timeSinceLastUpdateMs < ROUTE_TAIL_ANCHOR_UPDATE_INTERVAL_MS) {
              skipReason = 'throttled';
            } else if (hasValidCurrentAnchor && movedM < ROUTE_TAIL_ANCHOR_MIN_MOVE_M) {
              skipReason = 'small_move';
            }

            if (skipReason) {
              if (tailNow - lastRouteTailAnchorLogAtRef.current >= 1000) {
                lastRouteTailAnchorLogAtRef.current = tailNow;
                navDebugLog('[NAV] ROUTE_TAIL_ANCHOR_SKIPPED', {
                  reason: skipReason,
                  gapM: Math.round(gapBeforeM * 100) / 100,
                  movedM: Math.round(movedM * 100) / 100,
                  thresholdM: ROUTE_TAIL_ANCHOR_MIN_MOVE_M,
                  timeSinceLastUpdateMs: Math.round(timeSinceLastUpdateMs),
                });
              }
            } else {
              routeTailAnchorRef.current = nextAnchor;
              setRouteTailAnchor(nextAnchor);
              if (tailNow - tailAnchorUpdateCountWindowRef.current.startMs >= 1000) {
                tailAnchorUpdateCountWindowRef.current = { startMs: tailNow, count: 1 };
              } else {
                tailAnchorUpdateCountWindowRef.current.count += 1;
              }
              if (tailNow - lastRouteTailAnchorLogAtRef.current >= 1000) {
                lastRouteTailAnchorLogAtRef.current = tailNow;
                navDebugLog('[NAV] ROUTE_TAIL_ANCHOR_UPDATED', {
                  previousAnchor: hasValidCurrentAnchor ? currentAnchor.point : null,
                  nextAnchor: nextAnchor.point,
                  movedM: Number.isFinite(movedM) ? Math.round(movedM * 100) / 100 : null,
                  gapBeforeM: Math.round(gapBeforeM * 100) / 100,
                  gapAfterM: Math.round(gapAfterM * 100) / 100,
                  updateIntervalMs: Number.isFinite(timeSinceLastUpdateMs) ? Math.round(timeSinceLastUpdateMs) : null,
                  segmentIndex: nextAnchor.segmentIndex,
                  routeVersion: nextAnchor.routeVersion,
                });
              }
            }
          }
        }
      }

      // ── Style-based route tail trim (SOURCE_COPY_CONTINUOUS_TRIM) ─────
      // Ported from page.tsx:4345-4491. Hides the passed route by updating
      // line paint only — never mutates routeSourceData/stableRouteSourcePath.
      {
        const sourcePath = stableRouteSourcePathRef.current;
        const trimNow = Date.now();

        if (routeTrimRouteVersionRef.current !== routeVersionRef.current) {
          const isIdentityChange = routeTrimSourceKeyRef.current !== routeSourceKeyRef.current;
          routeTrimRouteVersionRef.current = routeVersionRef.current;
          if (isIdentityChange) {
            routeTrimSourceKeyRef.current = routeSourceKeyRef.current;
            routeTrimProgressRef.current = 0;
            lastRouteTrimDistanceMRef.current = 0;
            lastRouteTrimPaintAtRef.current = 0;
            hasSeededInitialRouteTrimRef.current = false;
            seededRouteTrimVersionRef.current = null;
            hasLoggedFirstMovementTrimNoJumpRef.current = false;
            navDebugLog('[NAV] ROUTE_TRIM_RESET_ALLOWED', {
              routeVersion: routeVersionRef.current,
              routeSourceKey: routeSourceKeyRef.current,
              reason: 'identity_change',
            });
          } else {
            lastRouteTrimPaintAtRef.current = 0; // force recompute, preserve progress
            navDebugLog('[NAV] ROUTE_TRIM_RESET_BLOCKED', {
              routeVersion: routeVersionRef.current,
              routeSourceKey: routeSourceKeyRef.current,
              reason: 'mt_dstar_incremental',
              keptProgress: routeTrimProgressRef.current,
            });
          }
        }

        if (sourcePath.length < 2) {
          if (routeTrimProgressRef.current !== 0) {
            routeTrimProgressRef.current = 0;
            lastRouteTrimDistanceMRef.current = 0;
            setRouteTrimPaint(0, 'no_stable_source_path');
          }
        } else {
          const trim = computeRouteTrimProgress(
            nextVisual,
            sourcePath,
            ROUTE_TRIM_MAX_PROJECTION_DIST_M,
          );

          if (!trim) {
            if (trimNow - lastRouteTrimWarningAtRef.current >= 2000) {
              lastRouteTrimWarningAtRef.current = trimNow;
              navDebugLog('[NAV] ROUTE_STYLE_TRIM_SKIPPED', {
                reason: 'projection_failed',
                visualAgentPosition: nextVisual,
                sourcePathLen: sourcePath.length,
                routeVersion: routeVersionRef.current,
              });
            }
          } else {
            if (!hasSeededInitialRouteTrimRef.current || seededRouteTrimVersionRef.current !== routeVersionRef.current) {
              seedInitialRouteTrim('raf_before_first_trim');
            }

            const previousProgress = routeTrimProgressRef.current;
            const previousDistanceM = lastRouteTrimDistanceMRef.current;
            const currentTrimGeometrySignature = lastRouteSourceSignatureRef.current;
            const geometryBasisChanged = hasRouteTrimGeometryBasisChanged(
              currentTrimGeometrySignature,
              presentationShadowTrimBasisSignatureRef.current,
            );
            const clampedProgress = trim.progress < previousProgress ? previousProgress : trim.progress;
            const clampedDistanceM = trim.distanceAlongRouteM < previousDistanceM ? previousDistanceM : trim.distanceAlongRouteM;
            const nextTrimProgress = geometryBasisChanged ? trim.progress : clampedProgress;
            const nextTrimDistanceM = geometryBasisChanged ? trim.distanceAlongRouteM : clampedDistanceM;
            const progressDelta = Math.abs(nextTrimProgress - previousProgress);
            const distanceDeltaM = Math.abs(nextTrimDistanceM - previousDistanceM);
            const shouldApplyTrim = shouldApplyRouteTrimPaint({
              currentGeometrySignature: currentTrimGeometrySignature,
              trimBasisSignature: presentationShadowTrimBasisSignatureRef.current,
              lastPaintAtMs: lastRouteTrimPaintAtRef.current,
              nowMs: trimNow,
              distanceDeltaM,
              progressDelta,
              minAdvanceM: ROUTE_TRIM_MIN_ADVANCE_M,
              minProgressDelta: ROUTE_TRIM_MIN_PROGRESS_DELTA,
              paintIntervalMs: ROUTE_TRIM_PAINT_INTERVAL_MS,
            });

            if (shouldApplyTrim) {
              const applied = setRouteTrimPaint(
                nextTrimProgress,
                geometryBasisChanged
                  ? 'geometry_basis_rebase'
                  : trim.progress < previousProgress ? 'backtrack_clamped' : 'agent_progress',
                trim,
              );
              if (applied) {
                routeTrimProgressRef.current = nextTrimProgress;
                presentationShadowTrimBasisSignatureRef.current = currentTrimGeometrySignature;
                lastRouteTrimDistanceMRef.current = nextTrimDistanceM;
                lastRouteTrimPaintAtRef.current = trimNow;
                if (!hasLoggedFirstMovementTrimNoJumpRef.current && previousProgress > 0) {
                  hasLoggedFirstMovementTrimNoJumpRef.current = true;
                  navDebugLog('[NAV] ROUTE_STYLE_TRIM_FIRST_MOVEMENT_NO_JUMP', {
                    previousProgress: Math.round(previousProgress * 10000) / 10000,
                    nextProgress: Math.round(nextTrimProgress * 10000) / 10000,
                    previousDistanceM: Math.round(previousDistanceM * 100) / 100,
                    nextDistanceM: Math.round(nextTrimDistanceM * 100) / 100,
                    routeVersion: routeVersionRef.current,
                    sourceDataMutated: false,
                  });
                }
              }
            } else if (trimNow - lastRouteTrimWarningAtRef.current >= 2000) {
              lastRouteTrimWarningAtRef.current = trimNow;
              navDebugLog('[NAV] ROUTE_STYLE_TRIM_SKIPPED', {
                reason: distanceDeltaM < ROUTE_TRIM_MIN_ADVANCE_M && progressDelta < ROUTE_TRIM_MIN_PROGRESS_DELTA
                  ? 'small_distance_delta'
                  : 'throttled',
                progress: Math.round(nextTrimProgress * 10000) / 10000,
                previousProgress: Math.round(previousProgress * 10000) / 10000,
                distanceAlongRouteM: Math.round(nextTrimDistanceM * 100) / 100,
                geometryBasisChanged,
              });
            }
          }
        }
      }
      // ── end continuous trim ───────────────────────────────────────────

      // ── Visual marker bearing lerp (SOURCE_COPY_MARKER_BEARING) ───────
      {
        const msB = motionStateRef.current;
        const tBearing = (msB.integratorRouteProgressValid && msB.integratorRouteBearingSource === 'route')
          ? msB.integratorBearingDeg
          : targetMarkerBearingRef.current;
        const vBearing = visualMarkerBearingRef.current;
        const bDelta = shortestBearingDelta(vBearing, tBearing);
        let nextVisualBearing: number;
        if (Math.abs(bDelta) < MARKER_BEARING_VISUAL_DEAD_ZONE_DEG) {
          nextVisualBearing = vBearing;
        } else {
          const alpha = 1 - Math.exp(-dtMs / MARKER_BEARING_SMOOTH_TIME_MS);
          nextVisualBearing = normalizeBearing(vBearing + bDelta * alpha);
        }
        visualMarkerBearingRef.current = nextVisualBearing;
        setVisualMarkerBearing(nextVisualBearing);
        motionStateRef.current.visualMarkerBearing = nextVisualBearing;
        motionStateRef.current.targetMarkerBearing = targetMarkerBearingRef.current;

        const bmNow = Date.now();
        if (bmNow - lastMarkerBearingVisualLogAtRef.current >= 1000) {
          lastMarkerBearingVisualLogAtRef.current = bmNow;
          navDebugLog('[NAV] MARKER_BEARING_VISUAL_SMOOTHED', {
            dtMs: Math.round(dtMs),
            targetBearing: Math.round(tBearing),
            visualBearing: Math.round(nextVisualBearing),
          });
        }
      }

      // ── Camera follow (visual anchor) — SOURCE_COPY_CAMERA_FOLLOW_CORE ──
      // Ported from page.tsx:4545-4894. Every instrumentation callback, PR1/PR2a,
      // and NAV_DEBUG-gated MotionState-diagnostic write is omitted (AUTHORIZED_
      // CAMERA_DEBUG_SHADOW_OMISSION) — decision logic, thresholds, dt usage,
      // and jumpTo argument shape are otherwise unchanged.
      if (isCameraFollowingRef.current && mapRef.current) {
        const isNav = cameraModeRef.current === 'navigation_follow';
        let visualCameraBearingLocal = visualCameraBearingRef.current;
        let deltaVisualToTarget: number | null = null;

        const softElapsedMs = softFollowStartAtRef.current > 0
          ? now - softFollowStartAtRef.current
          : Infinity;
        const softT = Math.min(1, softElapsedMs / SOFT_FOLLOW_DURATION_MS);
        const easedT = softT * softT * (3 - 2 * softT);
        const activeLookAheadM = LOOK_AHEAD_M * easedT;
        const activePitch = softFollowInitialPitchRef.current
          + easedT * (NAV_FOLLOW_PITCH - softFollowInitialPitchRef.current);
        const activeZoom = softFollowInitialZoomRef.current
          + easedT * (NAV_FOLLOW_ZOOM - softFollowInitialZoomRef.current);
        const activePaddingBottom = Math.round(CAMERA_NAV_BOTTOM_PAD_PX * easedT);

        if (isNav && softT >= 1 && softFollowStartAtRef.current > 0) {
          navDebugLog('[CAM] CAMERA_SOFT_FOLLOW_COMPLETE', {
            elapsedMs: Math.round(now - softFollowStartAtRef.current),
            pitch: NAV_FOLLOW_PITCH,
            zoom: NAV_FOLLOW_ZOOM,
            paddingBottom: CAMERA_NAV_BOTTOM_PAD_PX,
            lookAheadM: LOOK_AHEAD_M,
          });
          softFollowStartAtRef.current = 0;
        }

        if (isNav && softT < 1) {
          const logNow = Date.now();
          if (logNow - lastSoftFollowLogAtRef.current >= 500) {
            lastSoftFollowLogAtRef.current = logNow;
            navDebugLog('[CAM] CAMERA_SOFT_FOLLOW_RAMP_APPLIED', {
              softT: Math.round(softT * 1000) / 1000,
              easedT: Math.round(easedT * 1000) / 1000,
              activeLookAheadM: Math.round(activeLookAheadM * 10) / 10,
              activePitch: Math.round(activePitch * 10) / 10,
              activeZoom: Math.round(activeZoom * 100) / 100,
              activePaddingBottom,
            });
          }
        }

        if (isNav) {
          const selectedCam = getCameraBearing();
          targetCameraBearingRef.current = selectedCam.bearing;
          targetCameraBearingSourceRef.current = selectedCam.source;
          targetCameraBearingSegmentRef.current = null;
          motionStateRef.current.cameraBearingSource = selectedCam.source;
          const currentVisual = Number.isFinite(visualCameraBearingRef.current)
            ? visualCameraBearingRef.current
            : (mapRef.current.getBearing() ?? mapHeadingRef.current ?? selectedCam.bearing);
          const targetBearing = targetCameraBearingRef.current;
          const turnDelta = shortestBearingDelta(currentVisual, targetBearing);
          deltaVisualToTarget = turnDelta;

          if (Math.abs(turnDelta) < CAMERA_TURN_DEAD_ZONE_DEG) {
            visualCameraBearingLocal = currentVisual;
          } else {
            const turnAlpha = 1 - Math.exp(-dtMs / CAMERA_TURN_SMOOTH_TIME_MS);
            visualCameraBearingLocal = normalizeBearing(currentVisual + turnDelta * turnAlpha);
          }

          visualCameraBearingRef.current = visualCameraBearingLocal;
          lastRequestedCameraBearingRef.current = targetBearing;
          motionStateRef.current.visualCameraBearing = visualCameraBearingLocal;
          motionStateRef.current.targetCameraBearing = targetCameraBearingRef.current;
          motionStateRef.current.isTurning = Math.abs(turnDelta) > CAMERA_TURN_DEAD_ZONE_DEG;

          const turnNow = Date.now();
          if (turnNow - lastCameraTurnFrameLogAtRef.current >= 1000) {
            lastCameraTurnFrameLogAtRef.current = turnNow;
            navDebugLog('[CAM] CAMERA_TURN_SMOOTHING_FRAME', {
              dtMs: Math.round(dtMs),
              source: targetCameraBearingSourceRef.current,
              segmentIndex: targetCameraBearingSegmentRef.current,
              targetCameraBearing: Math.round(targetBearing),
              visualCameraBearing: Math.round(visualCameraBearingLocal),
              actualMapBearing: Math.round(mapRef.current.getBearing() ?? mapHeadingRef.current),
              deltaVisualToTarget: Math.round(turnDelta * 100) / 100,
              deadZoneDeg: CAMERA_TURN_DEAD_ZONE_DEG,
            });
          }
        }

        const centerBearing = isNav ? visualCameraBearingLocal : 0;
        const targetCenter = isNav
          ? computeLookAheadCenter(nextVisual, centerBearing, activeLookAheadM)
          : nextVisual;

        const prevCamCenter = visualCameraCenterRef.current;
        let smoothedCenter: LatLngPoint;

        if (!prevCamCenter) {
          smoothedCenter = targetCenter;
        } else {
          const remainingM = distanceMeters(prevCamCenter, targetCenter);
          if (remainingM < CAMERA_CENTER_EPSILON_M) {
            smoothedCenter = targetCenter;
          } else if (remainingM > CAMERA_CENTER_SNAP_DIST_M && softT < 1) {
            const alpha = 1 - Math.exp(-dtMs / CAMERA_CENTER_SMOOTH_TIME_MS);
            smoothedCenter = {
              lat: prevCamCenter.lat + (targetCenter.lat - prevCamCenter.lat) * alpha,
              lng: prevCamCenter.lng + (targetCenter.lng - prevCamCenter.lng) * alpha,
            };
            navDebugLog('[CAM] CAMERA_SOFT_FOLLOW_SNAP_BLOCKED', {
              softT: Math.round(softT * 1000) / 1000,
              distanceM: Math.round(remainingM),
            });
          } else if (remainingM > CAMERA_CENTER_SNAP_DIST_M) {
            smoothedCenter = targetCenter;
            navDebugLog('[CAM] CAMERA_CENTER_SNAP_TO_TARGET', {
              reason: 'large_jump',
              distanceM: Math.round(remainingM),
              targetCenter,
            });
          } else {
            const alpha = 1 - Math.exp(-dtMs / CAMERA_CENTER_SMOOTH_TIME_MS);
            smoothedCenter = {
              lat: prevCamCenter.lat + (targetCenter.lat - prevCamCenter.lat) * alpha,
              lng: prevCamCenter.lng + (targetCenter.lng - prevCamCenter.lng) * alpha,
            };
          }
        }
        visualCameraCenterRef.current = smoothedCenter;
        motionStateRef.current.visualCameraCenter = smoothedCenter;

        const nowMs = Date.now();
        if (isModeTransitionRef.current) {
          if (isNav && nowMs - lastCamBearingLogAtRef.current >= 2000) {
            lastCamBearingLogAtRef.current = nowMs;
            navDebugLog('[CAM] CAMERA_CENTER_UPDATE_HELD_DURING_MODE_TRANSITION', {
              reason: 'protect_mode_transition',
            });
          }
        } else if (isBearingEasingRef.current) {
          if (isNav && nowMs - lastCamBearingLogAtRef.current >= 2000) {
            lastCamBearingLogAtRef.current = nowMs;
            const remaining = prevCamCenter
              ? Math.round(distanceMeters(smoothedCenter, targetCenter) * 100) / 100
              : 0;
            navDebugLog('[CAM] CAMERA_CENTER_UPDATE_HELD_DURING_BEARING_EASE', {
              targetCenter,
              inMemorySmoothedCenter: smoothedCenter,
              isBearingEasing: true,
              remainingDistanceM: remaining,
              reason: 'avoid_interrupting_bearing_ease',
            });
          }
        } else {
          const msCenter = motionStateRef.current.visualCameraCenter;
          const msBearing = motionStateRef.current.visualCameraBearing;
          mapRef.current.jumpTo({
            center: [msCenter.lng, msCenter.lat],
            ...(isNav ? {
              pitch: activePitch,
              zoom: activeZoom,
              bearing: msBearing,
              padding: { top: 0, bottom: activePaddingBottom, left: 0, right: 0 },
            } : {
              padding: { top: 0, bottom: 0, left: 0, right: 0 },
            }),
          });
          if (isNav) {
            const actualAfterJump = mapRef.current.getBearing() ?? visualCameraBearingLocal;
            lastAppliedCameraBearingRef.current = actualAfterJump;
            if (nowMs - lastCameraTurnApplyLogAtRef.current >= 1000) {
              lastCameraTurnApplyLogAtRef.current = nowMs;
              navDebugLog('[CAM] CAMERA_TURN_APPLIED_WITH_FOLLOW', {
                targetCameraBearing: Math.round(targetCameraBearingRef.current),
                visualCameraBearing: Math.round(visualCameraBearingLocal),
                actualMapBearing: Math.round(actualAfterJump),
                deltaVisualToTarget: deltaVisualToTarget !== null ? Math.round(deltaVisualToTarget * 100) / 100 : null,
                source: targetCameraBearingSourceRef.current,
                segmentIndex: targetCameraBearingSegmentRef.current,
                pitch: Math.round(activePitch * 10) / 10,
                zoom: Math.round(activeZoom * 100) / 100,
                bottomPadPx: activePaddingBottom,
                softT: Math.round(softT * 1000) / 1000,
              });
            }
          }
          if (nowMs - lastCamVisualLogAtRef.current >= 1000) {
            lastCamVisualLogAtRef.current = nowMs;
            const remaining = prevCamCenter
              ? Math.round(distanceMeters(smoothedCenter, targetCenter) * 100) / 100
              : 0;
            navDebugLog('[CAM] CAMERA_CENTER_SMOOTHED', {
              dtMs: Math.round(dtMs),
              targetCenter,
              appliedCenter: smoothedCenter,
              remainingDistanceM: remaining,
              isBearingEasing: false,
              cameraMode: cameraModeRef.current,
            });
          }
        }
      } else if (!isCameraFollowingRef.current && (pathRef.current.length >= 2 || routeVersionRef.current > 0)) {
        const skipNow = Date.now();
        if (cameraModeRef.current === 'navigation_follow' && skipNow - lastCameraTurnSkipLogAtRef.current >= 3000) {
          lastCameraTurnSkipLogAtRef.current = skipNow;
          navDebugLog('[CAM] CAMERA_TURN_SKIPPED_FREE_EXPLORE', {
            cameraMode: cameraModeRef.current,
            isCameraFollowing: false,
            targetCameraBearing: Math.round(targetCameraBearingRef.current),
            visualCameraBearing: Math.round(visualCameraBearingRef.current),
          });
        }
        if (skipNow - lastFreeExploreSkipLogAtRef.current >= 3000) {
          lastFreeExploreSkipLogAtRef.current = skipNow;
          navDebugLog('[CAM] CAMERA_AUTO_FOLLOW_SKIPPED_USER_CONTROL', {
            cameraMode: cameraModeRef.current,
            hasStartedMoving: hasStartedMovingRef.current,
            isCameraFollowing: false,
            userCameraOverride: userCameraOverrideRef.current,
          });
        }
      }
      // ── end camera follow ─────────────────────────────────────────────

      visualAnimFrameRef.current = requestAnimationFrame(runFrame);
    };

    visualAnimFrameRef.current = requestAnimationFrame(runFrame);

    return () => {
      isVisualLoopRunningRef.current = false;
      if (visualAnimFrameRef.current !== null) {
        cancelAnimationFrame(visualAnimFrameRef.current);
        visualAnimFrameRef.current = null;
      }
      navDebugLog('[NAV] AGENT_VISUAL_LOOP_STOPPED', { reason: 'unmount' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mode-transition/bearing-ease cleanup, ported verbatim from page.tsx:3143-3150.
  useEffect(() => {
    const btRef = bearingEaseTimeoutRef;
    const mtRef = modeTransitionTimeoutRef;
    return () => {
      if (btRef.current !== null) clearTimeout(btRef.current);
      if (mtRef.current !== null) clearTimeout(mtRef.current);
    };
  }, []);

  // SOURCE_COPY_CAMERA_FOLLOW_CORE — soft-follow seed, ported verbatim from
  // page.tsx:6603-6654 (fires exactly once when movement first detected).
  useEffect(() => {
    if (cameraMode !== 'navigation_follow' || !mapRef.current) return;

    if (bearingEaseTimeoutRef.current !== null) {
      clearTimeout(bearingEaseTimeoutRef.current);
      bearingEaseTimeoutRef.current = null;
    }
    if (modeTransitionTimeoutRef.current !== null) {
      clearTimeout(modeTransitionTimeoutRef.current);
      modeTransitionTimeoutRef.current = null;
    }

    const mc = mapRef.current.getCenter();
    visualCameraCenterRef.current = { lat: mc.lat, lng: mc.lng };

    const actualBearing = mapRef.current.getBearing() ?? mapHeadingRef.current ?? 0;
    lastAppliedCameraBearingRef.current = actualBearing;
    visualCameraBearingRef.current = actualBearing;
    lastRequestedCameraBearingRef.current = actualBearing;
    targetCameraBearingRef.current = normalizeBearing(actualBearing);

    softFollowInitialPitchRef.current = mapRef.current.getPitch() ?? 0;
    softFollowInitialZoomRef.current = mapRef.current.getZoom() ?? NAV_FOLLOW_ZOOM;
    softFollowInitialPaddingBottomRef.current = 0;
    softFollowStartAtRef.current = performance.now();

    isBearingEasingRef.current = false;
    isModeTransitionRef.current = false;

    navDebugLog('[CAM] CAMERA_SOFT_FOLLOW_STARTED', {
      center: { lat: mc.lat, lng: mc.lng },
      bearing: Math.round(actualBearing),
      initialPitch: softFollowInitialPitchRef.current,
      initialZoom: softFollowInitialZoomRef.current,
      softFollowDurationMs: SOFT_FOLLOW_DURATION_MS,
      hasStartedMoving: hasStartedMovingRef.current,
      cameraMode,
    });
    navDebugLog('[CAM] CAMERA_MODE_CHANGED', {
      from: 'top_down', to: 'navigation_follow',
      bearing: Math.round(actualBearing),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode]);

  // Route-update bearing alignment, ported verbatim from page.tsx:6658-6662.
  useEffect(() => {
    if (path.length < 2) return;
    if (cameraModeRef.current !== 'navigation_follow') return;
    updateTargetCameraBearing('path_update');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Log initial top_down on mount, ported verbatim from page.tsx:6665-6667.
  useEffect(() => {
    navDebugLog('[CAM] CAMERA_TOP_DOWN_APPLIED', { pitch: 0, zoom: 16, reason: 'mount' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SOURCE_COPY_MARKER_BEARING — locked route tangent is primary, GPS is
  // fallback only, ported verbatim from page.tsx:6670-6713.
  const markerBearingInfo = useMemo<StableMarkerBearingInfo>(() => {
    const rawInfo = getMarkerWorldBearingCandidate();

    const rawBearing = normalizeBearing(rawInfo.bearing);
    const previous = lastMarkerBearingRef.current;
    if (!previous || previous.source !== rawInfo.source) {
      const initial = {
        bearing: rawBearing,
        source: rawInfo.source,
        segmentIndex: rawInfo.segmentIndex,
        rawBearing,
        delta: 0,
        skippedSmallDelta: false,
      };
      lastMarkerBearingRef.current = initial;
      return initial;
    }

    const delta = shortestBearingDelta(previous.bearing, rawBearing);
    if (Math.abs(delta) < MARKER_BEARING_VISUAL_DEAD_ZONE_DEG) {
      const stabilized = {
        bearing: previous.bearing,
        source: rawInfo.source,
        segmentIndex: rawInfo.segmentIndex,
        rawBearing,
        delta,
        skippedSmallDelta: true,
      };
      lastMarkerBearingRef.current = stabilized;
      return stabilized;
    }

    const appliedBearing = normalizeBearing(rawBearing);
    const stabilized = {
      bearing: appliedBearing,
      source: rawInfo.source,
      segmentIndex: rawInfo.segmentIndex,
      rawBearing,
      delta,
      skippedSmallDelta: false,
    };
    lastMarkerBearingRef.current = stabilized;
    return stabilized;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayAgentPosition, hasGpsHeading, gpsHeading, isWrongWay, mapHeading, path, renderedRoutePath, routeVersion]);

  // Sync currentMarkerBearingSourceRef + diagnostic logs, ported verbatim
  // from page.tsx:6715-6752 (the two navDebugLog calls at 6757/6764 are the
  // only production-adjacent output — omitted the third, purely-diagnostic
  // renderedRoutePath-detail log per AUTHORIZED_CAMERA_DEBUG_SHADOW_OMISSION).
  useEffect(() => {
    const prev = prevMarkerBearingSourceRef.current;
    const prevSegment = currentMarkerBearingSegmentRef.current;
    const { source, segmentIndex } = markerBearingInfo;

    currentMarkerBearingSourceRef.current = source;
    currentMarkerBearingSegmentRef.current = segmentIndex;

    if (prev !== source || prevSegment !== segmentIndex) {
      navDebugLog('[NAV] MARKER_BEARING_SOURCE_SELECTED', {
        from: prev,
        to: source,
        source,
        segmentIndex,
        wrongWay: wrongWayRef.current,
        hasGpsHeading,
        pathLen: path.length,
      });
      prevMarkerBearingSourceRef.current = source;
    }

    const nowLog = Date.now();
    if (nowLog - lastMarkerBearingLogAtRef.current >= 1000) {
      lastMarkerBearingLogAtRef.current = nowLog;
      navDebugLog('[NAV] MARKER_BEARING_APPLIED', {
        source,
        segmentIndex,
        wrongWay: wrongWayRef.current,
        hasGpsHeading,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerBearingInfo]);

  // Sync targetMarkerBearingRef from markerBearingInfo, ported verbatim from
  // page.tsx:6780-6792 (React-render-cadence primary writer of
  // targetMarkerBearingRef — wrong-way's rAF-loop override, ported in Phase
  // 5C-10, layers on top of this each frame, matching source exactly).
  // Diagnostic-only console.log calls at page.tsx:6793-6851 omitted.
  useEffect(() => {
    const newTarget = normalizeBearing(markerBearingInfo.bearing);
    const prevTarget = targetMarkerBearingRef.current;
    targetMarkerBearingRef.current = newTarget;

    // Also seed visual ref on first mount so there is no 0→target sweep at startup
    if (visualMarkerBearingRef.current === 0 && prevTarget === 0) {
      visualMarkerBearingRef.current = newTarget;
      setVisualMarkerBearing(newTarget);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerBearingInfo]);

  // When the user leaves active follow, refresh marker world bearing
  // immediately, ported verbatim from page.tsx:6857-6880.
  useEffect(() => {
    const wasFollowing = prevIsCameraFollowingForMarkerRef.current;
    prevIsCameraFollowingForMarkerRef.current = isCameraFollowing;
    if (!wasFollowing || isCameraFollowing) return;

    const candidate = getMarkerWorldBearingCandidate();
    const refreshedBearing = normalizeBearing(candidate.bearing);

    targetMarkerBearingRef.current = refreshedBearing;
    visualMarkerBearingRef.current = refreshedBearing;
    setVisualMarkerBearing(refreshedBearing);
    currentMarkerBearingSourceRef.current = candidate.source;
    currentMarkerBearingSegmentRef.current = candidate.segmentIndex;

    navDebugLog('[NAV] MARKER_FREE_EXPLORE_BEARING_REFRESHED', {
      refreshedBearing: Math.round(refreshedBearing),
      source: candidate.source,
      segmentIndex: candidate.segmentIndex,
      wrongWay: wrongWayRef.current,
      cameraMode: cameraModeRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraFollowing]);

  // Recenter-visibility diagnostic, ported verbatim from page.tsx:7994-8021.
  // shouldShowRecenter itself is a plain derived value used by the UI layer.
  const isNavigationActiveForRecenter = path.length >= 2 || routeVersion > 0;
  const shouldShowRecenter = (
    cameraMode === 'navigation_follow' && !isCameraFollowing
  ) || (
    !hasStartedMoving && isNavigationActiveForRecenter && hasUserExploredMap
  );
  useEffect(() => {
    const nowLog = Date.now();
    if (nowLog - lastRecenterVisibilityLogAtRef.current < 1500) return;
    lastRecenterVisibilityLogAtRef.current = nowLog;
    navDebugLog('[CAM] CAMERA_RECENTER_VISIBILITY_DEBUG', {
      shouldShowRecenter,
      cameraMode,
      isCameraFollowing,
      hasStartedMoving,
      userCameraOverride: userCameraOverrideRef.current,
      hasUserExploredMap,
    });
    if (!hasStartedMoving && isNavigationActiveForRecenter && hasUserExploredMap) {
      navDebugLog('[CAM] NAV_PRE_DRIVE_RECENTER_VISIBLE', {
        hasUserExploredMap,
        userCameraOverride: userCameraOverrideRef.current,
        hasStartedMoving,
        cameraMode,
      });
    }
  }, [shouldShowRecenter, cameraMode, isCameraFollowing, hasStartedMoving, hasUserExploredMap, isNavigationActiveForRecenter]);

  // SOURCE_COPY_MARKER_BINDING — markerScreenRotation ported verbatim from
  // page.tsx:8023-8027 (moved before the early-return gate so its companion
  // debug effect, a hook, can be declared unconditionally alongside it).
  const markerScreenRotation = useMemo(() => (
    isCameraFollowing
      ? normalizeBearing(visualMarkerBearing - mapHeading)
      : normalizeBearing(visualMarkerBearing)
  ), [isCameraFollowing, mapHeading, visualMarkerBearing]);

  useEffect(() => {
    const nowLog = Date.now();
    if (nowLog - lastMarkerRotationModeLogAtRef.current < 1000) return;
    lastMarkerRotationModeLogAtRef.current = nowLog;
    navDebugLog('[NAV] MARKER_ROTATION_MODE_DEBUG', {
      isCameraFollowing,
      cameraMode,
      mapHeading: Math.round(mapHeading),
      visualMarkerBearing: Math.round(visualMarkerBearing),
      screenRotation: Math.round(markerScreenRotation),
      source: currentMarkerBearingSourceRef.current,
      segmentIndex: currentMarkerBearingSegmentRef.current,
      wrongWay: wrongWayRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode, isCameraFollowing, mapHeading, markerScreenRotation, visualMarkerBearing]);

  // SOURCE_COPY_ROUTE_GEOJSON — ported faithfully from
  // afe-navigation-frontend-production/app/navigation/page.tsx:1576-1589.
  // Source's routeGeoJSON/routeSourceData are built from `activeRouteSourcePath`
  // (= stableRouteSourcePath), a state populated inside the route-apply effect
  // that also owns body-lock/handoff trim (page.tsx:1601-2617) — not ported
  // this phase. `path` (the raw NavigationContext field, upstream of that
  // handoff/trim stage) is used here instead as the authoritative full-path
  // input; see Phase 5C-8 audit for the evidence trail behind this choice.
  // แปลง path เป็น GeoJSON — coordinates ต้องเป็น [lng, lat] (Mapbox convention)
  const routeGeoJSON: GeoJSON.LineString | null = useMemo(() => {
    if (path.length < 2) return null;
    return { type: 'LineString', coordinates: path.map((p) => [p.lng, p.lat] as [number, number]) };
  }, [path]);

  // GeoJSON FeatureCollection สำหรับ Source — memoized แยกต่างหากเพื่อลด setData calls
  const routeSourceData: GeoJSON.FeatureCollection = useMemo(() => ({
    type: 'FeatureCollection',
    features: routeGeoJSON
      ? [{ type: 'Feature', properties: {}, geometry: routeGeoJSON }]
      : [],
  }), [routeGeoJSON]);

  const mapStyleUrl = isSatellite
    ? 'mapbox://styles/mapbox/satellite-streets-v12'
    : 'mapbox://styles/mapbox/streets-v12';

  const navigationSummary = useMemo(() => {
    const safeDistance = Math.max(0, Number(distance) || 0);
    const safeEta = Math.max(0, Number(eta) || 0);
    const totalMinutes = Math.max(0, Math.ceil(safeEta / 60)) || 0;
    const durationHrs = totalMinutes >= 60 ? Math.floor(totalMinutes / 60) : 0;
    const durationMins = totalMinutes >= 60 ? totalMinutes % 60 : totalMinutes;
    const arrivalTime = safeEta > 0
      ? (() => {
          const arrival = new Date(Date.now() + safeEta * 1000);
          return `${String(arrival.getHours()).padStart(2, '0')}:${String(arrival.getMinutes()).padStart(2, '0')}`;
        })()
      : '--:--';
    const distanceLabel = safeDistance > 1000
      ? `${(safeDistance / 1000).toFixed(1)} กม.`
      : `${Math.round(safeDistance || 0)} ม.`;

    return { durationHrs, durationMins, arrivalTime, distanceLabel };
  }, [distance, eta]);

  if (!router.isReady) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-6 text-center font-sans">
        <h1 className="text-2xl font-bold text-gray-900">กำลังเตรียมระบบนำทาง...</h1>
      </main>
    );
  }

  if (!queryResult?.ok) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-6 text-center font-sans">
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">{queryResult?.error ?? NAVIGATION_QUERY_ERROR}</h1>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            ย้อนกลับ
          </button>
        </div>
      </main>
    );
  }

  const usersId = queryResult.value.usersId;
  const takecareId = queryResult.value.takecareId;
  const idlocation = queryResult.value.idlocation;
  const auToken = queryResult.value.auToken;
  void usersId;
  void takecareId;
  void idlocation;
  void auToken;

  if (gpsError) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-6 text-center font-sans">
        <div className="space-y-3">
          <h1 className="text-2xl font-bold text-gray-900">ไม่สามารถเข้าถึงตำแหน่งปัจจุบันได้</h1>
          <p className="text-sm text-gray-600">status: {status}</p>
        </div>
      </main>
    );
  }

  // AUTHORIZED_TARGET_ARCHITECTURE_BINDING — guard extended to also wait for
  // the one-tick-later motion-state seed (see Phase 5C-10 rule-5 note on the
  // motion refs block) so the Map/marker JSX never reads a null visual
  // position. Same loading UI, same condition family as before this phase.
  if (!currentPosition || !visualAgentPosition || !motionStateRef.current) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-6 text-center font-sans">
        <div className="space-y-3">
          <h1 className="text-2xl font-bold text-gray-900">กำลังค้นหาตำแหน่งปัจจุบัน...</h1>
          <p className="text-sm text-gray-600">status: {status}</p>
        </div>
      </main>
    );
  }

  if (!patientLocation) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-6 text-center font-sans">
        <div className="space-y-3">
          <h1 className="text-2xl font-bold text-gray-900">กำลังรอตำแหน่งผู้ถูกดูแล...</h1>
          <p className="text-sm text-gray-600">status: {status}</p>
        </div>
      </main>
    );
  }

  // markerScreenRotation computed earlier (before the early-return gate) so
  // its companion debug effect could be declared unconditionally.
  const readinessTitle =
    status === 'loading' || routeUxState === 'initializing'
      ? 'กำลังเริ่มต้นระบบนำทาง...'
      : status === 'error' || routeUxState === 'error' || routeUxState === 'initNoRoute'
        ? 'ไม่สามารถเริ่มต้นระบบนำทางได้'
        : 'ระบบนำทางพร้อมแล้ว';

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#EFEFEF] font-sans">
      <div
        className="absolute inset-0"
        onTouchStart={handleMapTouchStart}
        onTouchMove={handleMapTouchMove}
        onTouchEnd={handleMapTouchEnd}
        onTouchCancel={handleMapTouchCancel}
      >
        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{
            longitude: currentPosition.lng,
            latitude: currentPosition.lat,
            zoom: hasStartedMoving ? NAV_FOLLOW_ZOOM : TOP_DOWN_ZOOM,
            bearing: isCameraFollowing ? mapHeading : 0,
            pitch: (isCameraFollowing && hasStartedMoving) ? NAV_FOLLOW_PITCH : 0,
          }}
          padding={{ top: 0, bottom: 0, left: 0, right: 0 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={mapStyleUrl}
          onDragStart={(e) => handleUserGestureEvent('drag', e)}
          onZoomStart={(e) => handleUserGestureEvent('zoom', e)}
          onRotateStart={(e) => handleUserGestureEvent('rotate', e)}
          onMoveStart={(e) => handleUserGestureEvent('move', e)}
          onMove={(e) => {
            mapHeadingRef.current = e.viewState.bearing;
            setMapHeading(e.viewState.bearing);
          }}
          attributionControl={false}
        >
          {/* SOURCE_COPY_MARKER_BINDING — ported from page.tsx:8079-8082.
              หมุดตัวเรา ใช้ visualAgentPosition (motion-integrator output) แทน raw GPS */}
          <Marker
            longitude={visualAgentPosition.lng}
            latitude={visualAgentPosition.lat}
            anchor="center"
          >
            <div
              style={{
                width: 65,
                height: 65,
                borderRadius: '9999px',
                overflow: 'visible',
                background: 'transparent',
                transform: `rotate(${markerScreenRotation}deg)`,
                filter: 'drop-shadow(0px 4px 10px rgba(0,0,0,0.28))',
              }}
            >
              <img
                src="/navigation_arrow.png"
                alt="My Location"
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  objectFit: 'contain',
                }}
              />
            </div>
          </Marker>

          {/* หมุดคนไข้ */}
          {visualPatientLocation && (
            <Marker
              longitude={visualPatientLocation.lng}
              latitude={visualPatientLocation.lat}
              anchor="bottom"
            >
              <img src="/marker.png" alt="Patient" style={{ width: 45, height: 45, objectFit: 'contain', filter: 'drop-shadow(0px 4px 6px rgba(0,0,0,0.3))' }} />
            </Marker>
          )}

          {/* SOURCE_COPY_ROUTE_SOURCE_LAYER — ported from page.tsx:8117-8169.
              key เปลี่ยนเฉพาะ first route + Mapbox refetch (ไม่ remount บน MT-D* incremental) */}
          <Source
            key={`route-${routeSourceKey}`}
            id="route"
            type="geojson"
            data={routeSourceData}
            lineMetrics={true}
          >
            {/* SOURCE_COPY_TRIM_SOURCE_REQUIREMENT: lineMetrics above and the
                line-trim-offset/line-trim-color/line-trim-fade-range paint
                props below are exact requirements from page.tsx:8118-8168 for
                setRouteTrimPaint's imperative setPaintProperty("line-trim-
                offset", ...) calls to work. Static declared values ([0,0] /
                transparent / [0,0]) are unchanged from source — the seed
                effect above overwrites the runtime value imperatively; no
                Source ID/key/data changed. */}
            {/* 1. เส้นขอบด้านหลัง (Casing) เพื่อให้เส้นดูมีมิติ */}
            <Layer
              id="route-line-casing"
              type="line"
              paint={{
                'line-color': '#1A52B8',
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  12, 6,
                  18, 14,
                  22, 22,
                ],
                'line-opacity': 1.0,
                'line-trim-offset': [0, 0],
                'line-trim-color': 'rgba(0, 0, 0, 0)',
                'line-trim-fade-range': [0, 0],
              }}
              layout={{
                'line-join': 'round',
                'line-cap': 'round',
              }}
            />
            {/* 2. เส้นหลัก (Main Line) ตรงกลาง */}
            <Layer
              id="route-line"
              type="line"
              paint={{
                'line-color': '#4285F4',
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  12, 3,
                  18, 9,
                  22, 14,
                ],
                'line-opacity': 1.0,
                'line-trim-offset': [0, 0],
                'line-trim-color': 'rgba(0, 0, 0, 0)',
                'line-trim-fade-range': [0, 0],
              }}
              layout={{
                'line-join': 'round',
                'line-cap': 'round',
              }}
            />
          </Source>
        </Map>
      </div>

      {/* Deferred: backend does not expose next-maneuver instruction/step distance. */}

      <div className="absolute top-[150px] right-4 z-10 flex flex-col gap-3">
        <div
          className="flex justify-end transition-opacity duration-300"
          style={{
            opacity: Math.abs(mapHeading) > 1.0 ? 1 : 0,
            pointerEvents: Math.abs(mapHeading) > 1.0 ? 'auto' : 'none',
          }}
        >
          <CustomCompass
            size={55}
            bearing={displayBearing}
            onTap={() => {
              const isNavFollow = cameraModeRef.current === 'navigation_follow';
              const wasFollowing = isCameraFollowingRef.current;

              if (isNavFollow && wasFollowing) {
                userCameraOverrideRef.current = true;
                isCameraFollowingRef.current = false;
                setIsCameraFollowing(false);
                if (bearingEaseTimeoutRef.current !== null) {
                  clearTimeout(bearingEaseTimeoutRef.current);
                  bearingEaseTimeoutRef.current = null;
                }
                isBearingEasingRef.current = false;
                navDebugLog('[CAM] CAMERA_COMPASS_MANUAL_OVERRIDE_APPLIED', {
                  cameraMode: cameraModeRef.current,
                  wasFollowing: true,
                  isCameraFollowingAfter: false,
                });
              } else {
                navDebugLog('[CAM] CAMERA_COMPASS_TAP_NO_OVERRIDE', {
                  reason: !isNavFollow ? 'not_navigation_follow' : 'already_free_explore',
                  cameraMode: cameraModeRef.current,
                  isCameraFollowing: isCameraFollowingRef.current,
                });
              }

              if (mapRef.current) {
                const actualBearingBefore = mapRef.current.getBearing();
                navDebugLog('[CAM] CAMERA_COMPASS_NORTH_UP_STARTED', {
                  actualBearingBefore: Math.round(actualBearingBefore),
                  targetBearing: 0,
                });
                mapRef.current.flyTo({ bearing: 0, duration: 500 });
              }
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setIsSoundOn(!isSoundOn)}
          className="flex h-[55px] w-[55px] items-center justify-center rounded-full bg-white shadow-lg transition-transform active:scale-95"
          aria-label={isSoundOn ? 'ปิดเสียง' : 'เปิดเสียง'}
        >
          {isSoundOn ? <Volume2 className="h-[28px] w-[28px] text-[#1B5E20]" /> : <VolumeX className="h-[28px] w-[28px] text-gray-500" />}
        </button>
        <button
          type="button"
          onClick={() => setIsLayerModalOpen(true)}
          className="flex h-[55px] w-[55px] items-center justify-center rounded-full bg-white shadow-lg transition-transform active:scale-95"
          aria-label="ประเภทแผนที่"
        >
          <Layers className="h-[28px] w-[28px] text-[#1B5E20]" />
        </button>
      </div>

      {shouldShowRecenter && (
        <div className="absolute bottom-[140px] left-4 z-10 animate-in fade-in zoom-in duration-200">
          <button
            type="button"
            onClick={handleRecenter}
            className="flex items-center gap-2 rounded-full border border-gray-100 bg-white px-[16px] py-[10px] shadow-lg transition-transform active:scale-95"
          >
            <NavIcon className="h-5 w-5 text-[#4285F4]" />
            <span className="text-[15px] font-medium text-gray-800">ปรับจุดกลาง</span>
          </button>
        </div>
      )}

      <div className="absolute left-4 right-4 top-4 z-10 rounded-[18px] bg-white/90 px-4 py-3 text-center shadow-sm backdrop-blur">
        <h1 className="text-base font-bold text-gray-900">{readinessTitle}</h1>
        <p className="mt-1 text-xs text-gray-600">status: {status}</p>
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-20 rounded-t-[30px] bg-white px-[25px] pb-[calc(2.2rem+env(safe-area-inset-bottom))] pt-5 shadow-[0_-10px_30px_rgba(0,0,0,0.1)]">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 flex-col">
            <div className="flex items-baseline gap-1.5">
              {status === 'arrived' ? (
                <span className="text-[30px] font-extrabold leading-none tracking-tight text-[#1B5E20]">เสร็จสิ้น</span>
              ) : (
                <>
                  {navigationSummary.durationHrs > 0 && (
                    <>
                      <span className="text-[44px] font-extrabold leading-none tracking-tight text-[#1B5E20]">{navigationSummary.durationHrs || 0}</span>
                      <span className="mr-1 text-[24px] font-bold leading-none text-[#1B5E20]">ชม.</span>
                    </>
                  )}
                  <span className="text-[44px] font-extrabold leading-none tracking-tight text-[#1B5E20]">{status === 'loading' ? '--' : (navigationSummary.durationMins || 0)}</span>
                  <span className="text-[24px] font-bold leading-none text-[#1B5E20]">นาที</span>
                </>
              )}
            </div>
            <p className="mt-1 truncate text-[20px] font-normal leading-none text-[#5F6368]">
              {status === 'arrived'
                ? 'การนำทางเสร็จสิ้น'
                : `${navigationSummary.distanceLabel} • ${navigationSummary.arrivalTime}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stop();
              router.back();
            }}
            className="rounded-[24px] bg-[#E31E24] px-[32px] py-[14px] text-[22px] font-bold text-white shadow-md transition-transform active:scale-95"
          >
            {status === 'arrived' ? 'สิ้นสุดการนำทาง' : 'ออก'}
          </button>
        </div>
      </div>

      {isLayerModalOpen && (
        <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/30 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="w-full max-w-sm rounded-[28px] bg-white px-6 py-5 shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[22px] font-bold text-[#3C4043]">ประเภทแผนที่</h2>
              <button
                type="button"
                onClick={() => setIsLayerModalOpen(false)}
                className="rounded-full px-3 py-1.5 text-[15px] font-bold text-[#5F6368] active:scale-95"
              >
                ปิด
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => {
                  setIsSatellite(false);
                  setIsLayerModalOpen(false);
                }}
                className={`rounded-[24px] border-[3px] px-4 py-5 text-[17px] font-bold transition-all active:scale-95 ${!isSatellite ? 'border-[#4D8D9A] text-[#4D8D9A] shadow-md' : 'border-transparent bg-gray-100 text-[#5F6368]'}`}
              >
                ค่าเริ่มต้น
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSatellite(true);
                  setIsLayerModalOpen(false);
                }}
                className={`rounded-[24px] border-[3px] px-4 py-5 text-[17px] font-bold transition-all active:scale-95 ${isSatellite ? 'border-[#4D8D9A] text-[#4D8D9A] shadow-md' : 'border-transparent bg-gray-100 text-[#5F6368]'}`}
              >
                ดาวเทียม
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function NavigationPage() {
  return (
    <NavigationProvider>
      <NavigationPageInner />
    </NavigationProvider>
  );
}
