import type { CircuitState } from '@/lib/navigation/types';
import { createLogger, CircuitOpenError } from './logger';

const log = createLogger('circuit-breaker');

interface CircuitBreakerOpts {
  name: string;
  failureThreshold: number;  // failures ก่อนเปิด circuit
  resetTimeoutMs: number;    // เวลารอก่อน HALF_OPEN
  requestTimeoutMs: number;  // timeout ต่อ request
  maxRetries: number;        // retry ก่อนนับ failure
}

const DEFAULTS: CircuitBreakerOpts = {
  name: 'external',
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  requestTimeoutMs: 5_000,
  maxRetries: 2,
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailAt = 0;
  private readonly opts: CircuitBreakerOpts;

  constructor(opts: Partial<CircuitBreakerOpts> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  getState(): CircuitState {
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // OPEN → เช็คว่าถึงเวลา HALF_OPEN หรือยัง
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailAt >= this.opts.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        log.info({ svc: this.opts.name }, 'circuit → HALF_OPEN');
      } else {
        throw new CircuitOpenError(this.opts.name);
      }
    }

    const attempts = this.state === 'HALF_OPEN' ? 1 : this.opts.maxRetries + 1;
    let lastErr: Error | undefined;

    for (let i = 1; i <= attempts; i++) {
      try {
        // ใช้ AbortSignal.timeout แทน manual setTimeout
        const result = await this.withTimeout(fn);
        this.onSuccess();
        return result;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        log.warn({ svc: this.opts.name, attempt: i, err: lastErr.message }, 'attempt failed');
        if (i < attempts) await this.sleep(200 * Math.pow(2, i - 1));
      }
    }

    this.onFailure();
    throw lastErr!;
  }

  private async withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout ${this.opts.requestTimeoutMs}ms`)),
        this.opts.requestTimeoutMs,
      );
      fn()
        .then((v) => { clearTimeout(timer); resolve(v); })
        .catch((e) => { clearTimeout(timer); reject(e); });
    });
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      log.info({ svc: this.opts.name }, 'circuit → CLOSED (recovered)');
    }
    this.state = 'CLOSED';
    this.failures = 0;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailAt = Date.now();
    if (this.failures >= this.opts.failureThreshold) {
      this.state = 'OPEN';
      log.error({ svc: this.opts.name, failures: this.failures }, 'circuit → OPEN');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
