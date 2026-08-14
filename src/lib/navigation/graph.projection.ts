/**
 * graph.projection.ts
 * Phase 1 telemetry helper — find nearest projection of a point onto graph edge geometry.
 *
 * Pure read-only: does NOT mutate graph, create nodes, split edges, or affect routing.
 * Used only for diagnostic logging to evaluate feasibility of Projected Target Endpoint.
 */
import type { Coordinate, SerializableGraph } from '@/lib/navigation/types';
import { haversine } from './gps.smooth';

export interface EdgeProjectionResult {
  edgeFrom: string;
  edgeTo: string;
  projectedPoint: Coordinate;
  distanceM: number;
  distanceAlongEdgeM: number;
  projectedRatio: number;
  segmentIndex: number;
  edgeCostM: number;
  geometryPointCount: number;
}

/**
 * Finds the nearest projection of targetPos onto any edge geometry in the graph.
 *
 * Uses cosLat-corrected meter-space projection (same approach as trimPathFromAgent)
 * to avoid latitude distortion. Skips zero-length segments safely.
 *
 * Returns null only when no edge has geometry with >= 2 points.
 */
export function findNearestEdgeProjection(
  targetPos: Coordinate,
  graph: SerializableGraph,
): EdgeProjectionResult | null {
  const cosLat = Math.cos(targetPos.lat * Math.PI / 180);
  const LAT_M = 111320;
  const LNG_M = LAT_M * cosLat;

  let best: EdgeProjectionResult | null = null;
  let bestDistM = Infinity;

  for (const edgeList of Object.values(graph.edges)) {
    for (const edge of edgeList) {
      const geom = edge.geometry;
      if (!geom || geom.length < 2) continue;

      let distAlongM = 0;

      for (let i = 0; i < geom.length - 1; i++) {
        const segLenM = haversine(geom[i].lat, geom[i].lng, geom[i + 1].lat, geom[i + 1].lng);

        const ax = geom[i].lng * LNG_M,     ay = geom[i].lat * LAT_M;
        const bx = geom[i + 1].lng * LNG_M, by = geom[i + 1].lat * LAT_M;
        const dx = bx - ax, dy = by - ay;
        const segLenSq = dx * dx + dy * dy;

        if (segLenSq === 0) {
          // Zero-length segment — skip projection, accumulate distance only
          distAlongM += segLenM;
          continue;
        }

        const t = Math.max(0, Math.min(1,
          ((targetPos.lng * LNG_M - ax) * dx + (targetPos.lat * LAT_M - ay) * dy) / segLenSq,
        ));

        const projLat = geom[i].lat + t * (geom[i + 1].lat - geom[i].lat);
        const projLng = geom[i].lng + t * (geom[i + 1].lng - geom[i].lng);
        const distM = haversine(targetPos.lat, targetPos.lng, projLat, projLng);

        if (distM < bestDistM) {
          const segDistAlongM = distAlongM + t * segLenM;
          const edgeCostM = edge.cost;
          bestDistM = distM;
          best = {
            edgeFrom: edge.from,
            edgeTo: edge.to,
            projectedPoint: { lat: projLat, lng: projLng },
            distanceM: distM,
            distanceAlongEdgeM: segDistAlongM,
            projectedRatio: edgeCostM > 0 ? segDistAlongM / edgeCostM : 0,
            segmentIndex: i,
            edgeCostM,
            geometryPointCount: geom.length,
          };
        }

        distAlongM += segLenM;
      }
    }
  }

  return best;
}
