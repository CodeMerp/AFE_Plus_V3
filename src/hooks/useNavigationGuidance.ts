'use client';

import { useRef } from 'react';
import type { LatLng } from '@/lib/services/navigation.service';
import type { NavigationManeuver, NavigationManeuverType } from '@/lib/navigation/types';
import type { ManeuverRouteSnapshot, RouteUxState } from '@/hooks/useNavigation';

export type NavigationStatus = 'idle' | 'loading' | 'active' | 'arrived' | 'error';

export type ManeuverWithProgress = {
  maneuver: NavigationManeuver;
  progressM: number;
  listIndex: number;
  key: string;
};

export type GuidanceAvailability =
  | 'available'
  | 'inactive'
  | 'arrival-owned'
  | 'route-incompatible'
  | 'agent-progress-unavailable'
  | 'no-maneuver-ahead';

export type NavigationGuidance = {
  availability: GuidanceAvailability;
  currentManeuver: ManeuverWithProgress | null;
  nextManeuver: ManeuverWithProgress | null;
  currentManeuverProgressM: number | null;
  nextManeuverProgressM: number | null;
  agentProgressM: number | null;
  distanceToManeuverM: number | null;
  semanticType: NavigationManeuverType | null;
  instruction: string | null;
  maneuverRouteSource: 'latest-compatible' | 'retained-compatible' | 'none';
};

export type ProjectPointToRouteProgress = (
  point: LatLng,
  route: LatLng[],
) => number | null;

export function routesAreExactlyEqual(a: LatLng[], b: LatLng[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((point, index) => point.lat === b[index].lat && point.lng === b[index].lng);
}

export function navigationManeuverInstruction(type: NavigationManeuverType): string {
  switch (type) {
    case 'TURN_LEFT':
      return 'เลี้ยวซ้าย';
    case 'TURN_RIGHT':
      return 'เลี้ยวขวา';
    case 'SLIGHT_LEFT':
      return 'เบี่ยงซ้าย';
    case 'SLIGHT_RIGHT':
      return 'เบี่ยงขวา';
    case 'UTURN':
      return 'กลับรถ';
  }
}

export type CompatibleManeuverRouteSelection = {
  snapshot: ManeuverRouteSnapshot | null;
  retainedSnapshot: ManeuverRouteSnapshot | null;
  source: NavigationGuidance['maneuverRouteSource'];
};

export function selectCompatibleManeuverRoute(
  latest: ManeuverRouteSnapshot | null,
  retained: ManeuverRouteSnapshot | null,
  activeRoute: LatLng[],
): CompatibleManeuverRouteSelection {
  if (latest && routesAreExactlyEqual(latest.path, activeRoute)) {
    return { snapshot: latest, retainedSnapshot: latest, source: 'latest-compatible' };
  }
  if (retained && routesAreExactlyEqual(retained.path, activeRoute)) {
    return { snapshot: retained, retainedSnapshot: retained, source: 'retained-compatible' };
  }
  return { snapshot: null, retainedSnapshot: retained, source: 'none' };
}

type DeriveGuidanceInput = {
  snapshot: ManeuverRouteSnapshot | null;
  activeRoute: LatLng[];
  agentProgressM: number;
  agentProgressValid: boolean;
  status: NavigationStatus;
  routeUxState: RouteUxState;
  hasArrived: boolean;
  isNearArrival: boolean;
  projectPointToProgress: ProjectPointToRouteProgress;
  maneuverRouteSource?: NavigationGuidance['maneuverRouteSource'];
};

function unavailableGuidance(
  availability: GuidanceAvailability,
  agentProgressM: number | null,
  maneuverRouteSource: NavigationGuidance['maneuverRouteSource'],
): NavigationGuidance {
  return {
    availability,
    currentManeuver: null,
    nextManeuver: null,
    currentManeuverProgressM: null,
    nextManeuverProgressM: null,
    agentProgressM,
    distanceToManeuverM: null,
    semanticType: null,
    instruction: null,
    maneuverRouteSource,
  };
}

export function deriveNavigationGuidance(input: DeriveGuidanceInput): NavigationGuidance {
  const source = input.maneuverRouteSource ?? (input.snapshot ? 'latest-compatible' : 'none');
  const validAgentProgress = input.agentProgressValid && Number.isFinite(input.agentProgressM);
  const agentProgressM = validAgentProgress ? input.agentProgressM : null;

  if (input.hasArrived || input.isNearArrival || input.status === 'arrived') {
    return unavailableGuidance('arrival-owned', agentProgressM, source);
  }
  if (input.status !== 'active' || input.routeUxState !== 'navigating') {
    return unavailableGuidance('inactive', agentProgressM, source);
  }
  if (
    !input.snapshot
    || input.activeRoute.length < 2
    || !routesAreExactlyEqual(input.snapshot.path, input.activeRoute)
  ) {
    return unavailableGuidance('route-incompatible', agentProgressM, source);
  }
  if (!validAgentProgress) {
    return unavailableGuidance('agent-progress-unavailable', null, source);
  }

  const projected = input.snapshot.maneuvers
    .map((maneuver, listIndex): ManeuverWithProgress | null => {
      const progressM = input.projectPointToProgress(maneuver.location, input.activeRoute);
      if (progressM === null || !Number.isFinite(progressM)) return null;
      return {
        maneuver,
        progressM,
        listIndex,
        key: `${listIndex}:${maneuver.type}`,
      };
    })
    .filter((maneuver): maneuver is ManeuverWithProgress => maneuver !== null)
    .sort((a, b) => a.progressM - b.progressM || a.listIndex - b.listIndex);

  const currentIndex = projected.findIndex((item) => item.progressM >= input.agentProgressM);
  if (currentIndex < 0) {
    return unavailableGuidance('no-maneuver-ahead', input.agentProgressM, source);
  }

  const currentManeuver = projected[currentIndex];
  const nextManeuver = projected[currentIndex + 1] ?? null;
  return {
    availability: 'available',
    currentManeuver,
    nextManeuver,
    currentManeuverProgressM: currentManeuver.progressM,
    nextManeuverProgressM: nextManeuver?.progressM ?? null,
    agentProgressM: input.agentProgressM,
    distanceToManeuverM: currentManeuver.progressM - input.agentProgressM,
    semanticType: currentManeuver.maneuver.type,
    instruction: navigationManeuverInstruction(currentManeuver.maneuver.type),
    maneuverRouteSource: source,
  };
}

type UseNavigationGuidanceInput = Omit<DeriveGuidanceInput, 'snapshot' | 'maneuverRouteSource'> & {
  sessionId: string | null;
  maneuverRoute: ManeuverRouteSnapshot | null;
};

export function useNavigationGuidance(input: UseNavigationGuidanceInput): NavigationGuidance {
  const retainedRef = useRef<{
    sessionId: string | null;
    snapshot: ManeuverRouteSnapshot | null;
  }>({ sessionId: input.sessionId, snapshot: null });

  if (retainedRef.current.sessionId !== input.sessionId) {
    retainedRef.current = { sessionId: input.sessionId, snapshot: null };
  }

  const selection = selectCompatibleManeuverRoute(
    input.maneuverRoute,
    retainedRef.current.snapshot,
    input.activeRoute,
  );
  retainedRef.current.snapshot = selection.retainedSnapshot;

  return deriveNavigationGuidance({
    ...input,
    snapshot: selection.snapshot,
    maneuverRouteSource: selection.source,
  });
}

export type NavigationTopBarPresentation = {
  title: string;
  distance: number | null;
  source: 'loading' | 'arrived' | 'nearArrival' | 'currentManeuver' | 'remainingDistanceFallback' | 'hiddenDistanceFallback' | 'idle';
  maneuverType: NavigationManeuverType | 'arrive' | 'arrive_near' | 'continue' | null;
};

export function resolveNavigationTopBarPresentation(input: {
  status: NavigationStatus;
  hasArrived: boolean;
  isNearArrival: boolean;
  nearArrivalDistanceM: number | null;
  remainingDistanceM: number;
  guidance: NavigationGuidance;
}): NavigationTopBarPresentation {
  if (input.status === 'loading') {
    return { title: 'กำลังคำนวณเส้นทาง...', distance: null, source: 'loading', maneuverType: null };
  }
  if (input.status === 'arrived' || input.hasArrived) {
    return { title: 'ถึงจุดหมายแล้ว', distance: null, source: 'arrived', maneuverType: 'arrive' };
  }
  if (input.status === 'active' && input.isNearArrival) {
    return {
      title: 'ใกล้ถึงจุดหมายแล้ว',
      distance: input.nearArrivalDistanceM,
      source: 'nearArrival',
      maneuverType: 'arrive_near',
    };
  }
  if (
    input.status === 'active'
    && input.guidance.currentManeuver
    && input.guidance.instruction
    && input.guidance.distanceToManeuverM !== null
  ) {
    return {
      title: input.guidance.instruction,
      distance: Math.max(0, input.guidance.distanceToManeuverM),
      source: 'currentManeuver',
      maneuverType: input.guidance.currentManeuver.maneuver.type,
    };
  }
  if (input.status === 'active' && input.remainingDistanceM > 0) {
    return {
      title: 'ขับต่อไปตามเส้นทาง',
      distance: input.remainingDistanceM,
      source: 'remainingDistanceFallback',
      maneuverType: 'continue',
    };
  }
  return {
    title: input.status === 'active' ? 'ขับต่อไปตามเส้นทาง' : 'เตรียมพร้อมนำทาง',
    distance: null,
    source: input.status === 'active' ? 'hiddenDistanceFallback' : 'idle',
    maneuverType: input.status === 'active' ? 'continue' : null,
  };
}

export type RouteUxBanner = {
  title: string;
  subtitle: string | null;
  action: 'ลองใหม่' | null;
};

export function resolveRouteUxBanner(routeUxState: RouteUxState): RouteUxBanner | null {
  switch (routeUxState) {
    case 'initializing':
      return { title: 'กำลังสร้างเส้นทาง...', subtitle: null, action: null };
    case 'recalculating':
      return { title: 'กำลังปรับเส้นทาง...', subtitle: 'ตำแหน่งผู้ป่วยเปลี่ยน', action: null };
    case 'routeTemporarilyUnavailable':
      return { title: 'กำลังค้นหาเส้นทางใหม่...', subtitle: 'ยังใช้เส้นทางเดิม', action: null };
    case 'initNoRoute':
      return { title: 'ยังไม่พบเส้นทางเริ่มต้น', subtitle: null, action: 'ลองใหม่' };
    case 'error':
      return { title: 'เกิดข้อผิดพลาด', subtitle: null, action: null };
    default:
      return null;
  }
}
