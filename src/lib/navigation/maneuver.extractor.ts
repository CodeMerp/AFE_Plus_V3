import type {
  Coordinate,
  GraphEdge,
  GraphEdgeManeuver,
  NavigationManeuver,
  NavigationManeuverType,
} from './types';
import { classifyTurnDelta, extractTransitionTangents, signedBearingDelta } from './bearing';

const EXCLUDED_EDGE_SOURCES = new Set([
  'virtual_node_agent',
  'virtual_node_target',
  'target_ray',
]);

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function normalizeMapboxManeuver(
  maneuver: GraphEdgeManeuver,
): NavigationManeuverType | null {
  const type = normalize(maneuver.type);
  const modifier = normalize(maneuver.modifier);

  if (
    type === 'roundabout' || type === 'rotary' || type === 'roundabout turn' ||
    type === 'exit roundabout' || type === 'exit rotary' || type === 'fork' ||
    type === 'merge' || type === 'on ramp' || type === 'off ramp'
  ) return null;

  if (type.includes('uturn') || modifier === 'uturn') return 'UTURN';
  if (type !== 'turn' && type !== 'end of road') return null;
  if (modifier === 'slight left') return 'SLIGHT_LEFT';
  if (modifier === 'slight right') return 'SLIGHT_RIGHT';
  if (modifier === 'left' || modifier === 'sharp left') return 'TURN_LEFT';
  if (modifier === 'right' || modifier === 'sharp right') return 'TURN_RIGHT';
  return null;
}

function transitionExcluded(inEdge: GraphEdge, outEdge: GraphEdge): boolean {
  return (
    EXCLUDED_EDGE_SOURCES.has(inEdge.edgeSource ?? '') ||
    EXCLUDED_EDGE_SOURCES.has(outEdge.edgeSource ?? '') ||
    inEdge.maneuverGeometryFallbackExcluded !== undefined ||
    outEdge.maneuverGeometryFallbackExcluded !== undefined
  );
}

export function extractManeuvers(selectedEdges: GraphEdge[]): NavigationManeuver[] {
  const result: NavigationManeuver[] = [];

  for (let i = 1; i < selectedEdges.length; i++) {
    const inEdge = selectedEdges[i - 1];
    const outEdge = selectedEdges[i];
    if (transitionExcluded(inEdge, outEdge)) continue;

    const location = outEdge.geometry?.[0];
    if (!location) continue;

    if (outEdge.maneuver) {
      const type = normalizeMapboxManeuver(outEdge.maneuver);
      if (type) {
        result.push({
          type,
          location,
          source: 'mapbox',
          sourceStepIndex: outEdge.maneuver.sourceStepIndex,
        });
      }
      continue;
    }

    if (!outEdge.maneuverGeometryFallbackEligible) continue;

    const tangents = extractTransitionTangents(inEdge, outEdge);
    if (!tangents) continue;
    const type = classifyTurnDelta(signedBearingDelta(tangents.incoming, tangents.outgoing));
    if (type) result.push({ type, location, source: 'geometry-fallback' });
  }

  return result;
}

function sameCoordinate(a: Coordinate, b: Coordinate): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

/** Removes transitions trimmed out of the response while preserving selected-edge order. */
export function maneuversForPath(
  selectedEdges: GraphEdge[],
  responsePath: Coordinate[],
): NavigationManeuver[] {
  return extractManeuvers(selectedEdges).filter((maneuver) =>
    responsePath.some((point) => sameCoordinate(point, maneuver.location)),
  );
}
