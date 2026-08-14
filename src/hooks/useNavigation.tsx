'use client';

/* eslint-disable react-hooks/exhaustive-deps */

import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { NavigationService, LatLng, NavigationMode } from '@/lib/services/navigation.service';

const STORAGE_KEY = 'afe_navigation_session';
const ROUTE_FIRST_POINT_WARN_M = 20;
const ROUTE_FIRST_POINT_SEVERE_M = 50;
const ROUTE_FIRST_POINT_CONSECUTIVE_WARN_TICKS = 3;
const SESSION_TTL_MS = 15 * 60 * 1000;
const RESTORE_AGENT_MAX_DISTANCE_M = 1000;
const RESTORE_GPS_MAX_AGE_MS = 15_000;
const RESTORE_GPS_TIMEOUT_MS = 8_000;
const NAV_DEBUG = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_NAV_DEBUG === 'true';

interface NavigationSessionData {
  sessionId: string;
  agentPos: LatLng;
  targetPos: LatLng;
  timestamp: number;
}

type StartResult = {
  sessionId: string;
  pathLen: number;
  applied: boolean;
};

export type RouteUxState =
  | 'idle'
  | 'initializing'
  | 'navigating'
  | 'recalculating'
  | 'routeTemporarilyUnavailable'
  | 'arrived'
  | 'initNoRoute'
  | 'error';

export type EndpointDiagnostics = {
  responsePathLast: LatLng | null;
  pathEndpoint: LatLng | null;
  routeGoalPoint: LatLng | null;
  targetGpsPoint: LatLng | null;
  preEnforcementEndpointDistanceM: number | null;
  finalEndpointDistanceM: number | null;
  endpointTrimmed: boolean | null;
  endpointExtended: boolean | null;
  endpointEnforced: boolean | null;
  routeVersion: number;
};

type NavigationContextType = {
  sessionId: string | null;
  path: LatLng[];
  status: 'idle' | 'loading' | 'active' | 'arrived' | 'error';
  routeUxState: RouteUxState;
  start: (agent: LatLng, target: LatLng, mode?: NavigationMode, gpsAgeMs?: number | null) => Promise<StartResult | void>;
  stop: () => void;
  markArrived: () => void;
  clearNavigationSession: (reason?: string) => void;
  eta: number;
  distance: number;
  corridorNodeCount: number;
  updatePositions: (agent: LatLng, target: LatLng) => void;
  routeVersion: number; // increments each time a valid path is successfully applied
  routeSourceKey: number; // stable Mapbox Source key — only increments on first route + Mapbox API refetch
  endpointDiagnostics: EndpointDiagnostics | null;
  restoreChecked: boolean;
};

const NavigationContext = createContext<NavigationContextType | null>(null);

// Approximate meter distance using cosine-corrected projection (no import needed for logging)
function approxDistM(a: LatLng, b: LatLng): number {
  const dlat = (b.lat - a.lat) * 111320;
  const dlng = (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

function navDebugLog(tag: string, payload?: unknown): void {
  if (!NAV_DEBUG) return;
  console.log(tag, payload);
}

function isValidCoordinate(point: unknown): point is LatLng {
  if (!point || typeof point !== 'object') return false;
  const coord = point as Partial<LatLng>;
  return Number.isFinite(coord.lat) && Number.isFinite(coord.lng) && !(coord.lat === 0 && coord.lng === 0);
}

function getFreshGpsPosition(): Promise<{ position: LatLng; ageMs: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('geolocation_unavailable'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ageMs = Date.now() - pos.timestamp;
        if (ageMs > RESTORE_GPS_MAX_AGE_MS) {
          reject(new Error('gps_stale'));
          return;
        }
        resolve({
          position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          ageMs,
        });
      },
      (err) => reject(err),
      {
        enableHighAccuracy: true,
        timeout: RESTORE_GPS_TIMEOUT_MS,
        maximumAge: 0,
      },
    );
  });
}

// Shared route validity guard — used in all three apply paths (init, restore, polling).
// Returns false → caller must NOT call setPath or increment routeVersion.
function canApplyRoutePath(
  path: unknown,
  status?: string,
  success?: boolean,
): boolean {
  if (!Array.isArray(path) || path.length < 2) return false;
  if (status === 'NO_ROUTE' || status === 'ERROR') return false;
  if (success === false) return false;
  return true;
}

function isBackendArrivedResponse(data: {
  status?: string;
}): boolean {
  return data.status === 'ARRIVED';
}

function isSnapAmbiguityResponse(data: {
  navigationState?: string | null;
  refetchReason?: string | null;
  lastMetric?: { refetchReason?: string | null } | null;
}): boolean {
  return data.navigationState === 'SNAP_AMBIGUITY'
    || data.refetchReason === 'same_node_no_alternate'
    || data.lastMetric?.refetchReason === 'same_node_no_alternate';
}

// ── Route geometry signatures (FNV-1a 32-bit) ─────────────────────────────────
// fullSignature: FNV-1a hash of EVERY coordinate in the path.
//   Any single point change → different hash. Used for exact-duplicate detection.
// bodySignature: endpoint-side identity used only to decide whether routeVersion
// should remount the Mapbox Source. Agent-side trim must not change this.
// Material same-endpoint geometry changes still flow through setPath; the page-level
// stable Source pipeline decides whether setData is needed without remounting.
function fnv1aRoute(path: LatLng[], startIdx = 0): number {
  let h = 2166136261; // FNV-1a 32-bit offset basis
  for (let i = startIdx; i < path.length; i++) {
    const lat = Math.round(path[i].lat * 1e6) | 0;
    const lng = Math.round(path[i].lng * 1e6) | 0;
    h = (Math.imul(h ^ lat, 16777619)) >>> 0;
    h = (Math.imul(h ^ lng, 16777619)) >>> 0;
  }
  return h;
}

function computeRouteFullSignature(path: LatLng[]): string {
  if (path.length < 2) return 'empty';
  const h     = fnv1aRoute(path);
  const first = path[0];
  const last  = path[path.length - 1];
  return `${path.length}:${h}:${first.lat.toFixed(5)},${first.lng.toFixed(5)}:${last.lat.toFixed(5)},${last.lng.toFixed(5)}`;
}

function computeRouteBodySignature(path: LatLng[]): string {
  if (path.length < 2) return 'empty';
  const last = path[path.length - 1];
  return `endpoint:${Math.round(last.lat * 1e6)},${Math.round(last.lng * 1e6)}`;
}

// tailSignature: hash of path[1..n] — excludes path[0] (agent-side trim point).
// Changes when MT-D* replans mid-route geometry even when endpoint stays the same.
// Does NOT change when only path[0] moves due to agent trim.
function computeRouteTailSignature(path: LatLng[]): string {
  if (path.length < 2) return 'empty';
  const h = fnv1aRoute(path, 1);
  return `${path.length - 1}:${h}`;
}

type RouteFirstPointDiagnosticInput = {
  seq?: number;
  source: string;
  routeVersion: number;
  path: LatLng[];
  agentPos: LatLng;
  status?: string | null;
  replanType?: string | null;
  mapboxApiCalled?: boolean | null;
  refetchReason?: string | null;
};

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [path, setPath] = useState<LatLng[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'active' | 'arrived' | 'error'>('idle');
  const [routeUxState, setRouteUxState] = useState<RouteUxState>('idle');
  const [pollMs, setPollMs] = useState(2000);
  const [eta, setEta] = useState<number>(0);
  const [distance, setDistance] = useState<number>(0);
  const [corridorNodeCount, setCorridorNodeCount] = useState<number>(0);
  const [routeVersion, setRouteVersion] = useState<number>(0);
  const [routeSourceKey, setRouteSourceKey] = useState<number>(0);
  const [endpointDiagnostics, setEndpointDiagnostics] = useState<EndpointDiagnostics | null>(null);
  const [restoreChecked, setRestoreChecked] = useState(false);

  const navService = useRef(new NavigationService()).current;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRestoringRef = useRef(false); // ✅ ป้องกัน infinite loop
  const isInitializingRef = useRef(false);

  // ─── Polling race-condition guards ────────────────────────────────────────
  const isUpdateInFlightRef = useRef(false);                         // true while /update in-flight
  const requestSeqRef       = useRef(0);                             // increments before each request
  const latestAppliedSeqRef = useRef(0);                             // seq of last applied response
  const abortControllerRef  = useRef<AbortController | null>(null);  // current in-flight controller

  // ─── Route trim tracking ──────────────────────────────────────────────────
  const prevPathFirstRef      = useRef<LatLng | null>(null);  // path[0] from previous apply
  const prevApplyAgentPosRef  = useRef<LatLng | null>(null);  // agent pos when path was last applied
  const routeFirstPointFarCountRef = useRef(0);
  const routeVersionRef = useRef(0);
  const routeSourceKeyRef = useRef<number>(0);
  // ─── Route geometry signature refs ───────────────────────────────────────
  // Seeded from init/restore so the first polling response can detect duplicates.
  // null = no route applied yet (forces apply + incrementRouteVersion on first response).
  const lastAppliedFullSigRef = useRef<string | null>(null);
  const lastAppliedBodySigRef = useRef<string | null>(null);
  const lastAppliedTailSigRef = useRef<string | null>(null);

  // Refs สำหรับเก็บตำแหน่งล่าสุดเพื่อหลีกเลี่ยง Stale Closure
  const agentRef = useRef<LatLng>({ lat: 0, lng: 0 });
  const targetRef = useRef<LatLng>({ lat: 0, lng: 0 });

  useEffect(() => {
    routeVersionRef.current = routeVersion;
  }, [routeVersion]);

  const incrementRouteVersion = useCallback(() => {
    setRouteVersion(v => {
      const next = v + 1;
      routeVersionRef.current = next;
      return next;
    });
  }, []);

  const incrementRouteSourceKey = useCallback(() => {
    setRouteSourceKey(v => {
      const next = v + 1;
      routeSourceKeyRef.current = next;
      return next;
    });
  }, []);

  const logRouteFirstPointAgentDistance = useCallback((input: RouteFirstPointDiagnosticInput) => {
    if (!Array.isArray(input.path) || input.path.length < 2) return;

    const firstPoint = input.path[0];
    const routeFirstPointAgentDistanceM = approxDistM(input.agentPos, firstPoint);
    const isFar = routeFirstPointAgentDistanceM > ROUTE_FIRST_POINT_WARN_M;
    const isSevere = routeFirstPointAgentDistanceM > ROUTE_FIRST_POINT_SEVERE_M;
    const previousFarCount = routeFirstPointFarCountRef.current;
    const nextFarCount = isFar ? previousFarCount + 1 : 0;
    routeFirstPointFarCountRef.current = nextFarCount;

    const payload = {
      seq: input.seq,
      source: input.source,
      routeVersion: input.routeVersion,
      pathLen: input.path.length,
      agentPos: input.agentPos,
      firstPoint,
      routeFirstPointAgentDistanceM: Math.round(routeFirstPointAgentDistanceM),
      status: input.status ?? null,
      replanType: input.replanType ?? null,
      mapboxApiCalled: input.mapboxApiCalled ?? null,
      refetchReason: input.refetchReason ?? null,
      warnThresholdM: ROUTE_FIRST_POINT_WARN_M,
      severeThresholdM: ROUTE_FIRST_POINT_SEVERE_M,
      consecutiveFarCount: nextFarCount,
      isSevere,
    };

    console.log('[NAV] ROUTE_FIRST_POINT_AGENT_DISTANCE', payload);

    if (isFar) {
      console.warn('[NAV] ROUTE_FIRST_POINT_TOO_FAR', payload);
      console.warn('[NAV] ROUTE_APPLIED_BUT_START_FAR_FROM_AGENT', payload);

      if (nextFarCount >= ROUTE_FIRST_POINT_CONSECUTIVE_WARN_TICKS) {
        console.warn('[NAV] ROUTE_FIRST_POINT_TOO_FAR_CONSECUTIVE', {
          ...payload,
          consecutiveThresholdTicks: ROUTE_FIRST_POINT_CONSECUTIVE_WARN_TICKS,
        });
      }
      return;
    }

    console.log('[NAV] ROUTE_APPLIED_START_NEAR_AGENT', payload);

    if (previousFarCount > 0) {
      console.log('[NAV] ROUTE_FIRST_POINT_DISTANCE_RECOVERED', {
        ...payload,
        previousFarCount,
      });
    }
  }, []);

  const updatePositions = useCallback((agent: LatLng, target: LatLng) => {
    agentRef.current = agent;
    targetRef.current = target;
  }, []);

  const clearNavigationSession = useCallback((reason = 'fresh_start') => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isUpdateInFlightRef.current = false;
    requestSeqRef.current       = 0;
    latestAppliedSeqRef.current = 0;
    prevPathFirstRef.current     = null;
    prevApplyAgentPosRef.current = null;
    routeFirstPointFarCountRef.current = 0;
    lastAppliedFullSigRef.current = null;
    lastAppliedBodySigRef.current = null;
    lastAppliedTailSigRef.current = null;
    setSessionId(null);
    setStatus('idle');
    setRouteUxState('idle');
    setPath([]);
    setEta(0);
    setDistance(0);
    setCorridorNodeCount(0);
    setEndpointDiagnostics(null);
    localStorage.removeItem(STORAGE_KEY);
    navDebugLog('[NAV] NAV_START_CLEAR_PREVIOUS_SESSION', {
      reason,
      timestamp: Date.now(),
    });
  }, []);

  // ✅ 1. Restore session จาก localStorage เมื่อ component mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
          console.log('ℹ️ No stored session found');
          setRestoreChecked(true);
          return;
        }

        const data: NavigationSessionData = JSON.parse(stored);
        const ageMs = Date.now() - data.timestamp;

        navDebugLog('[NAV] NAV_RESTORED_SESSION_FOUND', {
          sessionId: data.sessionId ?? null,
          ageMs,
          agentPos: data.agentPos ?? null,
          targetPos: data.targetPos ?? null,
        });

        const discardRestoredSession = (reason: string, extra?: Record<string, unknown>) => {
          localStorage.removeItem(STORAGE_KEY);
          setSessionId(null);
          setStatus('idle');
          setRouteUxState('idle');
          setPath([]);
          navDebugLog('[NAV] NAV_RESTORED_SESSION_DISCARDED', {
            reason,
            sessionId: data.sessionId ?? null,
            ageMs,
            ...extra,
          });
        };

        if (!data.sessionId || !isValidCoordinate(data.agentPos) || !isValidCoordinate(data.targetPos)) {
          discardRestoredSession('invalid_session');
          setRestoreChecked(true);
          return;
        }

        // ตรวจสอบว่า session เก่าเกินไปหรือไม่ (เกิน 15 นาที = session หมดอายุ)
        if (ageMs > SESSION_TTL_MS) {
          console.log('⏰ Stored session expired, clearing...');
          discardRestoredSession('expired');
          setRestoreChecked(true);
          return;
        }

        let gpsCheck: { position: LatLng; ageMs: number };
        try {
          gpsCheck = await getFreshGpsPosition();
        } catch (gpsErr) {
          discardRestoredSession('gps_unavailable', {
            gpsError: gpsErr instanceof Error ? gpsErr.message : String(gpsErr),
          });
          setRestoreChecked(true);
          return;
        }

        const restoredAgentDistanceM = approxDistM(gpsCheck.position, data.agentPos);
        if (restoredAgentDistanceM > RESTORE_AGENT_MAX_DISTANCE_M) {
          discardRestoredSession('gps_far_from_restored_agent', {
            currentGps: gpsCheck.position,
            restoredAgentPos: data.agentPos,
            distanceM: Math.round(restoredAgentDistanceM),
            thresholdM: RESTORE_AGENT_MAX_DISTANCE_M,
            gpsAgeMs: gpsCheck.ageMs,
          });
          setRestoreChecked(true);
          return;
        }

        if (isInitializingRef.current) {
          navDebugLog('[NAV] NAV_RESTORED_SESSION_DISCARDED', {
            reason: 'fresh_start_in_progress',
            sessionId: data.sessionId,
          });
          setRestoreChecked(true);
          return;
        }

        navDebugLog('[NAV] NAV_RESTORED_SESSION_ACCEPTED', {
          sessionId: data.sessionId,
          currentGps: gpsCheck.position,
          restoredAgentPos: data.agentPos,
          distanceM: Math.round(restoredAgentDistanceM),
          thresholdM: RESTORE_AGENT_MAX_DISTANCE_M,
          gpsAgeMs: gpsCheck.ageMs,
        });

        console.log('🔄 Restoring session:', data.sessionId);
        isRestoringRef.current = true;

        setSessionId(data.sessionId);
        setStatus('loading');
        setRouteUxState('initializing');

        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        // เรียก /update เพื่อดึง path ล่าสุด
        // หมายเหตุ: ตรงนี้ถ้า res.ok ไม่ผ่าน หรือเป็น 404 จะ return { sessionExpired: true }
        const updateData = await navService.update(
          data.sessionId,
          gpsCheck.position,
          data.targetPos,
          controller.signal
        );

        if (controller.signal.aborted || isInitializingRef.current) {
          navDebugLog('[NAV] NAV_RESTORED_SESSION_DISCARDED', {
            reason: controller.signal.aborted ? 'restore_aborted' : 'fresh_start_in_progress',
            sessionId: data.sessionId,
          });
          return;
        }

        if ('sessionExpired' in updateData && updateData.sessionExpired) {
          console.warn('🔄 Session expired on server, clearing stored session...');
          discardRestoredSession('invalid_session', { serverReason: 'session_expired' });
          return;
        }

        if ('success' in updateData && updateData.success) {
          if (!canApplyRoutePath(updateData.path, updateData.status, updateData.success)) {
            console.warn('[NAV] ROUTE_APPLY_BLOCKED_INVALID_RESPONSE', {
              source: 'restore', status: updateData.status, pathLen: (updateData.path as any)?.length ?? 0,
            });
            discardRestoredSession('invalid_session', {
              serverStatus: updateData.status,
              pathLen: (updateData.path as any)?.length ?? 0,
            });
            return;
          }
          const restoredPath = updateData.path.map((p: any) => ({ lat: p.lat, lng: p.lng }));
          logRouteFirstPointAgentDistance({
            source: 'restore',
            routeVersion: routeVersionRef.current + 1,
            path: restoredPath,
            agentPos: gpsCheck.position,
            status: updateData.status,
            replanType: (updateData as any).lastMetric?.replanType ?? 'restore',
            mapboxApiCalled: (updateData as any).lastMetric?.mapboxApiCalled ?? null,
            refetchReason: (updateData as any).refetchReason ?? null,
          });
          setPath(restoredPath);
          incrementRouteVersion();
          incrementRouteSourceKey();
          console.log('[NAV] ROUTE_SOURCE_REMOUNT_ALLOWED', { source: 'restore', routeSourceKey: routeSourceKeyRef.current });
          lastAppliedFullSigRef.current = computeRouteFullSignature(restoredPath);
          lastAppliedBodySigRef.current = computeRouteBodySignature(restoredPath);
          lastAppliedTailSigRef.current = computeRouteTailSignature(restoredPath);
          setDistance(updateData.totalCost || 0);
          setEta(updateData.estimatedTimeSeconds || 0);
          setStatus('active');
          setRouteUxState('navigating');
          console.log('✅ Session restored successfully');
        } else {
          // Session หมดอายุหรือ error → ลบออกจาก localStorage
          console.warn('❌ Failed to restore session, clearing...');
          discardRestoredSession('invalid_session', { serverStatus: (updateData as any).status ?? null });
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          navDebugLog('[NAV] NAV_RESTORED_SESSION_DISCARDED', {
            reason: 'restore_aborted',
          });
          return;
        }
        console.error('❌ Restore session failed:', err);
        localStorage.removeItem(STORAGE_KEY);
        setStatus('idle');
        setRouteUxState('idle');
      } finally {
        isRestoringRef.current = false;
        setRestoreChecked(true);
      }
    };

    restoreSession();
  }, [navService, clearNavigationSession]);

  // ✅ 2. บันทึก sessionId ลง localStorage ทุกครั้งที่มีการเปลี่ยนแปลง
  useEffect(() => {
    if (!sessionId || isRestoringRef.current) return;

    const data: NavigationSessionData = {
      sessionId,
      agentPos: agentRef.current,
      targetPos: targetRef.current,
      timestamp: Date.now(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    console.log('💾 Session saved to localStorage:', sessionId);
  }, [sessionId]);

  // หยุดนำทาง + ล้าง timer + abort in-flight request
  const stop = useCallback(() => {
    clearNavigationSession('stop');
    console.log('🗑️ Navigation stopped, session cleared');
  }, [clearNavigationSession]);

  const markArrived = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isUpdateInFlightRef.current = false;
    setStatus('arrived');
    setRouteUxState('arrived');
    navDebugLog('[NAV] NAV_ARRIVAL_POLLING_STOPPED', {
      sessionId,
      timestamp: Date.now(),
    });
  }, [sessionId]);

  // เริ่มนำทาง (เรียก /init)
  const start = useCallback(async (
    agent: LatLng,
    target: LatLng,
    mode: NavigationMode = 'hybrid',
    gpsAgeMs: number | null = null,
  ): Promise<StartResult | void> => {
    if (isInitializingRef.current) return;
    isInitializingRef.current = true;

    clearNavigationSession('fresh_start_before_init');

    // Abort any in-flight /update request from a previous session before starting new one.
    // Without this, a late response from the old session could apply its path to the new session.
    abortControllerRef.current?.abort();
    abortControllerRef.current  = null;
    isUpdateInFlightRef.current = false;
    // Reset polling state — new session must start with clean seq counters
    requestSeqRef.current       = 0;
    latestAppliedSeqRef.current = 0;
    prevPathFirstRef.current     = null;
    prevApplyAgentPosRef.current = null;
    routeFirstPointFarCountRef.current = 0;
    lastAppliedFullSigRef.current = null;
    lastAppliedBodySigRef.current = null;
    lastAppliedTailSigRef.current = null;

    console.log('[NAV] NAV_INIT_REQUEST_START', {
      agentPos:  agent,
      targetPos: target,
      gpsAgeMs,
      timestamp: Date.now(),
    });
    setStatus('loading');
    setRouteUxState('initializing');
    try {
      const data = await navService.init(agent, target, mode);
      console.log('[NAV] NAV_INIT_RESPONSE_RECEIVED', {
        status:    (data as any).status    ?? null,
        success:   (data as any).success   ?? null,
        pathLen:   (data as any).path?.length ?? 0,
        sessionId: (data as any).sessionId ?? null,
        hasPath:   Array.isArray((data as any).path) && (data as any).path.length >= 2,
        error:     (data as any).error     ?? null,
        timestamp: Date.now(),
      });

      if ((data as any).error) {
        if ((data as any).rateLimit) {
          console.warn('⚠️ Rate limit exceeded (429), retrying in 2 seconds...');
          setTimeout(() => start(agent, target, mode), 2000);
          return;
        }
        console.error('❌ Init failed:', (data as any).message || `Status ${(data as any).status}`);
        setStatus('error');
        setRouteUxState('error');
        return;
      }

      const initData = data as any;

      // Guard: use shared validator — catches NO_ROUTE, ERROR, path.length < 2
      if (!canApplyRoutePath(initData.path, initData.status)) {
        console.warn('[NAV] ROUTE_APPLY_BLOCKED_INVALID_RESPONSE', {
          source: 'init', status: initData.status, pathLen: initData.path?.length ?? 0,
        });
        console.warn('[NAV] NAV_INIT_APPLY_BLOCKED', {
          reason:     'canApplyRoutePath_failed',
          status:     initData.status    ?? null,
          success:    initData.success   ?? null,
          pathLen:    initData.path?.length ?? 0,
          sessionId:  initData.sessionId ?? null,
          rawSummary: { status: initData.status, pathLen: initData.path?.length ?? 0 },
        });
        if (initData.status === 'NO_ROUTE' || initData.success === false) {
          setStatus('idle');
          setRouteUxState('initNoRoute');
          console.log('[NAV] ROUTE_UX_STATE_CHANGED', {
            source: 'init',
            routeUxState: 'initNoRoute',
            status: initData.status ?? null,
            success: initData.success ?? null,
            pathLen: initData.path?.length ?? 0,
          });
        } else {
          setStatus('error');
          setRouteUxState('error');
        }
        return;
      }

      console.log('[NAV] NAV_INIT_APPLY_ALLOWED', {
        pathLen:    initData.path.length,
        firstPoint: initData.path[0],
        lastPoint:  initData.path[initData.path.length - 1],
        sessionId:  initData.sessionId,
      });
      setSessionId(initData.sessionId);
      console.log('[NAV] APPLY_NEW_ROUTE', {
        source: 'init',
        pathLen: initData.path.length,
        first: initData.path[0],
        last: initData.path[initData.path.length - 1],
        status: initData.status,
        replanType: 'init',
        mapboxApiCalled: true,
      });
      logRouteFirstPointAgentDistance({
        source: 'init',
        routeVersion: routeVersionRef.current + 1,
        path: initData.path,
        agentPos: agent,
        status: initData.status,
        replanType: 'init',
        mapboxApiCalled: true,
        refetchReason: null,
      });
      setPath(initData.path);
      incrementRouteVersion();
      incrementRouteSourceKey();
      console.log('[NAV] ROUTE_SOURCE_REMOUNT_ALLOWED', { source: 'init', routeSourceKey: routeSourceKeyRef.current });
      // Seed signatures so first polling response can detect duplicates/tail-only
      lastAppliedFullSigRef.current = computeRouteFullSignature(initData.path);
      lastAppliedBodySigRef.current = computeRouteBodySignature(initData.path);
      lastAppliedTailSigRef.current = computeRouteTailSignature(initData.path);
      console.log('[NAV] NAV_INIT_STATE_UPDATE_QUEUED', {
        pathLen:                   initData.path.length,
        routeVersionWillIncrement: true,
        sessionId:                 initData.sessionId,
      });
      setEta(initData.estimatedTimeSeconds || 0);
      setDistance(initData.totalCost || 0);
      setCorridorNodeCount(initData.corridorNodeCount || 0);
      setStatus('active');
      setRouteUxState('navigating');
      setPollMs(2000);

      // ✅ บันทึกตำแหน่งเริ่มต้น
      agentRef.current = agent;
      targetRef.current = target;

      console.log('[NAV] NAV_START_COMPLETED', {
        sessionId: initData.sessionId,
        pathLen:   initData.path.length,
        status:    'active',
        timestamp: Date.now(),
      });
      return { sessionId: initData.sessionId, pathLen: initData.path.length, applied: true };
    } catch (err) {
      console.error('❌ Init error:', err);
      setStatus('error');
      setRouteUxState('error');
    } finally {
      isInitializingRef.current = false;
    }
  }, [navService, clearNavigationSession]);

  // Polling Loop (เรียก /update ทุก X วินาที)
  useEffect(() => {
    if (status !== 'active' || !sessionId) return;

    pollRef.current = setInterval(async () => {
      // ── In-flight guard: skip tick if previous request hasn't finished ──────
      if (isUpdateInFlightRef.current) {
        console.log('[NAV] NAV_UPDATE_SKIPPED_IN_FLIGHT', {
          sessionId, seq: requestSeqRef.current,
        });
        return;
      }

      const seq = ++requestSeqRef.current;
      const startedAt = Date.now();
      isUpdateInFlightRef.current = true;

      // Each request gets its own AbortController
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const agentPos = agentRef.current;
      const targetPos = targetRef.current;

      console.log('[NAV] NAV_UPDATE_REQUEST_START', { seq, sessionId, startedAt });

      try {
        const data = await navService.update(sessionId, agentPos, targetPos, controller.signal);
        const durationMs = Date.now() - startedAt;

        // ── Stale response guard ─────────────────────────────────────────────
        if (seq <= latestAppliedSeqRef.current) {
          console.log('[NAV] NAV_UPDATE_STALE_RESPONSE_DROPPED', {
            seq, latestApplied: latestAppliedSeqRef.current, sessionId,
          });
          return;
        }

        // ── API error / 429 backoff ──────────────────────────────────────────
        // 'error' in data discriminates ApiError from UpdateResponse
        if ('error' in data) {
          if (data.rateLimit) {
            console.warn('[NAV] NAV_UPDATE_RATE_LIMIT_BACKOFF', { seq, sessionId, durationMs });
            setPollMs(15000);
          } else {
            console.error('[NAV] NAV_UPDATE_REQUEST_DONE (error)', {
              seq, sessionId, status: data.status, durationMs,
            });
            setRouteUxState('routeTemporarilyUnavailable');
          }
          return;
        }

        console.log('[NAV] NAV_UPDATE_REQUEST_DONE', {
          seq, sessionId, status: data.status,
          pathLen: data.path?.length, durationMs,
        });

        // ── Session expired → silent re-init ─────────────────────────────────
        if ('sessionExpired' in data && data.sessionExpired) {
          console.log('[NAV] Session expired, auto-recovering...', { seq, sessionId });
          start(agentRef.current, targetRef.current);
          return;
        }

        // By this point 'error' branch and sessionExpired branch have both returned.
        // TypeScript narrows data to UpdateResponse & { sessionExpired?: boolean }.
        const updateData = data;
        const responsePathLast =
          Array.isArray(updateData.path) && updateData.path.length > 0
            ? updateData.path[updateData.path.length - 1]
            : null;
        const endpointCompare: EndpointDiagnostics = {
          responsePathLast,
          pathEndpoint: updateData.pathEndpoint ?? null,
          routeGoalPoint: updateData.routeGoalPoint ?? null,
          targetGpsPoint: updateData.targetGpsPoint ?? null,
          preEnforcementEndpointDistanceM: updateData.preEnforcementEndpointDistanceM ?? null,
          finalEndpointDistanceM: updateData.finalEndpointDistanceM ?? null,
          endpointTrimmed: updateData.endpointTrimmed ?? null,
          endpointExtended: updateData.endpointExtended ?? null,
          endpointEnforced: updateData.endpointEnforced ?? null,
          routeVersion: routeVersionRef.current,
        };
        setEndpointDiagnostics(endpointCompare);
        console.log('[NAV] ENDPOINT_COMPARE_RESPONSE', endpointCompare);

        // ── Backend terminal state: ARRIVED may intentionally carry path:[] ─────
        // Handle it before the route guard so arrival does not require renderable geometry.
        if (isBackendArrivedResponse(updateData)) {
          console.log('[NAV] ARRIVED_FROM_BACKEND', {
            seq,
            sessionId,
            status: updateData.status,
            navigationState: updateData.navigationState ?? null,
            pathReachesTarget: updateData.pathReachesTarget ?? null,
            pathLen: updateData.path?.length ?? 0,
            totalCost: updateData.totalCost,
            refetchReason: updateData.refetchReason ?? updateData.lastMetric?.refetchReason ?? null,
            routeVersion: routeVersionRef.current,
          });
          markArrived();
          return;
        }

        // ── Invariant guard (shared) ──────────────────────────────────────────
        if (!canApplyRoutePath(updateData.path, updateData.status, updateData.success)) {
          const nonFatalReason =
            updateData.status === 'NO_ROUTE'
              ? updateData.refetchReason ?? updateData.lastMetric?.refetchReason ?? 'no_route'
              : 'invalid_incoming_path';
          console.warn('[NAV] ROUTE_APPLY_BLOCKED_INVALID_RESPONSE', {
            seq, source: 'polling',
            status: updateData.status, success: updateData.success,
            pathLen: updateData.path?.length ?? 0,
            refetchReason: updateData.refetchReason ?? updateData.lastMetric?.refetchReason ?? null,
          });
          console.log('[NAV] ROUTE_UPDATE_KEEPING_EXISTING_ROUTE', {
            reason:       nonFatalReason,
            status:       updateData.status ?? null,
            pathLen:      updateData.path?.length ?? 0,
            routeVersion: routeVersionRef.current,
          });
          if (
            updateData.status === 'NO_ROUTE' ||
            isSnapAmbiguityResponse(updateData)
          ) {
            const nextRouteUxState: RouteUxState = isSnapAmbiguityResponse(updateData)
              ? 'recalculating'
              : 'routeTemporarilyUnavailable';
            setRouteUxState(nextRouteUxState);
            console.log('[NAV] NON_FATAL_ROUTE_RECALCULATING', {
              seq,
              sessionId,
              status: updateData.status ?? null,
              navigationState: updateData.navigationState ?? null,
              refetchReason: updateData.refetchReason ?? updateData.lastMetric?.refetchReason ?? null,
              routeVersion: routeVersionRef.current,
              routeUxState: nextRouteUxState,
            });
          }
          return;
        }

        // ── Apply ────────────────────────────────────────────────────────────
        const updateMeta = updateData as any;
        const nextRouteVersion = routeVersionRef.current + 1;

        console.log('[NAV] NAV_UPDATE_APPLY_ALLOWED', {
          seq, sessionId, pathLen: updateData.path.length, durationMs,
        });

        // ── Route trim diagnostics (always fire for valid responses) ─────────
        // Fires before the apply decision so the data is always captured.
        // APPLY_NEW_ROUTE and ROUTE_TRIM_APPLIED are logged within branches below.
        const newFirst = updateData.path[0];
        const prevFirst = prevPathFirstRef.current;
        const distFirstPointMovedM = prevFirst ? approxDistM(prevFirst, newFirst) : -1;
        const agentMovedSinceLastApplyM = prevApplyAgentPosRef.current
          ? approxDistM(prevApplyAgentPosRef.current, agentRef.current)
          : -1;

        console.log('[NAV] ROUTE_TRIM_DIAGNOSTICS', {
          seq,
          pathLen: updateData.path.length,
          firstPoint: newFirst,
          previousFirstPoint: prevFirst,
          distFirstPointMovedM: distFirstPointMovedM >= 0 ? Math.round(distFirstPointMovedM) : null,
          agentMovedSinceLastApplyM: agentMovedSinceLastApplyM >= 0 ? Math.round(agentMovedSinceLastApplyM) : null,
        });

        if (distFirstPointMovedM > 5) {
          console.log('[NAV] ROUTE_FIRST_POINT_CHANGED', {
            seq,
            distFirstPointMovedM: Math.round(distFirstPointMovedM),
            prevFirst,
            newFirst,
          });
        }

        // Stall: agent moved >15m since last apply but path[0] barely moved
        if (agentMovedSinceLastApplyM > 15 && distFirstPointMovedM >= 0 && distFirstPointMovedM < 2) {
          console.warn('[NAV] ROUTE_TRIM_STALLED_FRONTEND', {
            seq,
            agentMovedSinceLastApplyM: Math.round(agentMovedSinceLastApplyM),
            distFirstPointMovedM: Math.round(distFirstPointMovedM),
            firstPoint: newFirst,
            agentPos: agentRef.current,
          });
        }

        logRouteFirstPointAgentDistance({
          seq,
          source: 'polling',
          routeVersion: nextRouteVersion,
          path: updateData.path,
          agentPos: agentRef.current,
          status: updateData.status,
          replanType: updateData.lastMetric?.replanType ?? null,
          mapboxApiCalled: updateData.lastMetric?.mapboxApiCalled ?? null,
          refetchReason: updateMeta.refetchReason ?? updateMeta.lastMetric?.refetchReason ?? null,
        });

        prevPathFirstRef.current = newFirst;
        prevApplyAgentPosRef.current = { ...agentRef.current };
        latestAppliedSeqRef.current = seq;

        // ── Smart route apply decision ────────────────────────────────────────
        // Decision order (important — mapboxApiCalled must come BEFORE duplicate check):
        //  1. First route (no prior state) → apply + increment
        //  2. mapboxApiCalled=true OR refetchReason → force new body (skip duplicate check)
        //  3. incomingFull === prevFull → exact duplicate → skip
        //  4. incomingBody === prevBody → tail-only trim → setPath only
        //  5. else → new body geometry → setPath + increment
        const incomingPath     = updateData.path.map((p) => ({ lat: p.lat, lng: p.lng }));
        const incomingFull     = computeRouteFullSignature(incomingPath);
        const incomingBody     = computeRouteBodySignature(incomingPath);
        const incomingTail     = computeRouteTailSignature(incomingPath);
        const prevFull         = lastAppliedFullSigRef.current;
        const prevBody         = lastAppliedBodySigRef.current;
        const prevTail         = lastAppliedTailSigRef.current;
        const mapboxCalledNow  = updateMeta.lastMetric?.mapboxApiCalled === true;
        const replanTypeNow    = updateMeta.lastMetric?.replanType ?? null;
        const refetchReasonNow = updateMeta.lastMetric?.refetchReason ?? updateMeta.refetchReason ?? null;

        console.log('[NAV] ROUTE_GEOMETRY_SIGNATURE_COMPUTED', {
          seq,
          source:            'polling',
          pathLen:           incomingPath.length,
          fullSignature:     incomingFull,
          bodySignature:     incomingBody,
          prevFullSignature: prevFull,
          prevBodySignature: prevBody,
          routeVersion:      routeVersionRef.current,
          mapboxApiCalled:   mapboxCalledNow,
          replanType:        replanTypeNow,
          refetchReason:     refetchReasonNow,
        });

        // Truth tracking vars for NAV_FRONTEND_PATH_TRUTH (Patch 2 — evidence only)
        let truthSetPathCalled = false;
        let truthRouteVersionIncremented = false;
        let truthUpdateReason: string | null = null;
        let truthSkipReason: string | null = null;
        const truthRouteVersionBefore = routeVersionRef.current;

        if (prevFull === null) {
          // Branch 1: First polling response for this session → always apply
          setPath(incomingPath);
          incrementRouteVersion();
          incrementRouteSourceKey();
          console.log('[NAV] ROUTE_SOURCE_REMOUNT_ALLOWED', { source: 'polling', reason: 'first_route', routeSourceKey: routeSourceKeyRef.current });
          lastAppliedFullSigRef.current = incomingFull;
          lastAppliedBodySigRef.current = incomingBody;
          lastAppliedTailSigRef.current = incomingTail;
          truthSetPathCalled = true; truthRouteVersionIncremented = true;
          truthUpdateReason = 'first_route';
          console.log('[NAV] ROUTE_UPDATE_APPLIED_NEW_BODY_GEOMETRY', {
            seq, source: 'polling', reason: 'first_route',
            newBodySignature: incomingBody, pathLen: incomingPath.length,
            routeVersionWillIncrement: true,
            replanType: replanTypeNow, mapboxApiCalled: mapboxCalledNow, refetchReason: refetchReasonNow,
          });
          console.log('[NAV] APPLY_NEW_ROUTE', {
            seq, sessionId, pathLen: incomingPath.length,
            first: incomingPath[0], last: incomingPath[incomingPath.length - 1],
            status: updateData.status, replanType: replanTypeNow,
            mapboxApiCalled: mapboxCalledNow, refetchReason: refetchReasonNow,
          });
        } else if (mapboxCalledNow || refetchReasonNow != null) {
          // Branch 2: Mapbox API was called or explicit refetch — always new geometry.
          // Must come BEFORE duplicate check: a refetch could return same coords as
          // the previous path yet still require a Source remount (new tile data, etc.).
          setPath(incomingPath);
          incrementRouteVersion();
          incrementRouteSourceKey();
          console.log('[NAV] ROUTE_SOURCE_REMOUNT_ALLOWED', { source: 'polling', reason: 'mapbox_refetch', routeSourceKey: routeSourceKeyRef.current });
          lastAppliedFullSigRef.current = incomingFull;
          lastAppliedBodySigRef.current = incomingBody;
          lastAppliedTailSigRef.current = incomingTail;
          truthSetPathCalled = true; truthRouteVersionIncremented = true;
          truthUpdateReason = 'mapbox_refetch';
          console.log('[NAV] ROUTE_UPDATE_APPLIED_MAPBOX_REFETCH_GEOMETRY', {
            seq, source: 'polling',
            pathLen: incomingPath.length, routeVersionWillIncrement: true,
            replanType: replanTypeNow, mapboxApiCalled: mapboxCalledNow, refetchReason: refetchReasonNow,
          });
          console.log('[NAV] APPLY_NEW_ROUTE', {
            seq, sessionId, pathLen: incomingPath.length,
            first: incomingPath[0], last: incomingPath[incomingPath.length - 1],
            status: updateData.status, replanType: replanTypeNow,
            mapboxApiCalled: mapboxCalledNow, refetchReason: refetchReasonNow,
          });
        } else if (incomingFull === prevFull) {
          // Branch 3: Exact duplicate — skip apply entirely (no setPath, no increment)
          truthSkipReason = 'exact_duplicate';
          console.log('[NAV] ROUTE_UPDATE_SKIPPED_DUPLICATE_GEOMETRY', {
            seq, source: 'polling',
            fullSignature: incomingFull, bodySignature: incomingBody,
            routeVersion: routeVersionRef.current,
            status: updateData.status, replanType: replanTypeNow,
            mapboxApiCalled: mapboxCalledNow, refetchReason: refetchReasonNow,
          });
        } else if (prevBody !== null && incomingBody === prevBody) {
          // Branch 4: Same endpoint — could be agent-side trim OR MT-D* mid-route change.
          // tailSignature (path[1..n]) distinguishes the two cases:
          //   tail unchanged → only path[0] moved (agent trim) → keep Source locked, no routeVersion increment
          //   tail changed   → MT-D* replanned mid-route geometry → increment routeVersion to force Source update
          const tailChanged = prevTail !== null && incomingTail !== prevTail;
          setPath(incomingPath);
          lastAppliedFullSigRef.current = incomingFull;
          lastAppliedTailSigRef.current = incomingTail;
          // prevBody stays the same — endpoint is unchanged
          truthSetPathCalled = true;
          if (tailChanged) {
            incrementRouteVersion();
            // Source key NOT incremented — MT-D* incremental replan must NOT remount Source
            console.log('[NAV] ROUTE_SOURCE_REMOUNT_BLOCKED', {
              source: 'polling', reason: 'mt_dstar_tail_change',
              routeVersion: routeVersionRef.current, routeSourceKey: routeSourceKeyRef.current,
            });
            truthRouteVersionIncremented = true;
            truthUpdateReason = 'same_body_tail_changed_mt_dstar';
            console.log('[NAV] ROUTE_INCREMENTAL_SOURCE_UPDATE', {
              seq, source: 'polling',
              reason: 'mt_dstar_mid_route_geometry_changed',
              sameBody: true,
              fullSignatureChanged: true,
              incomingPathLen: incomingPath.length,
              currentPathLen: prevFull ? parseInt(prevFull.split(':')[0], 10) : null,
              routeVersionBefore: routeVersionRef.current,
              replanType: replanTypeNow, mapboxApiCalled: mapboxCalledNow,
            });
            console.log('[NAV] APPLY_NEW_ROUTE', {
              seq, sessionId, pathLen: incomingPath.length,
              first: incomingPath[0], last: incomingPath[incomingPath.length - 1],
              status: updateData.status, replanType: replanTypeNow,
              mapboxApiCalled: mapboxCalledNow, refetchReason: refetchReasonNow,
            });
          } else {
            truthSkipReason = 'tail_only_agent_trim';
            console.log('[NAV] ROUTE_INCREMENTAL_SOURCE_SKIPPED', {
              seq, source: 'polling',
              reason: 'tail_only_agent_trim',
              sameBody: true,
              fullSignatureChanged: incomingFull !== prevFull,
              incomingPathLen: incomingPath.length,
              currentPathLen: prevFull ? parseInt(prevFull.split(':')[0], 10) : null,
              routeVersionBefore: routeVersionRef.current,
              replanType: replanTypeNow, mapboxApiCalled: mapboxCalledNow,
            });
          }
          console.log('[NAV] ROUTE_TAIL_ONLY_UPDATE_APPLIED', {
            seq, source: 'polling',
            oldFullSignature: prevFull, newFullSignature: incomingFull,
            bodySignature: incomingBody, pathLen: incomingPath.length,
            routeVersionUnchanged: !tailChanged,
            tailChanged,
            replanType: replanTypeNow, mapboxApiCalled: mapboxCalledNow,
          });
        } else {
          // Branch 5: Route body changed without Mapbox API call (MT-D* replanned on its own)
          // Source key NOT incremented — setData on existing Source is sufficient
          setPath(incomingPath);
          incrementRouteVersion();
          console.log('[NAV] ROUTE_SOURCE_REMOUNT_BLOCKED', {
            source: 'polling', reason: 'mt_dstar_new_body_no_mapbox',
            routeVersion: routeVersionRef.current, routeSourceKey: routeSourceKeyRef.current,
          });
          lastAppliedFullSigRef.current = incomingFull;
          lastAppliedBodySigRef.current = incomingBody;
          lastAppliedTailSigRef.current = incomingTail;
          truthSetPathCalled = true; truthRouteVersionIncremented = true;
          truthUpdateReason = 'new_body_geometry';
          console.log('[NAV] ROUTE_UPDATE_APPLIED_NEW_BODY_GEOMETRY', {
            seq, source: 'polling',
            oldBodySignature: prevBody, newBodySignature: incomingBody,
            pathLen: incomingPath.length, routeVersionWillIncrement: true,
            replanType: replanTypeNow, mapboxApiCalled: mapboxCalledNow, refetchReason: refetchReasonNow,
          });
          console.log('[NAV] APPLY_NEW_ROUTE', {
            seq, sessionId, pathLen: incomingPath.length,
            first: incomingPath[0], last: incomingPath[incomingPath.length - 1],
            status: updateData.status, replanType: replanTypeNow,
            mapboxApiCalled: mapboxCalledNow, refetchReason: refetchReasonNow,
          });
        }

        console.log('[NAV] NAV_FRONTEND_PATH_TRUTH', {
          seq,
          status: updateData.status,
          replanType: updateMeta.lastMetric?.replanType ?? null,
          mapboxApiCalled: updateMeta.lastMetric?.mapboxApiCalled ?? false,
          incomingPathLen: incomingPath.length,
          incomingFullSignature: incomingFull,
          incomingBodySignature: incomingBody,
          incomingTailSignature: incomingTail,
          prevFullSignature: prevFull,
          prevBodySignature: prevBody,
          prevTailSignature: prevTail,
          setPathCalled: truthSetPathCalled,
          routeVersionIncremented: truthRouteVersionIncremented,
          routeVersionBefore: truthRouteVersionBefore,
          routeVersionAfter: routeVersionRef.current,
          updateReason: truthUpdateReason,
          skipReason: truthSkipReason,
        });

        setDistance(updateData.totalCost || 0);
        setEta(updateData.estimatedTimeSeconds || 0);
        setRouteUxState('navigating');

        console.log('[NAV] PATH_UPDATED', {
          len: updateData.path.length,
          first: updateData.path[0],
          last: updateData.path[updateData.path.length - 1],
        });
        console.log('[NAV_UPDATE]', {
          status:    updateData.status,
          pathLen:   updateData.path.length,
          totalCost: updateData.totalCost,
          metric:    updateData.lastMetric,
        });

        if (updateData.suggestedPollIntervalMs) {
          setPollMs(updateData.suggestedPollIntervalMs);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          console.log('[NAV] NAV_UPDATE_REQUEST_ABORTED', { seq, sessionId });
          return;
        }
        console.error('[NAV] Polling error', { seq, sessionId, durationMs: Date.now() - startedAt, err });
        setRouteUxState('routeTemporarilyUnavailable');
      } finally {
        isUpdateInFlightRef.current = false;
      }
    }, pollMs);

    // Cleanup เมื่อ unmount หรือ status เปลี่ยน — abort any in-flight request
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      isUpdateInFlightRef.current = false;
    };
  }, [status, sessionId, pollMs, navService, start, markArrived]);

  return (
    <NavigationContext.Provider value={{
      path,
      status,
      routeUxState,
      sessionId,
      start,
      stop,
      markArrived,
      clearNavigationSession,
      eta,
      distance,
      corridorNodeCount,
      updatePositions,
      routeVersion,
      routeSourceKey,
      endpointDiagnostics,
      restoreChecked,
    }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
}
