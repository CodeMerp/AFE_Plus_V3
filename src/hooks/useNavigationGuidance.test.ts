import assert from 'node:assert/strict';
import type { LatLng } from '@/lib/services/navigation.service';
import type { NavigationManeuver, NavigationManeuverType } from '@/lib/navigation/types';
import type { ManeuverRouteSnapshot } from '@/hooks/useNavigation';
import {
  deriveNavigationGuidance,
  navigationManeuverInstruction,
  resolveNavigationTopBarPresentation,
  resolveRouteUxBanner,
  selectCompatibleManeuverRoute,
} from './useNavigationGuidance';

const straightRoute: LatLng[] = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 100 },
];

function maneuver(type: NavigationManeuverType, progressM: number): NavigationManeuver {
  return { type, location: { lat: 0, lng: progressM }, source: 'mapbox' };
}

function snapshot(route: LatLng[], maneuvers: NavigationManeuver[]): ManeuverRouteSnapshot {
  return { path: route.map((point) => ({ ...point })), maneuvers };
}

// Test-only Cartesian polyline projector. Production injects navigation.tsx's
// existing meter-space projectPointToRoute + route-progress helpers instead.
function projectTestPoint(point: LatLng, route: LatLng[]): number | null {
  if (route.length < 2) return null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  let cumulative = 0;
  for (let index = 0; index < route.length - 1; index++) {
    const a = route[index];
    const b = route[index + 1];
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const lengthSquared = dx * dx + dy * dy;
    const segmentLength = Math.sqrt(lengthSquared);
    const rawT = lengthSquared > 0
      ? ((point.lng - a.lng) * dx + (point.lat - a.lat) * dy) / lengthSquared
      : 0;
    const t = Math.max(0, Math.min(1, rawT));
    const projectedLng = a.lng + dx * t;
    const projectedLat = a.lat + dy * t;
    const distanceSquared = (point.lng - projectedLng) ** 2 + (point.lat - projectedLat) ** 2;
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestProgress = cumulative + segmentLength * t;
    }
    cumulative += segmentLength;
  }
  return bestProgress;
}

function derive(
  maneuvers: NavigationManeuver[],
  agentProgressM = 0,
  route = straightRoute,
) {
  return deriveNavigationGuidance({
    snapshot: snapshot(route, maneuvers),
    activeRoute: route,
    agentProgressM,
    agentProgressValid: true,
    status: 'active',
    routeUxState: 'navigating',
    hasArrived: false,
    isNearArrival: false,
    projectPointToProgress: projectTestPoint,
  });
}

// 1–5: every backend-normalized maneuver has one shared Thai semantic mapping.
const semanticCases: Array<[NavigationManeuverType, string]> = [
  ['TURN_LEFT', 'เลี้ยวซ้าย'],
  ['TURN_RIGHT', 'เลี้ยวขวา'],
  ['SLIGHT_LEFT', 'เบี่ยงซ้าย'],
  ['SLIGHT_RIGHT', 'เบี่ยงขวา'],
  ['UTURN', 'กลับรถ'],
];
for (const [type, instruction] of semanticCases) {
  const guidance = derive([maneuver(type, 30)]);
  assert.equal(guidance.semanticType, type);
  assert.equal(guidance.instruction, instruction);
  assert.equal(navigationManeuverInstruction(type), instruction);
}

// 6: current/next are sorted by projected route progress, not response order.
const sorted = derive([
  maneuver('TURN_RIGHT', 80),
  maneuver('TURN_LEFT', 20),
  maneuver('UTURN', 60),
]);
assert.equal(sorted.currentManeuver?.maneuver.type, 'TURN_LEFT');
assert.equal(sorted.nextManeuver?.maneuver.type, 'UTURN');

// 7: before first maneuver, the first is current and distance is along-route delta.
const beforeFirst = derive([maneuver('TURN_LEFT', 40)], 10);
assert.equal(beforeFirst.currentManeuverProgressM, 40);
assert.equal(beforeFirst.agentProgressM, 10);
assert.equal(beforeFirst.distanceToManeuverM, 30);

// 8: with no hysteresis, strictly passing the first promotes the following maneuver.
const afterFirst = derive([maneuver('TURN_LEFT', 20), maneuver('TURN_RIGHT', 50)], 21);
assert.equal(afterFirst.currentManeuver?.maneuver.type, 'TURN_RIGHT');
assert.equal(afterFirst.nextManeuver, null);

// 9: no maneuver ahead produces the existing continuation fallback.
const noManeuver = derive([], 10);
const continuation = resolveNavigationTopBarPresentation({
  status: 'active',
  hasArrived: false,
  isNearArrival: false,
  nearArrivalDistanceM: null,
  remainingDistanceM: 75,
  guidance: noManeuver,
});
assert.equal(continuation.title, 'ขับต่อไปตามเส้นทาง');
assert.equal(continuation.source, 'remainingDistanceFallback');

// 10–11: an L-shaped route produces 20m along-route progress while its direct
// start-to-maneuver distance is sqrt(200), proving direct distance is not used.
const curvedRoute: LatLng[] = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 10 },
  { lat: 10, lng: 10 },
];
const curved = derive([
  { type: 'SLIGHT_RIGHT', location: { lat: 10, lng: 10 }, source: 'mapbox' },
], 0, curvedRoute);
assert.equal(curved.currentManeuverProgressM, 20);
assert.equal(curved.distanceToManeuverM, 20);
assert.notEqual(curved.distanceToManeuverM, Math.hypot(10, 10));

// 12: route B maneuvers cannot replace retained route A guidance while Motion uses A.
const routeA = straightRoute;
const routeB: LatLng[] = [{ lat: 1, lng: 0 }, { lat: 1, lng: 100 }];
const pairedA = snapshot(routeA, [maneuver('TURN_LEFT', 30)]);
const pairedB = snapshot(routeB, [{ type: 'TURN_RIGHT', location: { lat: 1, lng: 30 }, source: 'mapbox' }]);
const handoffHold = selectCompatibleManeuverRoute(pairedB, pairedA, routeA);
assert.equal(handoffHold.source, 'retained-compatible');
assert.equal(handoffHold.snapshot?.maneuvers[0].type, 'TURN_LEFT');
const wrongRouteBlocked = deriveNavigationGuidance({
  snapshot: pairedB,
  activeRoute: routeA,
  agentProgressM: 0,
  agentProgressValid: true,
  status: 'active',
  routeUxState: 'navigating',
  hasArrived: false,
  isNearArrival: false,
  projectPointToProgress: projectTestPoint,
});
assert.equal(wrongRouteBlocked.availability, 'route-incompatible');
assert.equal(wrongRouteBlocked.currentManeuver, null);

// 13: once Motion uses exact route B, its paired maneuvers become compatible.
const handoffApply = selectCompatibleManeuverRoute(pairedB, pairedA, routeB);
assert.equal(handoffApply.source, 'latest-compatible');
assert.equal(handoffApply.snapshot?.maneuvers[0].type, 'TURN_RIGHT');

// 14: existing near-arrival ownership overrides an available turn.
const activeTurn = derive([maneuver('TURN_LEFT', 30)]);
const nearArrival = resolveNavigationTopBarPresentation({
  status: 'active',
  hasArrived: false,
  isNearArrival: true,
  nearArrivalDistanceM: 12,
  remainingDistanceM: 30,
  guidance: activeTurn,
});
assert.equal(nearArrival.title, 'ใกล้ถึงจุดหมายแล้ว');
assert.equal(nearArrival.source, 'nearArrival');

// 15: arrived ownership overrides an available maneuver.
const arrived = resolveNavigationTopBarPresentation({
  status: 'arrived',
  hasArrived: true,
  isNearArrival: true,
  nearArrivalDistanceM: 0,
  remainingDistanceM: 0,
  guidance: activeTurn,
});
assert.equal(arrived.title, 'ถึงจุดหมายแล้ว');
assert.equal(arrived.source, 'arrived');

// 16: route UX error text and init-no-route retry action remain unchanged.
assert.deepEqual(resolveRouteUxBanner('error'), {
  title: 'เกิดข้อผิดพลาด', subtitle: null, action: null,
});
assert.deepEqual(resolveRouteUxBanner('initNoRoute'), {
  title: 'ยังไม่พบเส้นทางเริ่มต้น', subtitle: null, action: 'ลองใหม่',
});

console.log('useNavigationGuidance deterministic tests: PASS (16 scenarios)');
