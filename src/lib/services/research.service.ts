import type { LatLng } from './navigation.service';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://afe-tracking-backend-production-3293.up.railway.app';

export const RESEARCH_RUN_STORAGE_KEY = 'afe_v3_research_run_id';
export const RESEARCH_ENABLED_STORAGE_KEY = 'afe_v3_research_enabled';

export type ResearchRouteClassification = 'SUCCESS' | 'FAILURE';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function isResearchModeEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_RESEARCH_MODE === 'true') return true;
  if (!canUseStorage()) return false;
  return localStorage.getItem(RESEARCH_ENABLED_STORAGE_KEY) === 'true';
}

export function getActiveResearchRunId(): string | null {
  if (!canUseStorage()) return null;
  if (!isResearchModeEnabled()) return null;
  const runId = localStorage.getItem(RESEARCH_RUN_STORAGE_KEY);
  return runId && runId.trim().length > 0 ? runId : null;
}

export function setActiveResearchRunId(runId: string | null): void {
  if (!canUseStorage()) return;
  if (runId) {
    localStorage.setItem(RESEARCH_RUN_STORAGE_KEY, runId);
    localStorage.setItem(RESEARCH_ENABLED_STORAGE_KEY, 'true');
  } else {
    localStorage.removeItem(RESEARCH_RUN_STORAGE_KEY);
  }
}

async function postJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String(payload.error)
      : `Research API ${path} failed: ${res.status}`;
    throw new Error(message);
  }
}

async function patchJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String(payload.error)
      : `Research API ${path} failed: ${res.status}`;
    throw new Error(message);
  }
}

export const researchService = {
  async startRun(runId: string): Promise<void> {
    await postJson('/api/research/runs', {
      runId,
      clientStartedAt: new Date().toISOString(),
      metadata: {
        source: 'V3_NAVIGATION_FRONTEND',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
    });
    setActiveResearchRunId(runId);
  },

  async bindSession(runId: string, sessionId: string): Promise<void> {
    await patchJson(`/api/research/runs/${encodeURIComponent(runId)}`, {
      sessionId,
      status: 'RUNNING',
    });
  },

  async stopRun(runId: string): Promise<void> {
    await patchJson(`/api/research/runs/${encodeURIComponent(runId)}`, {
      action: 'stop',
      clientEndedAt: new Date().toISOString(),
    });
  },

  recordNavEvent(event: Record<string, unknown>): void {
    void postJson('/api/research/nav-events', event).catch((err) => {
      console.warn('[RESEARCH] nav event dropped', err);
    });
  },

  exportUrl(runId: string, format: 'json' | 'csv'): string {
    return `${API_BASE}/api/research/export/${encodeURIComponent(runId)}?format=${format}`;
  },
};

export function makeClientEventId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

export function isRenderablePath(path: unknown, status: unknown, success: unknown): boolean {
  return success === true && status === 'OK' && Array.isArray(path) && path.length >= 2;
}

export function classifyUpdateResult(data: {
  success?: boolean;
  status?: string;
  path?: unknown;
  refetchReason?: string | null;
  lastMetric?: { pathReachesTarget?: boolean | null; refetchReason?: string | null } | null;
}): { classification: ResearchRouteClassification; failureReason: string | null } {
  if (isRenderablePath(data.path, data.status, data.success)) {
    if (data.lastMetric?.pathReachesTarget === false) {
      return { classification: 'FAILURE', failureReason: 'path_not_reaching_target' };
    }
    return { classification: 'SUCCESS', failureReason: null };
  }
  return {
    classification: 'FAILURE',
    failureReason: data.refetchReason ?? data.lastMetric?.refetchReason ?? data.status ?? 'invalid_path',
  };
}

export function positionPayload(pos: LatLng): { lat: number; lng: number } {
  return { lat: pos.lat, lng: pos.lng };
}
