// ─────────────────────────────────────────────────────────────────────────────
// PR2a-1B — Strict Trim Transaction Dry Run (BEHAVIOR-FREE, PURE)
//
// This module answers, for a same-identity accepted MT-D* route candidate that
// PR2a-1A already prepared: if a FUTURE transaction were to write
// `line-trim-offset` onto the route/casing Mapbox layers, what exactly would it
// write, in what order, could it be rolled back, and are the preconditions
// needed to attempt that write safely satisfied right now?
//
// PR2a-1B performs ZERO Mapbox mutation. `READY` means "measured preconditions
// are complete" — it does NOT mean a future mutation is guaranteed to succeed.
// No write is executed here; `casingWritePlanned`/`routeWritePlanned` are plain
// data describing what a write WOULD look like, never a callback.
//
// Pure: no React, no Mapbox, no DOM, no refs, no module-level mutable state, no
// side effects, no production thresholds. Pure-to-pure import from
// presentationModel.ts reuses `trimOffsetEquals` rather than re-implementing it.
// ─────────────────────────────────────────────────────────────────────────────

// Explicit `.ts` extension (requires `allowImportingTsExtensions` in
// tsconfig.json): resolves correctly under Next.js/Turbopack's bundler
// resolution AND, combined with `--rewriteRelativeImportExtensions` in the
// tsc invocation, compiles to a `.js`-suffixed import that plain Node ESM can
// resolve when this file is compiled standalone for the pure-model unit tests
// (scripts/test-presentation-model.mjs). A `.js`-suffixed source specifier
// looked correct for the standalone Node ESM path but is not resolvable by
// Turbopack against a `.ts` source tree — see production build fix, 2026-08-04.
import { trimOffsetEquals } from './presentationModel.ts';

// ── Phase C: trim value normalization ────────────────────────────────────────

export type TrimPaintShapeDescription =
    | 'valid_pair'
    | 'null'
    | 'undefined'
    | 'non_array'
    | 'wrong_length'
    | 'non_numeric_elements'
    | 'nan_or_infinite';

export interface NormalizedTrimPaintValue {
    valid: boolean;
    value: number[] | null;
    shape: TrimPaintShapeDescription;
    /**
     * Informational only — production always writes `[0, x]`, but a value that
     * doesn't start at 0 is not itself an invalid shape. Never used to reject.
     */
    startIsZero: boolean | null;
    /** Informational only — never used to reject a value. */
    endInUnitRange: boolean | null;
}

export function describeTrimPaintShape(raw: unknown): TrimPaintShapeDescription {
    if (raw === null) return 'null';
    if (raw === undefined) return 'undefined';
    if (!Array.isArray(raw)) return 'non_array';
    if (raw.length !== 2) return 'wrong_length';
    if (typeof raw[0] !== 'number' || typeof raw[1] !== 'number') return 'non_numeric_elements';
    if (!Number.isFinite(raw[0]) || !Number.isFinite(raw[1])) return 'nan_or_infinite';
    return 'valid_pair';
}

/**
 * Valid only when: array, length 2, both elements numbers, both finite.
 * Deliberately never uses truthiness — `[0, 0]` is a fully valid trim value
 * (agent has not moved yet), not a "missing" one.
 */
export function normalizeTrimPaintValue(raw: unknown): NormalizedTrimPaintValue {
    const shape = describeTrimPaintShape(raw);
    if (shape !== 'valid_pair') {
        return { valid: false, value: null, shape, startIsZero: null, endInUnitRange: null };
    }
    const pair = raw as number[];
    return {
        valid: true,
        value: [pair[0], pair[1]],
        shape,
        startIsZero: pair[0] === 0,
        endInUnitRange: pair[1] >= 0 && pair[1] <= 1,
    };
}

export interface TrimPaintComparison {
    structurallyEqual: boolean;
    bothValid: boolean;
}

/**
 * Structural numeric equality only — reuses `trimOffsetEquals` from
 * presentationModel.ts rather than re-implementing it. Object identity is never
 * used: Mapbox may return a different array instance holding the same numbers.
 * No epsilon is invented — production writes plain JS number literals that are
 * never quantized by Mapbox GL JS for this property.
 */
export function compareTrimPaintValues(a: number[] | null, b: number[] | null): TrimPaintComparison {
    return {
        structurallyEqual: trimOffsetEquals(a, b),
        bothValid: a !== null && b !== null,
    };
}

// ── Phase B: layer identity + planned write (plain data only) ───────────────

export type PresentationTrimLayerId = 'route-line' | 'route-line-casing';

export interface PlannedTrimWrite {
    layerId: PresentationTrimLayerId;
    value: number[];
}

const WRITE_ORDER: readonly PresentationTrimLayerId[] = ['route-line-casing', 'route-line'];
const ROLLBACK_ORDER: readonly PresentationTrimLayerId[] = ['route-line', 'route-line-casing'];

// ── Phase E: failure simulation data — conceptual strings only, never executed ─

const EXPECTED_SUCCESS_CRITERIA: readonly string[] = [
    'source_exists',
    'both_layers_exist',
    'both_existing_trim_values_readable',
    'intended_trim_valid',
    'both_writes_would_need_read_back_verification',
    'both_read_back_values_would_need_to_structurally_equal_intended_trim',
];

const PARTIAL_FAILURE_CASES: readonly string[] = [
    'casing_write_succeeds_route_write_fails',
    'route_write_succeeds_casing_write_fails',
    'read_back_differs_from_intended',
    'rollback_write_fails',
    'rollback_verification_fails',
    'source_or_layer_readiness_changes_mid_transaction',
];

// ── Phase D: dry-run decision ─────────────────────────────────────────────────

export type StrictTrimTransactionDryRunDecision = 'READY' | 'HOLD' | 'UNPROVEN';

export interface StrictTrimTransactionDryRunInput {
    generation: number;
    sourceExists: boolean;
    sourceGeometryReadable: boolean;
    sourceGeometrySignature: string | null;
    currentDisplayedGeometrySignature: string | null;
    routeLayerExists: boolean;
    casingLayerExists: boolean;
    /** Raw `getPaintProperty` return value — normalized internally. */
    routeLayerTrimRaw: unknown;
    casingLayerTrimRaw: unknown;
    intendedTrimRaw: unknown;
    rollbackSnapshotComplete: boolean;
    candidateGeometrySignature: string;
    candidateTrimBasisSignature: string | null;
    /**
     * True when the caller could not detect any cross-generation change in the
     * readiness/signature signals it already holds. Read-only input — this
     * model never infers change over time itself, since a single synchronous
     * pass cannot observe change across frames by definition.
     */
    readinessSignatureStable: boolean;
    /**
     * True when the caller has independent evidence of a Mapbox style/source
     * remount risk. Read-only input, same reasoning as above.
     */
    sourceRemountRiskObserved: boolean;
}

export interface StrictTrimTransactionDryRunResult {
    generation: number;
    snapshotComplete: boolean;
    sourceExists: boolean;
    sourceGeometryReadable: boolean;
    routeLayerExists: boolean;
    casingLayerExists: boolean;
    routeTrimReadable: boolean;
    casingTrimReadable: boolean;
    routeTrimValue: number[] | null;
    casingTrimValue: number[] | null;
    trimValuesStructurallyEqual: boolean;
    intendedTrimValue: number[] | null;
    intendedTrimValid: boolean;
    writeOrder: PresentationTrimLayerId[];
    rollbackOrder: PresentationTrimLayerId[];
    casingWritePlanned: PlannedTrimWrite | null;
    routeWritePlanned: PlannedTrimWrite | null;
    expectedSuccessCriteria: string[];
    partialFailureCases: string[];
    rollbackPossible: boolean;
    /** Diagnostic only — never controls production, never guarantees mutation success. */
    mutationWouldBeAllowed: boolean;
    dryRunDecision: StrictTrimTransactionDryRunDecision;
    dryRunFailureReason: string | null;
}

/**
 * HOLD — a deterministic required precondition is missing or invalid. Every
 * HOLD reason below is verifiable within this single synchronous pass; none
 * require more information to resolve.
 *
 * UNPROVEN — every required resource is readable and structurally valid, but
 * this single synchronous dry-run cannot prove cross-generation/cross-frame
 * stability (signature drift, remount risk). Never silently promoted to READY.
 *
 * READY — no HOLD reason and no UNPROVEN reason. Invariant:
 * `dryRunDecision === 'READY' ⟹ dryRunFailureReason === null`.
 */
export function evaluateStrictTrimTransactionDryRun(
    input: StrictTrimTransactionDryRunInput,
): StrictTrimTransactionDryRunResult {
    const routeNormalized = normalizeTrimPaintValue(input.routeLayerTrimRaw);
    const casingNormalized = normalizeTrimPaintValue(input.casingLayerTrimRaw);
    const intendedNormalized = normalizeTrimPaintValue(input.intendedTrimRaw);

    const routeTrimReadable = routeNormalized.valid;
    const casingTrimReadable = casingNormalized.valid;
    const comparison = compareTrimPaintValues(routeNormalized.value, casingNormalized.value);
    const trimValuesStructurallyEqual = comparison.bothValid && comparison.structurallyEqual;

    const candidateBasisMatchesCandidate = input.candidateTrimBasisSignature !== null
        && input.candidateTrimBasisSignature === input.candidateGeometrySignature;

    const snapshotComplete = input.sourceExists
        && input.sourceGeometryReadable
        && input.routeLayerExists
        && input.casingLayerExists
        && routeTrimReadable
        && casingTrimReadable
        && input.rollbackSnapshotComplete;

    // ── HOLD: deterministic, verifiable in this frame ──
    let holdReason: string | null = null;
    if (!input.sourceExists) holdReason = 'source_missing';
    else if (!input.sourceGeometryReadable) holdReason = 'source_geometry_unreadable';
    else if (!input.routeLayerExists) holdReason = 'route_layer_missing';
    else if (!input.casingLayerExists) holdReason = 'casing_layer_missing';
    else if (!routeTrimReadable) holdReason = 'route_trim_unreadable_or_invalid';
    else if (!casingTrimReadable) holdReason = 'casing_trim_unreadable_or_invalid';
    else if (!trimValuesStructurallyEqual) holdReason = 'existing_route_casing_trim_values_differ';
    else if (!intendedNormalized.valid) holdReason = 'intended_trim_invalid';
    else if (!input.rollbackSnapshotComplete) holdReason = 'rollback_snapshot_incomplete';
    else if (!candidateBasisMatchesCandidate) holdReason = 'candidate_trim_basis_signature_mismatch';

    // ── UNPROVEN: resources fine, cross-frame/cross-generation uncertainty ──
    let unprovenReason: string | null = null;
    if (holdReason === null) {
        if (
            input.sourceGeometrySignature !== null
            && input.currentDisplayedGeometrySignature !== null
            && input.sourceGeometrySignature !== input.currentDisplayedGeometrySignature
        ) {
            unprovenReason = 'source_geometry_signature_drift';
        } else if (!input.readinessSignatureStable) {
            unprovenReason = 'readiness_signature_not_stable';
        } else if (input.sourceRemountRiskObserved) {
            unprovenReason = 'source_remount_risk_observed';
        }
    }

    const dryRunDecision: StrictTrimTransactionDryRunDecision = holdReason !== null
        ? 'HOLD'
        : (unprovenReason !== null ? 'UNPROVEN' : 'READY');
    const dryRunFailureReason = dryRunDecision === 'READY' ? null : (holdReason ?? unprovenReason);

    const rollbackPossible = input.rollbackSnapshotComplete;
    const mutationWouldBeAllowed = dryRunDecision === 'READY';

    const casingWritePlanned: PlannedTrimWrite | null = intendedNormalized.valid
        ? { layerId: 'route-line-casing', value: intendedNormalized.value as number[] }
        : null;
    const routeWritePlanned: PlannedTrimWrite | null = intendedNormalized.valid
        ? { layerId: 'route-line', value: intendedNormalized.value as number[] }
        : null;

    return {
        generation: input.generation,
        snapshotComplete,
        sourceExists: input.sourceExists,
        sourceGeometryReadable: input.sourceGeometryReadable,
        routeLayerExists: input.routeLayerExists,
        casingLayerExists: input.casingLayerExists,
        routeTrimReadable,
        casingTrimReadable,
        routeTrimValue: routeNormalized.value,
        casingTrimValue: casingNormalized.value,
        trimValuesStructurallyEqual,
        intendedTrimValue: intendedNormalized.value,
        intendedTrimValid: intendedNormalized.valid,
        writeOrder: [...WRITE_ORDER],
        rollbackOrder: [...ROLLBACK_ORDER],
        casingWritePlanned,
        routeWritePlanned,
        expectedSuccessCriteria: [...EXPECTED_SUCCESS_CRITERIA],
        partialFailureCases: [...PARTIAL_FAILURE_CASES],
        rollbackPossible,
        mutationWouldBeAllowed,
        dryRunDecision,
        dryRunFailureReason,
    };
}
