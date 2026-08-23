// ─────────────────────────────────────────────────────────────────────────────
// PR2a-1C-C2 — Non-Mutating Presentation Transaction Attempt Skeleton
// (UNREACHABLE, Option B)
//
// This module decides whether a FUTURE presentation transaction would be
// eligible to begin, walks only the runtime FSM states it truthfully performs,
// and returns result data. It performs NO mutation of any kind.
//
// Option B (approved after independent review): real strict-trim invocation is
// DEFERRED TO C3. This module therefore has:
//   - no dependency parameter at all (nothing mutation-capable can be injected)
//   - no value import of the C1 helper (type-only, for the pure translator)
//   - no Mapbox adapter, no React, no DOM, no refs, no scheduler
//   - no legacy fallback call, no frontend ownership commit, no route publish
//
// Because no staging can occur here, an "orphaned stage" (trim written with no
// committer) is structurally impossible in C2 — that risk arrives only with C3,
// which adds source basis and ownership commit together.
//
// Unreachable in PR2a-1C-C2: nothing under app/, components/, or lib/ imports,
// re-exports, or calls this module. Its only consumers are the focused test and
// verifier scripts.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeTrimPaintValue } from './trimTransactionModel.ts';
import { transitionPresentationTransactionRuntimeState } from './transactionRuntimeModel.ts';
import type {
    PresentationTransactionGateSnapshot,
    PresentationTransactionRuntimeState,
} from './transactionRuntimeModel.ts';
// Type-only: never a value import. The C1 runtime helper is NOT reachable from
// this module — only the shape of its status enum is referenced, so the pure
// translator below can be written and tested ahead of C3.
import type { StrictTrimMutationStatus } from './trimTransactionRuntime.ts';

// ── Runtime types ────────────────────────────────────────────────────────────

export type PresentationTransactionAttemptStatus =
    | 'NOT_ENTERED'             // gate closed — never entered
    | 'HELD'                    // generation or intended-trim validation failed
    | 'READY_FOR_FUTURE_STAGE'; // all preconditions passed; NOTHING was executed

export interface PresentationTransactionAttemptInput {
    generation: number;
    gateSnapshot: PresentationTransactionGateSnapshot;
    intendedTrim: unknown;
    // Deliberately no layer IDs, no geometry, no reason string, and no
    // dependency object — see the Option B notes above.
}

export interface PresentationTransactionAttemptResult {
    generation: number;
    entered: boolean;
    gateOpen: boolean;
    initialState: PresentationTransactionRuntimeState;
    finalState: PresentationTransactionRuntimeState;
    /** Fresh copy on every result; callers cannot mutate internal state. */
    stateHistory: PresentationTransactionRuntimeState[];
    /** Authoritative. Every other field is audit evidence and must agree. */
    finalStatus: PresentationTransactionAttemptStatus;
    /**
     * Advice to a FUTURE caller — never an action performed here. Always true
     * in C2 because no mutation ever occurs, so presentation state is untouched.
     */
    legacyFallbackSafe: true;
    /** Literal false: committing frontend ownership is impossible in C2. */
    frontendCommitAllowed: false;
    /** Literal false: no trim staging is executed in C2. */
    stagingExecuted: false;
    failureReason: string | null;
}

// ── Pure C1 status translation (NOT called by the runtime below) ──────────────

export type StrictTrimAdvisoryStatus =
    | 'NO_MUTATION'
    | 'STAGE_PRESENT'
    | 'RESTORED'
    | 'UNCERTAIN';

export interface StrictTrimAdvisory {
    translatedStatus: StrictTrimAdvisoryStatus;
    legacyFallbackSafe: boolean;
    /** Always true in C2: no C2 outcome ever permits a frontend commit. */
    futureCommitBlocked: boolean;
    uncertainPaintState: boolean;
    reason: string;
}

/**
 * Map a C1-shaped status into advisory metadata for a FUTURE caller (C3).
 *
 * Pure: performs no mutation, no FSM transition, and no runtime call. It exists
 * so the mapping logic can be written and exhaustively tested now, before C3
 * gains the ability to actually produce such a status.
 *
 * Conservative by construction: an unrecognized status maps to UNCERTAIN rather
 * than being treated as safe.
 */
export function translateStrictTrimResultToAdvisory(
    status: StrictTrimMutationStatus,
): StrictTrimAdvisory {
    switch (status) {
        case 'NOT_ENTERED':
            return {
                translatedStatus: 'NO_MUTATION',
                legacyFallbackSafe: true,
                futureCommitBlocked: true,
                uncertainPaintState: false,
                reason: 'adapter_capability_unavailable_no_mutation',
            };
        case 'HELD':
            return {
                translatedStatus: 'NO_MUTATION',
                legacyFallbackSafe: true,
                futureCommitBlocked: true,
                uncertainPaintState: false,
                reason: 'precondition_hold_no_mutation',
            };
        case 'STAGED_VERIFIED':
            return {
                translatedStatus: 'STAGE_PRESENT',
                // Trim is written and verified but nothing has committed
                // ownership, so publishing through legacy on top of it would
                // pair new paint with old geometry.
                legacyFallbackSafe: false,
                futureCommitBlocked: true,
                uncertainPaintState: false,
                reason: 'trim_staged_without_owner',
            };
        case 'ROLLED_BACK':
            return {
                translatedStatus: 'RESTORED',
                legacyFallbackSafe: true,
                futureCommitBlocked: true,
                uncertainPaintState: false,
                reason: 'stage_failed_but_fully_restored',
            };
        case 'ROLLBACK_FAILED':
            return {
                translatedStatus: 'UNCERTAIN',
                legacyFallbackSafe: false,
                futureCommitBlocked: true,
                uncertainPaintState: true,
                reason: 'rollback_failed_paint_state_uncertain',
            };
        default: {
            // Exhaustiveness guard: adding a C1 status without handling it here
            // becomes a compile error rather than a silent fallthrough.
            const exhaustive: never = status;
            void exhaustive;
            return {
                translatedStatus: 'UNCERTAIN',
                legacyFallbackSafe: false,
                futureCommitBlocked: true,
                uncertainPaintState: true,
                reason: 'unrecognized_trim_status_conservative_uncertain',
            };
        }
    }
}

// ── Runtime entry evaluation ─────────────────────────────────────────────────

interface AttemptResultDraft {
    generation: number;
    entered: boolean;
    gateOpen: boolean;
    finalState: PresentationTransactionRuntimeState;
    stateHistory: PresentationTransactionRuntimeState[];
    finalStatus: PresentationTransactionAttemptStatus;
    failureReason: string | null;
}

function buildResult(draft: AttemptResultDraft): PresentationTransactionAttemptResult {
    return {
        generation: draft.generation,
        entered: draft.entered,
        gateOpen: draft.gateOpen,
        initialState: 'IDLE',
        finalState: draft.finalState,
        stateHistory: [...draft.stateHistory],
        finalStatus: draft.finalStatus,
        legacyFallbackSafe: true,
        frontendCommitAllowed: false,
        stagingExecuted: false,
        failureReason: draft.failureReason,
    };
}

/**
 * Evaluate whether a FUTURE presentation transaction would be eligible to
 * begin. Returns result data only — it never throws, never mutates anything,
 * and never calls production code.
 *
 * `READY_FOR_FUTURE_STAGE` records that the gate was open, the generation
 * matched, and the intended trim was structurally valid at evaluation time.
 * It is NOT permission to stage, mutate, publish, or commit.
 */
export function evaluatePresentationTransactionAttempt(
    input: PresentationTransactionAttemptInput,
): PresentationTransactionAttemptResult {
    const stateHistory: PresentationTransactionRuntimeState[] = ['IDLE'];
    let state: PresentationTransactionRuntimeState = 'IDLE';

    // Advance through the FSM using the real transition helper. A rejected
    // transition leaves the state unchanged, which the invariants below and the
    // focused tests both assert against.
    const advance = (to: PresentationTransactionRuntimeState): boolean => {
        const transition = transitionPresentationTransactionRuntimeState(state, to);
        if (!transition.allowed) return false;
        state = transition.state;
        stateHistory.push(state);
        return true;
    };

    // Defensive: a malformed input must hold rather than throw outward.
    const gateSnapshot = input === null || typeof input !== 'object'
        ? null
        : (input.gateSnapshot as PresentationTransactionGateSnapshot | undefined | null) ?? null;
    const generation = typeof input?.generation === 'number' ? input.generation : Number.NaN;

    if (gateSnapshot === null || typeof gateSnapshot !== 'object'
        || typeof gateSnapshot.gateOpen !== 'boolean') {
        return buildResult({
            generation,
            entered: false,
            gateOpen: false,
            finalState: state,
            stateHistory,
            finalStatus: 'NOT_ENTERED',
            failureReason: 'gate_snapshot_missing_or_malformed',
        });
    }

    // ── Gate closed: no transition at all, C2 never entered ──────────────────
    if (!gateSnapshot.gateOpen) {
        return buildResult({
            generation,
            entered: false,
            gateOpen: false,
            finalState: state,
            stateHistory,
            finalStatus: 'NOT_ENTERED',
            failureReason: gateSnapshot.disabledReason ?? 'gate_closed',
        });
    }

    // ── PREPARING: generation consistency ────────────────────────────────────
    advance('PREPARING');

    if (!Number.isFinite(generation) || generation !== gateSnapshot.generation) {
        advance('HELD');
        return buildResult({
            generation,
            entered: true,
            gateOpen: true,
            finalState: state,
            stateHistory,
            finalStatus: 'HELD',
            failureReason: 'generation_mismatch',
        });
    }

    // ── VALIDATING: intended trim validity, via the pure normalizer ──────────
    // Reusing the shared normalizer (rather than a presence check) keeps this
    // decision identical to the one C1/C3 will make, so READY_FOR_FUTURE_STAGE
    // cannot claim eligibility that a later phase would reject. `[0, 0]` stays
    // valid; no clamping and no new threshold are introduced here.
    advance('VALIDATING');

    const normalizedIntendedTrim = normalizeTrimPaintValue(input.intendedTrim);
    if (!normalizedIntendedTrim.valid) {
        advance('HELD');
        return buildResult({
            generation,
            entered: true,
            gateOpen: true,
            finalState: state,
            stateHistory,
            finalStatus: 'HELD',
            failureReason: `intended_trim_invalid:${normalizedIntendedTrim.shape}`,
        });
    }

    // ── Eligible: stop here. No snapshot, no staging, no C1, no commit. ──────
    return buildResult({
        generation,
        entered: true,
        gateOpen: true,
        finalState: state,
        stateHistory,
        finalStatus: 'READY_FOR_FUTURE_STAGE',
        failureReason: null,
    });
}
