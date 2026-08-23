import type { Coordinate, GraphEdge, NavigationManeuverType } from './types';

function sameCoordinate(a: Coordinate, b: Coordinate): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

/** Clockwise bearing in degrees, normalized to [0, 360). */
export function bearingBetween(a: Coordinate, b: Coordinate): number {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Shortest clockwise delta: positive is right, negative is left. */
export function signedBearingDelta(before: number, after: number): number {
  const normalized = ((after - before + 540) % 360) - 180;
  return normalized === -180 ? 180 : normalized;
}

export function classifyTurnDelta(delta: number): NavigationManeuverType | null {
  const magnitude = Math.abs(delta);
  if (magnitude < 11) return null;
  if (magnitude >= 170) return 'UTURN';
  if (magnitude < 45) return delta > 0 ? 'SLIGHT_RIGHT' : 'SLIGHT_LEFT';
  return delta > 0 ? 'TURN_RIGHT' : 'TURN_LEFT';
}

function incomingTangent(geometry: Coordinate[] | undefined): number | null {
  if (!geometry || geometry.length < 2) return null;
  const transition = geometry[geometry.length - 1];
  for (let i = geometry.length - 2; i >= 0; i--) {
    if (!sameCoordinate(geometry[i], transition)) {
      return bearingBetween(geometry[i], transition);
    }
  }
  return null;
}

function outgoingTangent(geometry: Coordinate[] | undefined): number | null {
  if (!geometry || geometry.length < 2) return null;
  const transition = geometry[0];
  for (let i = 1; i < geometry.length; i++) {
    if (!sameCoordinate(geometry[i], transition)) {
      return bearingBetween(transition, geometry[i]);
    }
  }
  return null;
}

export function extractTransitionTangents(
  inEdge: GraphEdge,
  outEdge: GraphEdge,
): { incoming: number; outgoing: number } | null {
  const incoming = incomingTangent(inEdge.geometry);
  const outgoing = outgoingTangent(outEdge.geometry);
  return incoming === null || outgoing === null ? null : { incoming, outgoing };
}
