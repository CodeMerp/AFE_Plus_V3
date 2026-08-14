import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
        },
      }),
  base: { service: 'afe-navigate' },
});

export const createLogger = (module: string) => logger.child({ module });

// ─── Metrics ──────────────────────────────────────────────────────────────────
class MetricsTracker {
  private latencies: number[] = [];
  private errorCount = 0;
  private requestCount = 0;
  private _activeSessions = 0;

  recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 1000) this.latencies.shift();
    this.requestCount++;
  }

  recordError(): void {
    this.errorCount++;
  }

  setActiveSessions(n: number): void {
    this._activeSessions = n;
  }

  getP95(): number {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  }

  getSummary() {
    return {
      p95LatencyMs: this.getP95(),
      errorRate: this.requestCount === 0 ? 0 : this.errorCount / this.requestCount,
      totalRequests: this.requestCount,
      totalErrors: this.errorCount,
      activeSessions: this._activeSessions,
    };
  }
}

export const metrics = new MetricsTracker();

// ─── Custom Errors ────────────────────────────────────────────────────────────
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'INTERNAL_ERROR',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class MapboxApiError extends AppError {
  constructor(message: string, statusCode = 502) {
    super(message, statusCode, 'MAPBOX_API_ERROR');
    this.name = 'MapboxApiError';
  }
}

export class SessionNotFoundError extends AppError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, 404, 'SESSION_NOT_FOUND');
    this.name = 'SessionNotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class CircuitOpenError extends AppError {
  constructor(serviceName: string) {
    super(`Circuit breaker OPEN for ${serviceName}`, 503, 'CIRCUIT_OPEN');
    this.name = 'CircuitOpenError';
  }
}

// ─── Session lock errors (M4-B1.3) ────────────────────────────────────────────
// Deliberately NOT AppError subclasses: their HTTP response is a 200 with a
// frontend-safe UpdateResponse body (M4-B1.2 §7 / M4-B1.2.1 §11), not the
// generic {success:false,status:'ERROR'} shape AppError's catch branch returns.
export class SessionLockBusyError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session lock busy: ${sessionId}`);
    this.name = 'SessionLockBusyError';
  }
}

export class SessionLockLostError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session lock lost mid-request: ${sessionId}`);
    this.name = 'SessionLockLostError';
  }
}

// ─── Session lock failure-classification errors (M4-B1.5) ────────────────────
// M4-B1.4 proved that collapsing every non-'lock_lost' failure reason into
// SessionLockLostError conflates ordinary contention with infrastructure
// failures an operator actually needs to distinguish. Each carries the same
// frontend-safe 200/NO_ROUTE response as SessionLockLostError (M4-B1.2 §7) —
// only the `refetchReason` value and the backend log tags differ per case.
export class SessionLockCapabilityUnavailableError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session lock capability unavailable: ${sessionId}`);
    this.name = 'SessionLockCapabilityUnavailableError';
  }
}

export class SessionLockBackendUnavailableError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session lock backend unavailable: ${sessionId}`);
    this.name = 'SessionLockBackendUnavailableError';
  }
}

export class SessionCommitOutcomeAmbiguousError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session commit outcome ambiguous: ${sessionId}`);
    this.name = 'SessionCommitOutcomeAmbiguousError';
  }
}
