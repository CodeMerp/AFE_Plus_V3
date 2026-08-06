/**
 * Session Store — @upstash/redis | ioredis | in-memory
 *
 * Priority: Upstash (REST) → ioredis (REDIS_URL) → MemoryStore
 * msgpackr ลด payload ~40% เทียบ JSON สำหรับ graph + planner state
 * Upstash ใช้ base64 encode เพราะ REST API รับ string
 * ioredis ใช้ Buffer โดยตรงผ่าน binary protocol
 */
import { randomUUID } from 'crypto';
import { pack, unpack } from 'msgpackr';
import type { SessionData } from '@/lib/navigation/types';
import { createLogger, SessionNotFoundError } from './logger';

const log = createLogger('session-store');

const SESSION_TTL_SEC = 15 * 60; // 15 นาที
const SESSION_TTL_MS = SESSION_TTL_SEC * 1000;

// ─── Session Lock (M4-B1.3) ────────────────────────────────────────────────────
// See file-edit/2026-07-06-M4-B1.1/.2/.2.1 for the full design/audit trail.
// Lock lives in a separate `nav:lock:{sessionId}` key — never touches the
// `nav:session:{sessionId}` value format or its msgpack/base64 encoding.
const LOCK_TTL_MS_DEFAULT = 20_000;
const LOCK_TTL_MS_MIN = 5_000;
const LOCK_TTL_MS_MAX = 60_000;
const LOCK_ACQUIRE_MAX_RETRIES = 2;
const LOCK_ACQUIRE_RETRY_DELAY_MS = 150;

// KEYS[1]=lockKey KEYS[2]=sessionKey ARGV[1]=ownedToken ARGV[2]=payload ARGV[3]=ttlSeconds
// Single indivisible operation — no other client's command can execute between
// the GET and the SET inside a Lua script (M4-B1.2.1 §3/§13).
const COMMIT_IF_LOCK_OWNED_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
  return 1
else
  return 0
end
`;

// KEYS[1]=lockKey ARGV[1]=ownedToken
const RELEASE_IF_LOCK_OWNED_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
else
  return 0
end
`;

function lockKeyFor(sessionId: string): string {
  return `nav:lock:${sessionId}`;
}

function getLockTtlMs(): number {
  const raw = process.env.NAV_SESSION_LOCK_TTL_MS;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  const base = Number.isFinite(parsed) ? parsed : LOCK_TTL_MS_DEFAULT;
  return Math.min(LOCK_TTL_MS_MAX, Math.max(LOCK_TTL_MS_MIN, base));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Best-effort heuristic: distinguishes an EXPLICIT "EVAL not permitted at this
// plan/tier" rejection from an ordinary transient/transport failure. Repository
// evidence cannot prove Upstash plan-tier EVAL support either way (M4-B1.2.1
// §4) — this only decides whether to fail closed PERMANENTLY (capability-type
// error — this process will never be able to use EVAL) vs. TRANSIENTLY
// (inconclusive — a later attempt, in this request's retry or a later
// request's fresh probe, may succeed).
//
// M4-B1.4 §9 proved 'noscript' does NOT belong here: NOSCRIPT is Redis's
// EVALSHA-cache-miss signal ("No matching script. Please use EVAL.") — this
// codebase never calls EVALSHA, so NOSCRIPT is never evidence that EVAL
// itself is unsupported. Removed per M4-B1.5 Required Implementation 4.
//
// Anything NOT explicitly matched here defaults to "inconclusive" — never
// guess "unsupported" from an unrecognized/transport-level error message
// (M4-B1.5 Required Implementation 3).
function isLockCapabilityError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('unknown command') ||
    msg.includes('noperm') ||
    msg.includes('not permitted') ||
    msg.includes('not allowed') ||
    msg.includes('disabled') ||
    msg.includes('eval is not a function') ||
    msg.includes('no such method')
  );
}

// ─── Capability probe result contract (M4-B1.5) ───────────────────────────────
// 'supported'    — EVAL executed successfully; safe to cache permanently.
// 'unsupported'  — an EXPLICIT capability/permission rejection was observed;
//                   safe to cache permanently (will not change without an
//                   operator/deployment action).
// 'inconclusive' — the probe could not determine capability (network/DNS/
//                   timeout/connection-reset/transient provider error/unknown
//                   transport failure) — MUST NOT be cached as 'unsupported';
//                   a later request must be allowed to re-probe (M4-B1.4 §5/§6).
export type LockCapabilityProbeResult =
  | { status: 'supported' }
  | { status: 'unsupported'; reason: string }
  | { status: 'inconclusive'; reason: string };

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Shared by every real-Redis store's probeLockCapability(): run the trivial
// script, classify any thrown error via the narrow classifier above. Only an
// EXPLICIT capability-type error is ever reported as 'unsupported' — every
// other failure (the overwhelming majority of real-world transient issues)
// is reported as 'inconclusive', never guessed as permanent.
async function runCapabilityProbe(evalOnce: () => Promise<unknown>): Promise<LockCapabilityProbeResult> {
  try {
    const result = await evalOnce();
    return Number(result) === 1
      ? { status: 'supported' }
      : { status: 'inconclusive', reason: `unexpected probe result: ${String(result)}` };
  } catch (err) {
    const reason = errMessage(err);
    return isLockCapabilityError(err)
      ? { status: 'unsupported', reason }
      : { status: 'inconclusive', reason };
  }
}

// ─── Store Interface ──────────────────────────────────────────────────────────
interface IStore {
  get(id: string): Promise<SessionData | null>;
  set(id: string, data: SessionData): Promise<void>;
  del(id: string): Promise<void>;
  count(): Promise<number>;
  // ─── Locking primitives (M4-B1.3) ────────────────────────────────────────────
  acquireLock(lockKey: string, token: string, ttlMs: number): Promise<boolean>;
  releaseLock(lockKey: string, token: string): Promise<'deleted' | 'mismatch'>;
  commitIfLockOwned(
    lockKey: string,
    token: string,
    sessionId: string,
    packed: Uint8Array,
    ttlSec: number,
  ): Promise<boolean>;
  /** One-time-per-process EVAL capability probe. MemoryStore needs no Lua — trivially 'supported'. */
  probeLockCapability(): Promise<LockCapabilityProbeResult>;
}

// Narrow structural type — `ensureLockCapability()` only ever needs this one
// method, not the full IStore surface. Every IStore already satisfies it
// structurally (no separate implementation needed), and it lets tests supply
// a minimal fake probe result without implementing the entire store interface
// (still not a wire-protocol mock — this exercises the cache ORCHESTRATION
// logic in ensureLockCapability, not Redis/Upstash's actual EVAL behavior).
export interface LockCapabilityProbeSource {
  probeLockCapability(): Promise<LockCapabilityProbeResult>;
}

// ─── Upstash Redis Store ──────────────────────────────────────────────────────
class UpstashStore implements IStore {
  private redis: import('@upstash/redis').Redis;

  constructor(url: string, token: string) {
    // Dynamic import เพื่อไม่ต้อง import ตอน dev ที่ไม่มี Redis
    const { Redis } = require('@upstash/redis') as typeof import('@upstash/redis');
    this.redis = new Redis({ url, token });
  }

  async get(id: string): Promise<SessionData | null> {
    const raw = await this.redis.get<string>(this.key(id));
    if (!raw) return null;
    // base64 → Buffer → msgpackr unpack
    const buf = Buffer.from(raw, 'base64');
    return unpack(buf) as SessionData;
  }

  async set(id: string, data: SessionData): Promise<void> {
    // msgpackr pack → base64
    const packed = pack(data);
    const encoded = Buffer.from(packed).toString('base64');
    await this.redis.set(this.key(id), encoded, { ex: SESSION_TTL_SEC });
  }

  async del(id: string): Promise<void> {
    await this.redis.del(this.key(id));
  }

  async count(): Promise<number> {
    const keys = await this.redis.keys('nav:session:*');
    return keys.length;
  }

  async acquireLock(lockKey: string, token: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(lockKey, token, { nx: true, px: ttlMs });
    return result === 'OK';
  }

  async releaseLock(lockKey: string, token: string): Promise<'deleted' | 'mismatch'> {
    const result = await this.redis.eval(RELEASE_IF_LOCK_OWNED_SCRIPT, [lockKey], [token]);
    return Number(result) === 1 ? 'deleted' : 'mismatch';
  }

  async commitIfLockOwned(
    lockKey: string,
    token: string,
    sessionId: string,
    packed: Uint8Array,
    ttlSec: number,
  ): Promise<boolean> {
    const encoded = Buffer.from(packed).toString('base64');
    const result = await this.redis.eval(
      COMMIT_IF_LOCK_OWNED_SCRIPT,
      [lockKey, this.key(sessionId)],
      [token, encoded, String(ttlSec)],
    );
    return Number(result) === 1;
  }

  async probeLockCapability(): Promise<LockCapabilityProbeResult> {
    return runCapabilityProbe(() => this.redis.eval('return 1', [], []));
  }

  private key(id: string): string {
    return `nav:session:${id}`;
  }
}

// ─── ioredis Store (Railway Redis / standard Redis URL) ──────────────────────
class IoredisStore implements IStore {
  private client: import('ioredis').Redis;

  constructor(redisUrl: string) {
    const { default: Redis } = require('ioredis') as typeof import('ioredis');
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    this.client.on('error', (err: Error) => {
      log.error({ err: err.message }, 'ioredis error');
    });
  }

  async get(id: string): Promise<SessionData | null> {
    const buf = await this.client.getBuffer(this.key(id));
    if (!buf) return null;
    return unpack(buf) as SessionData;
  }

  async set(id: string, data: SessionData): Promise<void> {
    const packed = pack(data);
    await this.client.set(this.key(id), packed, 'EX', SESSION_TTL_SEC);
  }

  async del(id: string): Promise<void> {
    await this.client.del(this.key(id));
  }

  async count(): Promise<number> {
    const keys = await this.client.keys('nav:session:*');
    return keys.length;
  }

  async acquireLock(lockKey: string, token: string, ttlMs: number): Promise<boolean> {
    const result = await this.client.set(lockKey, token, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async releaseLock(lockKey: string, token: string): Promise<'deleted' | 'mismatch'> {
    const result = await this.client.eval(RELEASE_IF_LOCK_OWNED_SCRIPT, 1, lockKey, token);
    return Number(result) === 1 ? 'deleted' : 'mismatch';
  }

  async commitIfLockOwned(
    lockKey: string,
    token: string,
    sessionId: string,
    packed: Uint8Array,
    ttlSec: number,
  ): Promise<boolean> {
    // ioredis passes the packed buffer directly — no base64 conversion on this path.
    const result = await this.client.eval(
      COMMIT_IF_LOCK_OWNED_SCRIPT,
      2,
      lockKey,
      this.key(sessionId),
      token,
      Buffer.from(packed),
      String(ttlSec),
    );
    return Number(result) === 1;
  }

  async probeLockCapability(): Promise<LockCapabilityProbeResult> {
    return runCapabilityProbe(() => this.client.eval('return 1', 0));
  }

  private key(id: string): string {
    return `nav:session:${id}`;
  }
}

// ─── In-Memory Store (dev fallback) ───────────────────────────────────────────
class MemoryStore implements IStore {
  private store = new Map<string, { packed: Buffer; expiresAt: number }>();
  private locks = new Map<string, { token: string; expiresAt: number }>();
  private timer: ReturnType<typeof setInterval>;

  constructor() {
    this.timer = setInterval(() => this.cleanup(), 60_000);
    if (this.timer.unref) this.timer.unref();
  }

  async get(id: string): Promise<SessionData | null> {
    const entry = this.store.get(id);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(id);
      return null;
    }
    return unpack(entry.packed) as SessionData;
  }

  async set(id: string, data: SessionData): Promise<void> {
    const packed = Buffer.from(pack(data));
    this.store.set(id, { packed, expiresAt: Date.now() + SESSION_TTL_MS });
  }

  async del(id: string): Promise<void> {
    this.store.delete(id);
  }

  async count(): Promise<number> {
    this.cleanup();
    return this.store.size;
  }

  // All three methods below are plain synchronous Map operations with no
  // `await` between the check and the write — Node's single-threaded,
  // run-to-completion semantics make this genuinely atomic, not an
  // approximation (M4-B1.2.1 §5/§13).
  private isLockLive(entry: { token: string; expiresAt: number } | undefined, token?: string): boolean {
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) return false;
    if (token !== undefined && entry.token !== token) return false;
    return true;
  }

  async acquireLock(lockKey: string, token: string, ttlMs: number): Promise<boolean> {
    if (this.isLockLive(this.locks.get(lockKey))) return false;
    this.locks.set(lockKey, { token, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async releaseLock(lockKey: string, token: string): Promise<'deleted' | 'mismatch'> {
    const existing = this.locks.get(lockKey);
    if (existing && existing.token === token) {
      this.locks.delete(lockKey);
      return 'deleted';
    }
    return 'mismatch';
  }

  async commitIfLockOwned(
    lockKey: string,
    token: string,
    sessionId: string,
    packed: Uint8Array,
    ttlSec: number,
  ): Promise<boolean> {
    if (!this.isLockLive(this.locks.get(lockKey), token)) return false;
    this.store.set(sessionId, { packed: Buffer.from(packed), expiresAt: Date.now() + ttlSec * 1000 });
    return true;
  }

  async probeLockCapability(): Promise<LockCapabilityProbeResult> {
    return { status: 'supported' }; // no Lua needed — synchronous Map ops are already atomic
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (now > v.expiresAt) this.store.delete(k);
    }
    for (const [k, v] of this.locks) {
      if (now > v.expiresAt) this.locks.delete(k);
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
const globalAny: any = globalThis;

type LockBackendName = 'upstash' | 'ioredis' | 'memory';

function getStore(): IStore {
  if (globalAny.__navSessionStore) return globalAny.__navSessionStore;

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const redisUrl = process.env.REDIS_URL;

  if (upstashUrl && upstashToken) {
    log.info('Using Upstash Redis store');
    globalAny.__navSessionStore = new UpstashStore(upstashUrl, upstashToken);
    globalAny.__navSessionStoreBackend = 'upstash' as LockBackendName;
  } else if (redisUrl) {
    log.info({ redisUrl: redisUrl.replace(/\/\/.*@/, '//***@') }, 'Using ioredis store');
    globalAny.__navSessionStore = new IoredisStore(redisUrl);
    globalAny.__navSessionStoreBackend = 'ioredis' as LockBackendName;
  } else {
    log.info('Using in-memory store (dev)');
    globalAny.__navSessionStore = new MemoryStore();
    globalAny.__navSessionStoreBackend = 'memory' as LockBackendName;
  }
  return globalAny.__navSessionStore;
}

function getStoreBackendName(): LockBackendName {
  getStore(); // ensure initialized
  return globalAny.__navSessionStoreBackend as LockBackendName;
}

// ─── Session Lock capability cache state machine (M4-B1.3, corrected M4-B1.5) ─
// Per-process cache — a process restart naturally re-probes (module state is
// fresh), satisfying "process restart re-probes" without persisting anywhere.
//
// M4-B1.4 §5/§6 proved the ORIGINAL {checked,available} shape was defective:
// ANY probe failure (including a one-off transient network blip) permanently
// cached `available:false` for the rest of the process's life, with no way to
// recover short of a full restart. The three-state machine below fixes this:
// only an EXPLICIT capability rejection is ever cached as permanent —
// 'inconclusive' probe failures leave the cache 'unchecked' so a LATER request
// gets to try again (M4-B1.5 Required Implementation 2/10).
export type LockCapabilityCache =
  | { state: 'unchecked' }
  | { state: 'supported' }
  | { state: 'unsupported'; reason: string };

let lockCapabilityCache: LockCapabilityCache = { state: 'unchecked' };

// Throttles the "still cached unsupported" log so a permanently-broken
// deployment doesn't flood logs on every ~2s poll tick, while still remaining
// observable (not silent forever after the first detection) — M4-B1.5
// Required Implementation 9.
const CACHED_UNSUPPORTED_LOG_THROTTLE_MS = 60_000;
let lastUnsupportedLogAt = 0;

export type LockCapabilityCheck =
  | { ok: true }
  | { ok: false; reason: 'capability_unavailable' }
  | { ok: false; reason: 'backend_unavailable' };

async function ensureLockCapability(
  store: LockCapabilityProbeSource,
  backend: LockBackendName,
): Promise<LockCapabilityCheck> {
  if (backend === 'memory') return { ok: true }; // no Lua needed at all

  if (lockCapabilityCache.state === 'supported') return { ok: true };

  if (lockCapabilityCache.state === 'unsupported') {
    // Cached permanent failure — remain observable without flooding logs.
    const now = Date.now();
    if (now - lastUnsupportedLogAt >= CACHED_UNSUPPORTED_LOG_THROTTLE_MS) {
      lastUnsupportedLogAt = now;
      log.error(
        { backend, reason: lockCapabilityCache.reason },
        'SESSION_LOCK_CAPABILITY_UNAVAILABLE',
      );
    }
    return { ok: false, reason: 'capability_unavailable' };
  }

  // state === 'unchecked' — probe now. A later request gets exactly this same
  // fresh attempt again if this one is inconclusive (no same-request retry
  // loop here — M4-B1.5 Required Implementation 2/10).
  const result = await store.probeLockCapability();

  if (result.status === 'supported') {
    lockCapabilityCache = { state: 'supported' };
    log.info({ backend, evalSupported: true }, 'SESSION_LOCK_CAPABILITY_PROBE_RESULT');
    return { ok: true };
  }

  if (result.status === 'unsupported') {
    lockCapabilityCache = { state: 'unsupported', reason: result.reason };
    lastUnsupportedLogAt = Date.now();
    log.info({ backend, evalSupported: false, reason: result.reason }, 'SESSION_LOCK_CAPABILITY_PROBE_RESULT');
    log.error({ backend, reason: result.reason }, 'SESSION_LOCK_CAPABILITY_UNAVAILABLE');
    return { ok: false, reason: 'capability_unavailable' };
  }

  // 'inconclusive' — do NOT cache. Fail only the current request/attempt
  // closed; the cache stays 'unchecked' so the very next request re-probes.
  log.warn({ backend, reason: result.reason }, 'SESSION_LOCK_CAPABILITY_PROBE_INCONCLUSIVE');
  return { ok: false, reason: 'backend_unavailable' };
}

// Tracks acquire time per outstanding token — observability only (heldMs in
// logs), never consulted for correctness. Entries are removed on release;
// a crashed request leaves a small, harmless, bounded stale entry.
const lockAcquiredAtByToken = new Map<string, number>();

// ─── Public API ───────────────────────────────────────────────────────────────
export function generateSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `nav_${ts}_${rand}`;
}

export async function loadSession(sessionId: string): Promise<SessionData> {
  const data = await getStore().get(sessionId);
  if (!data) throw new SessionNotFoundError(sessionId);
  return data;
}

export async function saveSession(data: SessionData): Promise<void> {
  data.updatedAt = Date.now();
  await getStore().set(data.sessionId, data);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await getStore().del(sessionId);
}

export async function getActiveSessionCount(): Promise<number> {
  return getStore().count();
}

// ─── Session Lock Public API (M4-B1.3) ────────────────────────────────────────
// See file-edit/2026-07-06-M4-B1.1/.2/.2.1 for the audit trail this implements.
// Deliberately does NOT export an `assertHoldingLock()`-style check-then-write
// helper — that composition was proven unsafe (M4-B1.2.1 §2). All writes must
// go through `commitSessionIfLockOwned()`, which performs the token check and
// the session write as a single atomic datastore operation.

// M4-B1.5 Required Implementation 5: acquire outcomes are no longer collapsed
// to `string | null` — busy / capability_unavailable / backend_unavailable
// are distinct reasons with distinct causes and distinct operator responses.
export type AcquireSessionLockResult =
  | { acquired: true; token: string }
  | { acquired: false; reason: 'busy' }
  | { acquired: false; reason: 'capability_unavailable' }
  | { acquired: false; reason: 'backend_unavailable' };

/**
 * Acquires the per-session write lock. Fails closed on every non-acquired
 * outcome — never falls back to an unlocked write, regardless of reason.
 */
export async function acquireSessionLock(sessionId: string): Promise<AcquireSessionLockResult> {
  const store = getStore();
  const backend = getStoreBackendName();

  const capability = await ensureLockCapability(store, backend);
  if (!capability.ok) {
    // Detailed cause already logged inside ensureLockCapability.
    return { acquired: false, reason: capability.reason };
  }

  const token = randomUUID();
  const ttlMs = getLockTtlMs();
  const lockKey = lockKeyFor(sessionId);
  const t0 = Date.now();

  let acquired = false;
  try {
    for (let attempt = 0; attempt <= LOCK_ACQUIRE_MAX_RETRIES; attempt++) {
      acquired = await store.acquireLock(lockKey, token, ttlMs);
      if (acquired) break;
      if (attempt < LOCK_ACQUIRE_MAX_RETRIES) await sleep(LOCK_ACQUIRE_RETRY_DELAY_MS);
    }
  } catch (err) {
    // The SET NX PX call itself threw — this is a live infrastructure/
    // connectivity failure (SET NX is a basic native command supported by
    // every Redis-compatible backend; a throw here is never a capability
    // issue, always a connectivity one). Fails closed immediately rather than
    // exhausting the busy-retry loop against a likely-still-broken connection.
    log.warn(
      { sessionId, err: errMessage(err) },
      'SESSION_LOCK_BACKEND_UNAVAILABLE',
    );
    return { acquired: false, reason: 'backend_unavailable' };
  }

  const waitMs = Date.now() - t0;
  if (!acquired) {
    log.warn({ sessionId, waitMs, retryCount: LOCK_ACQUIRE_MAX_RETRIES }, 'SESSION_LOCK_BUSY');
    return { acquired: false, reason: 'busy' };
  }

  lockAcquiredAtByToken.set(token, Date.now());
  log.info({ sessionId, waitMs }, 'SESSION_LOCK_ACQUIRED');
  return { acquired: true, token };
}

/**
 * Atomically verifies `lockToken` still owns the session's lock and, only if
 * so, writes `data` in the same indivisible datastore operation. Never a
 * separate check-then-write — see M4-B1.2.1 §2/§3/§13 for why that is unsafe.
 *
 * On ambiguous failure (network/transient error — the server may or may not
 * have actually committed before the error surfaced), retries at most once
 * with the identical token and identical already-serialized payload, then
 * fails closed. A rejected retry proves only that the token is not currently
 * owned at retry time — it does NOT prove the first attempt never committed;
 * this is logged distinctly (`SESSION_LOCK_COMMIT_OUTCOME_AMBIGUOUS`), never
 * silently treated as a clean success or a clean failure.
 */
// M4-B1.5 Required Implementation 6: `lock_lost` no longer absorbs every
// failure reason. `capability_unavailable` and `ambiguous` are genuinely
// different situations with different operator implications, and must not be
// reported as an ordinary (expected, routine) lock-lost outcome.
//
// `backend_unavailable` is deliberately NOT reachable from the commit attempt
// itself — a thrown error from the actual atomic commit call can never prove
// non-execution (that is exactly what makes it 'ambiguous' instead), so
// 'backend_unavailable' for this function is scoped to the one place where
// non-execution IS provable: the pre-flight capability check, which runs
// strictly before any commit attempt is made.
export type CommitSessionResult =
  | { committed: true }
  | { committed: false; reason: 'lock_lost' }
  | { committed: false; reason: 'capability_unavailable' }
  | { committed: false; reason: 'backend_unavailable' }
  | { committed: false; reason: 'ambiguous' };

export async function commitSessionIfLockOwned(
  sessionId: string,
  lockToken: string,
  data: SessionData,
): Promise<CommitSessionResult> {
  const store = getStore();
  const backend = getStoreBackendName();

  const capability = await ensureLockCapability(store, backend);
  if (!capability.ok) {
    // No commit attempt was made at all — provably not committed.
    return { committed: false, reason: capability.reason };
  }

  data.updatedAt = Date.now();
  const packed = pack(data); // computed ONCE — reused byte-for-byte on the one allowed retry (M4-B1.2.1 §6/§7, unchanged)
  const lockKey = lockKeyFor(sessionId);
  const acquiredAt = lockAcquiredAtByToken.get(lockToken);
  const heldMs = () => (acquiredAt !== undefined ? Date.now() - acquiredAt : null);

  let lastErr: unknown = null;

  for (let attemptCount = 1; attemptCount <= 2; attemptCount++) {
    try {
      const committed = await store.commitIfLockOwned(lockKey, lockToken, sessionId, packed, SESSION_TTL_SEC);

      if (attemptCount > 1) {
        // The first attempt's true outcome is unknown (it threw before we
        // could observe its result) — THIS attempt's result is a clean,
        // definitive read of current ground truth, so it is authoritative for
        // the return value — but we must not claim to know whether the first
        // attempt silently committed first. Log both facts distinctly.
        log.warn(
          { sessionId, attemptCount, backend, heldMs: heldMs() },
          'SESSION_LOCK_COMMIT_OUTCOME_AMBIGUOUS',
        );
      }

      if (!committed) {
        log.warn({ sessionId, backend, heldMs: heldMs() }, 'SESSION_LOCK_FENCED_WRITE_REJECTED');
      }

      // A clean (non-throwing) result — true or false — is always definitive,
      // never 'ambiguous': the atomic script actually ran and told us the
      // real, current answer, whether this is attempt 1 or the one retry.
      return committed ? { committed: true } : { committed: false, reason: 'lock_lost' };
    } catch (err) {
      lastErr = err;

      if (isLockCapabilityError(err)) {
        lockCapabilityCache = { state: 'unsupported', reason: errMessage(err) };
        lastUnsupportedLogAt = Date.now();
        log.error(
          { sessionId, backend, err: errMessage(err) },
          'SESSION_LOCK_CAPABILITY_LOST_AT_RUNTIME',
        );
        return { committed: false, reason: 'capability_unavailable' }; // fail closed — never retry a capability error
      }

      if (attemptCount === 1) {
        log.warn(
          { sessionId, backend, err: errMessage(err) },
          'SESSION_LOCK_COMMIT_RETRY',
        );
        continue; // the one allowed retry (M4-B1.3 Required Implementation 8, unchanged)
      }
    }
  }

  // Both attempts threw (non-capability errors) — genuinely ambiguous, no
  // confirmed outcome either way. Fail closed; never report false success,
  // and never collapse this into ordinary 'lock_lost' (M4-B1.5 Required
  // Implementation 6's critical rule).
  log.error(
    { sessionId, attemptCount: 2, backend, heldMs: heldMs(), err: errMessage(lastErr) },
    'SESSION_LOCK_COMMIT_OUTCOME_AMBIGUOUS',
  );
  return { committed: false, reason: 'ambiguous' };
}

/**
 * Releases the session lock via an atomic compare-and-delete (Lua on real
 * Redis backends, synchronous compare on MemoryStore) — never a plain DEL,
 * never a separate GET-then-DEL (M4-B1.2.1 §8). A mismatch (lock already
 * reassigned) is expected and non-fatal, not an error.
 */
export async function releaseSessionLock(sessionId: string, lockToken: string): Promise<void> {
  const acquiredAt = lockAcquiredAtByToken.get(lockToken);
  const heldMs = acquiredAt !== undefined ? Date.now() - acquiredAt : null;
  lockAcquiredAtByToken.delete(lockToken);

  try {
    const store = getStore();
    const lockKey = lockKeyFor(sessionId);
    const result = await store.releaseLock(lockKey, lockToken);
    if (result === 'deleted') {
      log.info({ sessionId, heldMs }, 'SESSION_LOCK_RELEASED');
    } else {
      log.info({ sessionId, heldMs }, 'SESSION_LOCK_RELEASE_SKIPPED_TOKEN_MISMATCH');
    }
  } catch (err) {
    // Best-effort cleanup only — the lock's own TTL guarantees eventual
    // release regardless. Do not throw out of a `finally` release path.
    log.warn({ sessionId, err: err instanceof Error ? err.message : String(err) }, 'SESSION_LOCK_RELEASE_FAILED');
  }
}

// ─── Test-only exports (M4-B1.5) ───────────────────────────────────────────────
// These exist solely so scripts/verify-session-lock.ts can exercise the
// capability-cache STATE-MACHINE ORCHESTRATION logic (ensureLockCapability)
// and the ERROR-MESSAGE CLASSIFIER (isLockCapabilityError) directly, with a
// synthetic probe result / synthetic Error object. This is NOT a Redis
// wire-protocol mock — MemoryStore's real probe is always 'supported' and
// cannot exercise 'unsupported'/'inconclusive' at all, so there is no way to
// validate the cache state machine's transitions without either a real
// capability-rejecting Redis instance (unavailable in this environment,
// M4-B1.2.1 §4/§14) or this narrow, honest seam into the same production
// logic every real request path uses. None of these exports change any
// acquire/commit/release behavior; they add zero new runtime code paths.
export const __testOnly = {
  ensureLockCapability,
  isLockCapabilityError,
  resetLockCapabilityCache(): void {
    lockCapabilityCache = { state: 'unchecked' };
    lastUnsupportedLogAt = 0;
  },
  getLockCapabilityCacheState(): LockCapabilityCache {
    return lockCapabilityCache;
  },
};
