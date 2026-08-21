export interface LatLng {
  lat: number;
  lng: number;
}

export type NavigationMode = 'mapbox_only' | 'hybrid';

export type ReplanType =
  | 'initial'
  | 'incremental'
  | 'refetch'
  | 'mapbox_call'
  | 'blocked';

export interface UpdateMetric {
  timestamp:       number;
  mode:            NavigationMode;
  replanType:      ReplanType;
  mapboxApiCalled: boolean;
  stepMs:          number;
  totalMs:         number;
  pathLength:      number;
  totalCost:       number;
  targetMovedM:    number;
  agentMovedM:     number;
  refetchReason?:  string | null;
  responsePathSource?: string | null;
  pathReachesTarget?: boolean | null;
  targetCoveredBySessionGraph?: boolean | null;
  targetCoverageReason?: string | null;
  graphNodeCount?:     number | null;
  graphEdgeCount?:     number | null;
  targetProjectionM?: number | null;
  targetProjectionDistanceM?: number | null;
  targetAttachmentEdgeId?: string | null;
  targetAttachmentSource?: string | null;
  jumpClassification?: string | null;
  jumpEdgeId?: string | null;
  jumpEdgeSource?: string | null;
  jumpGeometryPointCount?: number | null;
  jumpAllowed?: boolean | null;
  pathEndpoint?: LatLng | null;
  routeGoalPoint?: LatLng | null;
  finalEndpointDistanceM?: number | null;
  endpointTrimmed?: boolean | null;
  endpointExtended?: boolean | null;
  endpointEnforced?: boolean | null;
}

interface InitResponse {
  sessionId: string;
  path: LatLng[];
  totalCost: number;
  status: 'OK' | 'ARRIVED' | 'NO_ROUTE' | 'ERROR';
  success?: boolean;
  navigationState?: 'INITIALIZING' | 'NAVIGATING' | 'ARRIVED' | 'NO_ROUTE' | 'SNAP_AMBIGUITY' | 'ERROR';
  responsePathSource?: string | null;
  plannerAttempted?: boolean;
  plannerSucceeded?: boolean | null;
  mapboxApiCalled?: boolean;
  initFailureReason?: string | null;
  corridorNodeCount: number;
  estimatedTimeSeconds: number;
}

interface ApiError {
  error: boolean;
  status: number;
  rateLimit?: boolean;
  message?: string;
}

interface UpdateResponse {
  success: boolean;
  path: LatLng[];
  totalCost: number;
  status: 'OK' | 'ARRIVED' | 'NO_ROUTE' | 'ERROR';
  suggestedPollIntervalMs: number;
  estimatedTimeSeconds?: number;
  navigationState?: 'INITIALIZING' | 'NAVIGATING' | 'UPDATING_ROUTE' | 'REBUILDING_GRAPH' | 'ARRIVED' | 'NO_ROUTE' | 'SNAP_AMBIGUITY' | 'ERROR';
  pathReachesTarget?: boolean | null;
  refetchReason?: string | null;
  maxJumpM?: number | null;
  jumpClassification?: string | null;
  edgeId?: string | null;
  edgeSource?: string | null;
  pathUsesSparseGeometry?: boolean | null;
  sparseGeometryMaxJumpM?: number | null;
  sparseGeometryEdgeCount?: number | null;
  geometryPointCount?: number | null;
  allowed?: boolean | null;
  jumpEdgeId?: string | null;
  jumpEdgeSource?: string | null;
  jumpGeometryPointCount?: number | null;
  jumpAllowed?: boolean | null;
  pathEndpoint?: LatLng | null;
  routeGoalPoint?: LatLng | null;
  targetGpsPoint?: LatLng | null;
  preEnforcementEndpointDistanceM?: number | null;
  finalEndpointDistanceM?: number | null;
  endpointDistanceM?: number | null;
  endpointTrimmed?: boolean | null;
  endpointExtended?: boolean | null;
  endpointEnforced?: boolean | null;
  lastMetric?: UpdateMetric;
}

export class NavigationService {
  private apiBase: string;

  constructor() {
    this.apiBase = '';
    this.log('API base (same-origin):', this.apiBase);
  }

  async init(agentPos: LatLng, targetPos: LatLng, mode: NavigationMode = 'hybrid', runId?: string | null): Promise<InitResponse | ApiError> {
    try {
      const url = `${this.apiBase}/api/navigate/init`;
      this.log('POST', url);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentPos, targetPos, mode, ...(runId ? { runId } : {}) })
      });
      
      if (res.status === 429) return { error: true, status: 429, rateLimit: true };
      if (!res.ok) return { error: true, status: res.status };
      
      return await res.json();
    } catch (err: unknown) {
      return { error: true, status: 500, message: getErrorMessage(err) };
    }
  }

  async update(
    sessionId: string,
    agentPos: LatLng,
    targetPos: LatLng,
    signal?: AbortSignal,
    research?: { runId?: string | null; routeUpdateId?: string | null },
  ): Promise<(UpdateResponse & { sessionExpired?: boolean }) | ApiError> {
    try {
      const url = `${this.apiBase}/api/navigate/update`;
      this.log('POST', url);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          agentPos,
          targetPos,
          ...(research?.runId ? { runId: research.runId } : {}),
          ...(research?.routeUpdateId ? { routeUpdateId: research.routeUpdateId } : {}),
        }),
        signal,
      });

      if (res.status === 404) {
        return { sessionExpired: true } as UpdateResponse & { sessionExpired: true };
      }
      if (res.status === 429) return { error: true, status: 429, rateLimit: true };
      if (!res.ok) return { error: true, status: res.status };

      return await res.json();
    } catch (err: unknown) {
      // Rethrow AbortError so the caller can distinguish intentional cancellation
      if (err instanceof Error && err.name === 'AbortError') throw err;
      return { error: true, status: 500, message: getErrorMessage(err) };
    }
  }

  private log(...args: unknown[]) {
    if (typeof window !== 'undefined') {
      console.info('[NavigationService]', ...args);
    }
  }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Network error';
}
