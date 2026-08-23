// ─────────────────────────────────────────────────────────────────────────────
// PR2a-1C-C3 — Unreachable Source-Basis, Trim-Stage, and Frontend-Commit
// Integration (UNREACHABLE)
//
// This module composes C2 (non-mutating entry evaluation), C1 (strict trim
// mutation/rollback), and an injected frontend-ownership commit into a single
// orchestrator. It is deliberately UNREACHABLE from every production
// navigation path: nothing under app/, components/, or lib/ imports,
// re-exports, or calls it. Its only consumers are the focused test and
// verifier scripts. Wiring it into production is C4 work.
//
// Mutation-capable dependencies (C1 stage/restore, frontend-ownership commit)
// and the live-ownership read are all INJECTED — this module never value-
// imports the C1 runtime, never touches a Mapbox object, a React ref, or a
// React setter directly, and never calls applySourcePathLegacy, the B2
// wrapper, or any scheduler/Camera/observation API.
//
// Every dependency call is wrapped so a throw or a malformed result can never
// escape or be silently trusted — this orchestrator never throws.
//
// finalState means the last truthful FSM state actually reached, which may be
// nonterminal (a resting state, not a walk that failed to finish).
// finalStatus is the authoritative business outcome; every other field is
// evidence that must agree with it.
// ─────────────────────────────────────────────────────────────────────────────

import { evaluatePresentationTransactionAttempt, translateStrictTrimResultToAdvisory } from './presentationTransactionAttempt.ts';
import type { PresentationTransactionAttemptResult, StrictTrimAdvisory } from './presentationTransactionAttempt.ts';
import { transitionPresentationTransactionRuntimeState } from './transactionRuntimeModel.ts';
import type { PresentationTransactionGateSnapshot, PresentationTransactionRuntimeState } from './transactionRuntimeModel.ts';
import { normalizeTrimPaintValue, compareTrimPaintValues } from './trimTransactionModel.ts';
// Type-only: the C1 runtime helper is never value-imported here — it is
// received exclusively as an injected dependency (see below). Only its data
// shapes are referenced, exactly like C2's own type-only C1 reference.
import type { StrictTrimMutationInput, StrictTrimMutationResult } from './trimTransactionRuntime.ts';

// ── Data-only integration input (Phase C) ────────────────────────────────────

export interface CandidatePathPoint {
    lat: number;
    lng: number;
}

export interface PresentationTransactionIntegrationInput {
    generation: number;
    gateSnapshot: PresentationTransactionGateSnapshot;
    routeSourceKey: number;
    routeVersion: number;
    sourceSignature: string;
    bodySignature: string;
    candidatePath: ReadonlyArray<CandidatePathPoint>;
    intendedTrim: unknown;
}

// ── Source basis (Phase D) — no preparedAt, no trim snapshot, no adapter ────

export interface SourceBasisSnapshot {
    generation: number;
    routeSourceKey: number;
    routeVersion: number;
    sourceSignature: string;
    bodySignature: string;
    candidatePathSnapshot: ReadonlyArray<CandidatePathPoint>;
    intendedTrim: number[];
}

// ── Injected dependencies (Phase B, G, J) ────────────────────────────────────

/** Plain live-ownership data only — never a ref, never a Mapbox object. */
export interface CurrentSourceOwnershipSnapshot {
    generation: number;
    routeSourceKey: number;
    routeVersion: number;
    sourceSignature: string;
    bodySignature: string;
}

export type ReadCurrentSourceOwnershipDependency = () => CurrentSourceOwnershipSnapshot;

/** Synchronous C1 dependency. Also reused, with a different intendedTrim, as the restore primitive (Phase J/K). */
export type StageStrictTrimMutationDependency = (
    input: StrictTrimMutationInput,
) => StrictTrimMutationResult;

export interface CommitFrontendOwnershipInput {
    generation: number;
    routeVersion: number;
    routeSourceKey: number;
    sourceSignature: string;
    bodySignature: string;
    candidatePath: ReadonlyArray<CandidatePathPoint>;
    stagedTrim: number[];
}

export interface CommitFrontendOwnershipResult {
    committed: boolean;
    /** Advisory only — never used by this module to decide safety. */
    refsWritten: readonly string[];
    /** Advisory only — never used by this module to decide safety. */
    failedWrites: readonly string[];
    failureReason: string | null;
}

export type CommitFrontendOwnershipDependency = (
    input: CommitFrontendOwnershipInput,
) => CommitFrontendOwnershipResult;

export interface PresentationTransactionIntegrationDependencies {
    readCurrentSourceOwnership: ReadCurrentSourceOwnershipDependency;
    stageStrictTrimMutation: StageStrictTrimMutationDependency;
    commitFrontendOwnership: CommitFrontendOwnershipDependency;
}

// ── Result model (Phase M) ───────────────────────────────────────────────────

export type PresentationTransactionIntegrationStatus =
    | 'NOT_ENTERED'
    | 'HELD'
    | 'TRIM_HELD'
    | 'TRIM_ROLLED_BACK'
    | 'COMMITTED'
    | 'FAILED_UNCERTAIN';

export interface PresentationTransactionIntegrationResult {
    generation: number;
    entered: boolean;
    initialState: PresentationTransactionRuntimeState;
    /** Last truthful FSM state actually reached — may be nonterminal. */
    finalState: PresentationTransactionRuntimeState;
    stateHistory: PresentationTransactionRuntimeState[];
    entryResult: PresentationTransactionAttemptResult | null;
    basisPrepared: boolean;
    basisVerified: boolean;
    stagingExecuted: boolean;
    trimResult: StrictTrimMutationResult | null;
    trimAdvisory: StrictTrimAdvisory | null;
    postStageVerified: boolean;
    commitExecuted: boolean;
    commitResult: CommitFrontendOwnershipResult | null;
    ownershipCommitted: boolean;
    commitFailed: boolean;
    trimRestoreAttempted: boolean;
    trimRestoreResult: StrictTrimMutationResult | null;
    trimRestoredToPreTransaction: boolean;
    /** Authoritative. Every other field is audit evidence and must agree with it. */
    finalStatus: PresentationTransactionIntegrationStatus;
    legacyFallbackSafe: boolean;
    uncertainPresentationState: boolean;
    failureReason: string | null;
    rollbackFailureReason: string | null;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Sanitize any thrown value into a safe string. Never stores an Error object. */
function describeThrown(prefix: string, err: unknown): string {
    let detail = 'unknown';
    if (typeof err === 'string') {
        detail = err;
    } else if (err !== null && typeof err === 'object') {
        const maybeMessage = (err as { message?: unknown }).message;
        detail = typeof maybeMessage === 'string' ? maybeMessage : 'non_string_error';
    } else if (typeof err === 'number' || typeof err === 'boolean') {
        detail = String(err);
    }
    return `${prefix}:${detail.slice(0, 120)}`;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function validateCandidatePath(
    raw: ReadonlyArray<CandidatePathPoint>,
): { valid: true; snapshot: CandidatePathPoint[] } | { valid: false; snapshot: null } {
    if (!Array.isArray(raw) || raw.length < 2) return { valid: false, snapshot: null };
    const snapshot: CandidatePathPoint[] = [];
    for (const point of raw) {
        if (point === null || typeof point !== 'object') return { valid: false, snapshot: null };
        const lat = (point as { lat?: unknown }).lat;
        const lng = (point as { lng?: unknown }).lng;
        if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return { valid: false, snapshot: null };
        // Fresh object per point — never the caller's point instance.
        snapshot.push({ lat, lng });
    }
    return { valid: true, snapshot };
}

function describeBasisInvalidity(checks: {
    routeSourceKeyValid: boolean;
    routeVersionValid: boolean;
    sourceSignatureValid: boolean;
    bodySignatureValid: boolean;
    pathValid: boolean;
    intendedTrimValid: boolean;
}): string {
    if (!checks.routeSourceKeyValid) return 'route_source_key_invalid_or_non_numeric';
    if (!checks.routeVersionValid) return 'route_version_invalid_or_non_numeric';
    if (!checks.sourceSignatureValid) return 'source_signature_invalid';
    if (!checks.bodySignatureValid) return 'body_signature_invalid';
    if (!checks.pathValid) return 'candidate_path_invalid';
    return checks.intendedTrimValid ? 'source_basis_invalid' : 'intended_trim_invalid';
}

function identityFieldsEqual(
    basis: SourceBasisSnapshot,
    current: CurrentSourceOwnershipSnapshot,
): boolean {
    return basis.generation === current.generation
        && basis.routeSourceKey === current.routeSourceKey
        && basis.routeVersion === current.routeVersion
        && basis.sourceSignature === current.sourceSignature
        && basis.bodySignature === current.bodySignature;
}

function isFiniteNumberPair(value: number[] | null): value is number[] {
    return Array.isArray(value) && value.length === 2
        && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

/**
 * The ONLY valid source of a pre-transaction trim value: the first successful
 * C1 STAGED_VERIFIED result. C3 has no trim-read dependency of its own.
 */
function extractPreTransactionTrimValue(
    trimResult: StrictTrimMutationResult,
): { ok: true; value: number[] } | { ok: false; reason: string } {
    if (trimResult.snapshotComplete !== true) return { ok: false, reason: 'snapshot_incomplete' };
    const route = trimResult.routeSnapshot;
    const casing = trimResult.casingSnapshot;
    if (route === null || casing === null) return { ok: false, reason: 'snapshot_missing' };
    if (!route.exists || !route.readable || !casing.exists || !casing.readable) {
        return { ok: false, reason: 'snapshot_unreadable' };
    }
    if (!isFiniteNumberPair(route.normalizedValue) || !isFiniteNumberPair(casing.normalizedValue)) {
        return { ok: false, reason: 'snapshot_value_malformed' };
    }
    const comparison = compareTrimPaintValues(route.normalizedValue, casing.normalizedValue);
    if (!comparison.bothValid || !comparison.structurallyEqual) {
        return { ok: false, reason: 'snapshot_values_unequal' };
    }
    return { ok: true, value: [route.normalizedValue[0], route.normalizedValue[1]] };
}

function isValidTrimMutationResultShape(value: unknown): value is StrictTrimMutationResult {
    return value !== null && typeof value === 'object'
        && typeof (value as { finalStatus?: unknown }).finalStatus === 'string';
}

function normalizeCommitResult(value: unknown): CommitFrontendOwnershipResult | null {
    if (value === null || typeof value !== 'object') return null;
    const r = value as Partial<CommitFrontendOwnershipResult>;
    return {
        committed: r.committed === true,
        refsWritten: Array.isArray(r.refsWritten) ? [...r.refsWritten] : [],
        failedWrites: Array.isArray(r.failedWrites) ? [...r.failedWrites] : [],
        failureReason: typeof r.failureReason === 'string' ? r.failureReason : null,
    };
}

interface ResultDraft {
    generation: number;
    entered: boolean;
    finalState: PresentationTransactionRuntimeState;
    stateHistory: PresentationTransactionRuntimeState[];
    entryResult: PresentationTransactionAttemptResult | null;
    basisPrepared?: boolean;
    basisVerified?: boolean;
    stagingExecuted?: boolean;
    trimResult?: StrictTrimMutationResult | null;
    trimAdvisory?: StrictTrimAdvisory | null;
    postStageVerified?: boolean;
    commitExecuted?: boolean;
    commitResult?: CommitFrontendOwnershipResult | null;
    ownershipCommitted?: boolean;
    commitFailed?: boolean;
    trimRestoreAttempted?: boolean;
    trimRestoreResult?: StrictTrimMutationResult | null;
    trimRestoredToPreTransaction?: boolean;
    finalStatus: PresentationTransactionIntegrationStatus;
    legacyFallbackSafe: boolean;
    uncertainPresentationState?: boolean;
    failureReason: string | null;
    rollbackFailureReason?: string | null;
}

function buildResult(draft: ResultDraft): PresentationTransactionIntegrationResult {
    const commitExecuted = draft.commitExecuted ?? false;
    const ownershipCommitted = draft.finalStatus === 'COMMITTED';
    return {
        generation: draft.generation,
        entered: draft.entered,
        initialState: 'IDLE',
        finalState: draft.finalState,
        stateHistory: [...draft.stateHistory],
        entryResult: draft.entryResult,
        basisPrepared: draft.basisPrepared ?? false,
        basisVerified: draft.basisVerified ?? false,
        stagingExecuted: draft.stagingExecuted ?? false,
        trimResult: draft.trimResult ?? null,
        trimAdvisory: draft.trimAdvisory ?? null,
        postStageVerified: draft.postStageVerified ?? false,
        commitExecuted,
        commitResult: draft.commitResult ?? null,
        ownershipCommitted,
        // commitFailed === (commitExecuted && !ownershipCommitted) — including
        // throw/malformed commit results, which are normalized to
        // commitExecuted=true, ownershipCommitted=false above.
        commitFailed: commitExecuted && !ownershipCommitted,
        trimRestoreAttempted: draft.trimRestoreAttempted ?? false,
        trimRestoreResult: draft.trimRestoreResult ?? null,
        trimRestoredToPreTransaction: draft.trimRestoredToPreTransaction ?? false,
        finalStatus: draft.finalStatus,
        legacyFallbackSafe: draft.legacyFallbackSafe,
        uncertainPresentationState: draft.uncertainPresentationState ?? false,
        failureReason: draft.failureReason,
        rollbackFailureReason: draft.rollbackFailureReason ?? null,
    };
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Coordinate C2 entry evaluation, source-basis preparation/verification, real
 * C1 trim staging, post-stage re-verification, an injected frontend-ownership
 * commit, and optional trim restore into one deterministic result. Never
 * throws, never mutates anything itself — all mutation-capable work happens
 * inside the injected dependencies, which this function only calls, never
 * value-imports.
 */
export function evaluatePresentationTransactionIntegration(
    input: PresentationTransactionIntegrationInput,
    dependencies: PresentationTransactionIntegrationDependencies,
): PresentationTransactionIntegrationResult {
    // Defensive: C3 is now the outermost boundary a hostile/malformed caller
    // reaches, unlike C2 (which could assume its caller always passed an
    // object). A non-object input must hold rather than throw outward.
    if (input === null || typeof input !== 'object') {
        return buildResult({
            generation: Number.NaN,
            entered: false,
            finalState: 'IDLE',
            stateHistory: ['IDLE'],
            entryResult: null,
            finalStatus: 'NOT_ENTERED',
            legacyFallbackSafe: true,
            failureReason: 'integration_input_missing_or_malformed',
        });
    }

    // ── C2 entry (Phase F) ────────────────────────────────────────────────────
    const entryResult = evaluatePresentationTransactionAttempt({
        generation: input.generation,
        gateSnapshot: input.gateSnapshot,
        intendedTrim: input.intendedTrim,
    });

    let state: PresentationTransactionRuntimeState = entryResult.finalState;
    const stateHistory: PresentationTransactionRuntimeState[] = [...entryResult.stateHistory];
    const advance = (to: PresentationTransactionRuntimeState): void => {
        const transition = transitionPresentationTransactionRuntimeState(state, to);
        if (!transition.allowed) return; // never happens for the calls below — verified against RUNTIME_TRANSITIONS
        state = transition.state;
        stateHistory.push(state);
    };

    if (entryResult.finalStatus !== 'READY_FOR_FUTURE_STAGE') {
        // NOT_ENTERED and HELD adopt C2's own history/state verbatim — C3 did
        // nothing beyond calling C2, so nothing further is truthfully recorded.
        return buildResult({
            generation: input.generation,
            entered: entryResult.entered,
            finalState: state,
            stateHistory,
            entryResult,
            finalStatus: entryResult.finalStatus === 'NOT_ENTERED' ? 'NOT_ENTERED' : 'HELD',
            legacyFallbackSafe: true,
            failureReason: entryResult.failureReason,
        });
    }
    // state === 'VALIDATING' here.

    // ── Source-basis preparation (Phase D) ────────────────────────────────────
    advance('SNAPSHOTTING');

    const routeSourceKeyValid = isFiniteNumber(input.routeSourceKey);
    const routeVersionValid = isFiniteNumber(input.routeVersion);
    const sourceSignatureValid = typeof input.sourceSignature === 'string';
    const bodySignatureValid = typeof input.bodySignature === 'string';
    const pathValidation = validateCandidatePath(input.candidatePath);
    const intendedTrimNormalized = normalizeTrimPaintValue(input.intendedTrim);

    const basisValid = routeSourceKeyValid && routeVersionValid && sourceSignatureValid
        && bodySignatureValid && pathValidation.valid && intendedTrimNormalized.valid;

    if (!basisValid) {
        advance('HELD');
        return buildResult({
            generation: input.generation,
            entered: entryResult.entered,
            finalState: state,
            stateHistory,
            entryResult,
            finalStatus: 'HELD',
            legacyFallbackSafe: true,
            failureReason: describeBasisInvalidity({
                routeSourceKeyValid, routeVersionValid, sourceSignatureValid, bodySignatureValid,
                pathValid: pathValidation.valid, intendedTrimValid: intendedTrimNormalized.valid,
            }),
        });
    }

    const sourceBasis: SourceBasisSnapshot = {
        generation: input.generation,
        routeSourceKey: input.routeSourceKey,
        routeVersion: input.routeVersion,
        sourceSignature: input.sourceSignature,
        bodySignature: input.bodySignature,
        candidatePathSnapshot: pathValidation.snapshot,
        intendedTrim: intendedTrimNormalized.value as number[],
    };

    advance('SOURCE_BASIS_PREPARED');

    // ── Source-basis verification (Phase E) ───────────────────────────────────
    let preStageCurrent: CurrentSourceOwnershipSnapshot | null = null;
    let preStageReadFailureReason: string | null = null;
    try {
        preStageCurrent = dependencies.readCurrentSourceOwnership();
    } catch (err) {
        preStageReadFailureReason = describeThrown('source_ownership_read_threw', err);
    }

    const preStageVerified = preStageCurrent !== null && identityFieldsEqual(sourceBasis, preStageCurrent);

    if (!preStageVerified) {
        // Correction 4: rest at SOURCE_BASIS_PREPARED. No mutation has occurred,
        // so no ROLLING_BACK / ROLLED_BACK / AUTO_DISABLED — a vacuous rollback
        // would be untruthful here.
        return buildResult({
            generation: input.generation,
            entered: entryResult.entered,
            finalState: state,
            stateHistory,
            entryResult,
            basisPrepared: true,
            basisVerified: false,
            finalStatus: 'HELD',
            legacyFallbackSafe: true,
            uncertainPresentationState: false,
            failureReason: preStageReadFailureReason ?? 'source_basis_verification_identity_drift',
        });
    }

    advance('SOURCE_BASIS_VERIFIED');

    // ── C1 stage invocation (Phase G) ─────────────────────────────────────────
    let trimResultRaw: unknown = null;
    let stageThrew = false;
    let stageThrowReason: string | null = null;
    try {
        trimResultRaw = dependencies.stageStrictTrimMutation({
            generation: input.generation,
            intendedTrim: sourceBasis.intendedTrim,
        });
    } catch (err) {
        stageThrew = true;
        stageThrowReason = describeThrown('c1_stage_threw', err);
    }

    if (stageThrew || !isValidTrimMutationResultShape(trimResultRaw)) {
        // Conservative historical classification: mutation MAY have occurred,
        // so STAGING_TRIM is recorded even though the call never confirmed a
        // successful stage. ROLLING_BACK here means "entering uncertainty
        // handling," not "a rollback succeeded" — the AUTO_DISABLED endpoint
        // guarantees no rollback success is ever claimed.
        advance('STAGING_TRIM');
        advance('ROLLING_BACK');
        advance('AUTO_DISABLED');
        return buildResult({
            generation: input.generation,
            entered: entryResult.entered,
            finalState: state,
            stateHistory,
            entryResult,
            basisPrepared: true,
            basisVerified: true,
            stagingExecuted: true,
            finalStatus: 'FAILED_UNCERTAIN',
            legacyFallbackSafe: false,
            uncertainPresentationState: true,
            failureReason: stageThrew ? stageThrowReason : 'c1_stage_result_malformed',
        });
    }

    const trimResult = trimResultRaw;
    const trimAdvisory = translateStrictTrimResultToAdvisory(trimResult.finalStatus);

    if (trimResult.finalStatus === 'NOT_ENTERED' || trimResult.finalStatus === 'HELD') {
        // No STAGING_TRIM recorded — nothing was staged. Rest at SOURCE_BASIS_VERIFIED.
        return buildResult({
            generation: input.generation,
            entered: entryResult.entered,
            finalState: state,
            stateHistory,
            entryResult,
            basisPrepared: true,
            basisVerified: true,
            stagingExecuted: false,
            trimResult,
            trimAdvisory,
            finalStatus: 'TRIM_HELD',
            legacyFallbackSafe: true,
            uncertainPresentationState: false,
            failureReason: trimResult.failureReason,
        });
    }

    if (trimResult.finalStatus === 'ROLLED_BACK') {
        advance('STAGING_TRIM');
        advance('ROLLING_BACK');
        advance('ROLLED_BACK');
        return buildResult({
            generation: input.generation,
            entered: entryResult.entered,
            finalState: state,
            stateHistory,
            entryResult,
            basisPrepared: true,
            basisVerified: true,
            stagingExecuted: true,
            trimResult,
            trimAdvisory,
            finalStatus: 'TRIM_ROLLED_BACK',
            legacyFallbackSafe: true,
            uncertainPresentationState: false,
            failureReason: trimResult.failureReason,
            rollbackFailureReason: trimResult.rollbackFailureReason,
        });
    }

    if (trimResult.finalStatus === 'ROLLBACK_FAILED') {
        advance('STAGING_TRIM');
        advance('ROLLING_BACK');
        advance('AUTO_DISABLED');
        return buildResult({
            generation: input.generation,
            entered: entryResult.entered,
            finalState: state,
            stateHistory,
            entryResult,
            basisPrepared: true,
            basisVerified: true,
            stagingExecuted: true,
            trimResult,
            trimAdvisory,
            finalStatus: 'FAILED_UNCERTAIN',
            legacyFallbackSafe: false,
            uncertainPresentationState: true,
            failureReason: trimResult.failureReason ?? 'c1_rollback_failed',
            rollbackFailureReason: trimResult.rollbackFailureReason,
        });
    }

    if (trimResult.finalStatus !== 'STAGED_VERIFIED') {
        // Any status outside the closed union a malformed injected dependency
        // might invent. Every REAL StrictTrimMutationStatus value is handled
        // by a named branch above — this is defensive-only.
        advance('STAGING_TRIM');
        advance('ROLLING_BACK');
        advance('AUTO_DISABLED');
        return buildResult({
            generation: input.generation,
            entered: entryResult.entered,
            finalState: state,
            stateHistory,
            entryResult,
            basisPrepared: true,
            basisVerified: true,
            stagingExecuted: true,
            trimResult,
            trimAdvisory,
            finalStatus: 'FAILED_UNCERTAIN',
            legacyFallbackSafe: false,
            uncertainPresentationState: true,
            failureReason: 'c1_stage_result_unrecognized_status',
        });
    }

    // trimResult.finalStatus === 'STAGED_VERIFIED'
    advance('STAGING_TRIM');

    // ── Pre-transaction trim extraction (Phase H) ─────────────────────────────
    const extraction = extractPreTransactionTrimValue(trimResult);
    if (!extraction.ok) {
        advance('ROLLING_BACK');
        advance('AUTO_DISABLED');
        return buildResult({
            generation: input.generation,
            entered: entryResult.entered,
            finalState: state,
            stateHistory,
            entryResult,
            basisPrepared: true,
            basisVerified: true,
            stagingExecuted: true,
            trimResult,
            trimAdvisory,
            finalStatus: 'FAILED_UNCERTAIN',
            legacyFallbackSafe: false,
            uncertainPresentationState: true,
            failureReason: `staged_verified_snapshots_unusable:${extraction.reason}`,
        });
    }
    const preTransactionTrimValue = extraction.value;
    const stagedTrimValue = isFiniteNumberPair(trimResult.intendedTrimValue)
        ? [trimResult.intendedTrimValue[0], trimResult.intendedTrimValue[1]]
        : [...sourceBasis.intendedTrim];

    advance('VERIFYING_STAGE');

    // ── Post-stage verification (Phase I) ─────────────────────────────────────
    let postStageCurrent: CurrentSourceOwnershipSnapshot | null = null;
    let postStageReadFailureReason: string | null = null;
    try {
        postStageCurrent = dependencies.readCurrentSourceOwnership();
    } catch (err) {
        postStageReadFailureReason = describeThrown('post_stage_source_ownership_read_threw', err);
    }
    const postStageOk = postStageCurrent !== null && identityFieldsEqual(sourceBasis, postStageCurrent);

    if (!postStageOk) {
        advance('ROLLING_BACK');

        let restoreRaw: unknown = null;
        let restoreThrew = false;
        let restoreThrowReason: string | null = null;
        try {
            restoreRaw = dependencies.stageStrictTrimMutation({
                generation: input.generation,
                intendedTrim: preTransactionTrimValue,
            });
        } catch (err) {
            restoreThrew = true;
            restoreThrowReason = describeThrown('c1_restore_threw', err);
        }
        const restoreResult = !restoreThrew && isValidTrimMutationResultShape(restoreRaw) ? restoreRaw : null;
        const restoredCleanly = restoreResult !== null && restoreResult.finalStatus === 'STAGED_VERIFIED';

        if (restoredCleanly) {
            advance('ROLLED_BACK');
            return buildResult({
                generation: input.generation,
                entered: entryResult.entered,
                finalState: state,
                stateHistory,
                entryResult,
                basisPrepared: true,
                basisVerified: true,
                stagingExecuted: true,
                trimResult,
                trimAdvisory,
                postStageVerified: false,
                trimRestoreAttempted: true,
                trimRestoreResult: restoreResult,
                trimRestoredToPreTransaction: true,
                finalStatus: 'TRIM_ROLLED_BACK',
                legacyFallbackSafe: true,
                uncertainPresentationState: false,
                failureReason: postStageReadFailureReason ?? 'post_stage_source_basis_drift',
            });
        }

        advance('AUTO_DISABLED');
        return buildResult({
            generation: input.generation,
            entered: entryResult.entered,
            finalState: state,
            stateHistory,
            entryResult,
            basisPrepared: true,
            basisVerified: true,
            stagingExecuted: true,
            trimResult,
            trimAdvisory,
            postStageVerified: false,
            trimRestoreAttempted: true,
            trimRestoreResult: restoreResult,
            // Restore ROLLED_BACK does not mean the pre-transaction value was
            // restored — it means the restore attempt itself failed and C1
            // rolled back to the staged value.
            trimRestoredToPreTransaction: false,
            finalStatus: 'FAILED_UNCERTAIN',
            legacyFallbackSafe: false,
            uncertainPresentationState: true,
            failureReason: postStageReadFailureReason ?? 'post_stage_source_basis_drift',
            rollbackFailureReason: restoreThrew
                ? restoreThrowReason
                : (restoreResult?.rollbackFailureReason ?? null),
        });
    }

    // ── Commit (Phase J/K/L) ───────────────────────────────────────────────────
    advance('COMMITTING_FRONTEND');

    let commitRaw: unknown = null;
    let commitThrew = false;
    let commitThrowReason: string | null = null;
    try {
        commitRaw = dependencies.commitFrontendOwnership({
            generation: input.generation,
            routeVersion: input.routeVersion,
            routeSourceKey: input.routeSourceKey,
            sourceSignature: input.sourceSignature,
            bodySignature: input.bodySignature,
            candidatePath: sourceBasis.candidatePathSnapshot,
            stagedTrim: stagedTrimValue,
        });
    } catch (err) {
        commitThrew = true;
        commitThrowReason = describeThrown('commit_threw', err);
    }

    const normalizedCommit = commitThrew ? null : normalizeCommitResult(commitRaw);
    const commitSucceeded = normalizedCommit !== null && normalizedCommit.committed === true;

    if (commitSucceeded) {
        advance('FINALIZED');
        return buildResult({
            generation: input.generation,
            entered: entryResult.entered,
            finalState: state,
            stateHistory,
            entryResult,
            basisPrepared: true,
            basisVerified: true,
            stagingExecuted: true,
            trimResult,
            trimAdvisory,
            postStageVerified: true,
            commitExecuted: true,
            commitResult: normalizedCommit,
            trimRestoreAttempted: false,
            trimRestoredToPreTransaction: false,
            finalStatus: 'COMMITTED',
            // Ownership is committed — falling back to legacy on top of it
            // would double-apply, so this is never fallback-safe.
            legacyFallbackSafe: false,
            uncertainPresentationState: false,
            failureReason: null,
        });
    }

    // ── Commit failure (Phase L) — trim restore is metadata only ─────────────
    let commitRestoreRaw: unknown = null;
    let commitRestoreThrew = false;
    try {
        commitRestoreRaw = dependencies.stageStrictTrimMutation({
            generation: input.generation,
            intendedTrim: preTransactionTrimValue,
        });
    } catch {
        commitRestoreThrew = true;
    }
    const commitRestoreResult = !commitRestoreThrew && isValidTrimMutationResultShape(commitRestoreRaw)
        ? commitRestoreRaw : null;
    const commitRestoredCleanly = commitRestoreResult !== null
        && commitRestoreResult.finalStatus === 'STAGED_VERIFIED';

    advance('AUTO_DISABLED');
    return buildResult({
        generation: input.generation,
        entered: entryResult.entered,
        finalState: state,
        stateHistory,
        entryResult,
        basisPrepared: true,
        basisVerified: true,
        stagingExecuted: true,
        trimResult,
        trimAdvisory,
        postStageVerified: true,
        commitExecuted: true,
        commitResult: normalizedCommit,
        trimRestoreAttempted: true,
        trimRestoreResult: commitRestoreResult,
        trimRestoredToPreTransaction: commitRestoredCleanly,
        finalStatus: 'FAILED_UNCERTAIN',
        // This remains false even when trim restore succeeds — restoring trim
        // paint never proves frontend ownership is clean.
        legacyFallbackSafe: false,
        uncertainPresentationState: true,
        failureReason: commitThrew ? commitThrowReason : (normalizedCommit?.failureReason ?? 'commit_failed_or_malformed'),
        rollbackFailureReason: commitRestoreResult?.rollbackFailureReason ?? null,
    });
}
