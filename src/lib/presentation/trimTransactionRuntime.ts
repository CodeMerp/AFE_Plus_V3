// ─────────────────────────────────────────────────────────────────────────────
// PR2a-1C-C1 — Strict Trim Mutation / Read-back / Rollback Helper (UNREACHABLE)
//
// This module is the FIRST code in the project that can imperatively mutate
// Mapbox paint state. It is deliberately UNREACHABLE from every production
// navigation path in PR2a-1C-C1: nothing under app/, components/, or lib/
// imports, re-exports, or calls it. Its only consumers are the focused test
// and verifier scripts. Wiring it into the PR2a-1C-B2 wrapper is C2 work.
//
// Scope: `line-trim-offset` paint on `route-line-casing` and `route-line` only.
//   - never touches route geometry
//   - never calls source.setData() — React remains the Source-data owner
//   - never writes a production ref, React state, or motionRouteVersion
//   - never calls applySourcePathLegacy or any fallback
//   - never schedules work (no rAF/timeout) and emits no runtime diagnostics
//
// Safety posture: a thrown setPaintProperty is NEVER treated as proof that no
// mutation occurred. Mapbox may apply a value before throwing, so a throw marks
// the layer POTENTIALLY WRITTEN until an immediate read-back proves it still
// equals the pre-write snapshot. Uncertainty always prefers rollback.
//
// What this helper proves: the style state Mapbox itself reports through
// getPaintProperty matches what we intended, and that we can restore it.
// What it does NOT prove: GPU-visible/rendered state, rendered atomicity, or
// the absence of one-frame flicker. Those require frame capture, not this code.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeTrimPaintValue, compareTrimPaintValues } from './trimTransactionModel.ts';
import type { PresentationTrimLayerId } from './trimTransactionModel.ts';

// ── Fixed layer contract (Phase B) ───────────────────────────────────────────
// Module-private and NOT exported. Layer identity is a property of this
// module's code, never of caller-supplied data, so duplicated, reversed, or
// arbitrary layer IDs are impossible through the API rather than merely
// validated after the fact.
const STRICT_TRIM_CASING_LAYER_ID: PresentationTrimLayerId = 'route-line-casing';
const STRICT_TRIM_ROUTE_LAYER_ID: PresentationTrimLayerId = 'route-line';

const TRIM_PAINT_PROPERTY = 'line-trim-offset' as const;

// Write casing first: it is the thick line behind the main route line. Trimming
// the thin route line first would briefly expose the casing edge.
const STRICT_TRIM_WRITE_ORDER: readonly PresentationTrimLayerId[] = [
    STRICT_TRIM_CASING_LAYER_ID,
    STRICT_TRIM_ROUTE_LAYER_ID,
];
// Exact reverse of the write order.
const STRICT_TRIM_ROLLBACK_ORDER: readonly PresentationTrimLayerId[] = [
    STRICT_TRIM_ROUTE_LAYER_ID,
    STRICT_TRIM_CASING_LAYER_ID,
];

// ── Narrow adapter (Phase C) ─────────────────────────────────────────────────
// Structural, so a real Mapbox map instance satisfies it directly with no
// translation layer, while tests pass a recording mock. `getLayer` keeps
// Mapbox's own `object | undefined` shape rather than a boolean for that reason.
export interface TrimPaintMapAdapter {
    getLayer(layerId: string): unknown;
    getPaintProperty(layerId: string, property: 'line-trim-offset'): unknown;
    setPaintProperty(layerId: string, property: 'line-trim-offset', value: [number, number]): void;
}

// ── Types (Phase D) ──────────────────────────────────────────────────────────

export type StrictTrimMutationStatus =
    | 'NOT_ENTERED'
    | 'HELD'
    | 'STAGED_VERIFIED'
    | 'ROLLED_BACK'
    | 'ROLLBACK_FAILED';

export interface StrictTrimMutationInput {
    generation: number;
    intendedTrim: unknown;
    // Deliberately NO routeLayerId / casingLayerId — see the fixed layer contract.
}

export interface TrimLayerSnapshot {
    layerId: PresentationTrimLayerId;
    exists: boolean;
    readable: boolean;
    /** Shape description only — never the raw Mapbox value or an Error object. */
    rawShape: string;
    /** Fresh copy; never a reference to an array the adapter returned. */
    normalizedValue: number[] | null;
}

export interface StrictTrimMutationResult {
    generation: number;
    entered: boolean;
    snapshotComplete: boolean;
    routeSnapshot: TrimLayerSnapshot | null;
    casingSnapshot: TrimLayerSnapshot | null;
    intendedTrimValue: number[] | null;
    intendedTrimValid: boolean;
    writeAttempted: boolean;
    casingWriteSucceeded: boolean;
    routeWriteSucceeded: boolean;
    readBackVerified: boolean;
    rollbackAttempted: boolean;
    /** null when the layer was not in rollback scope. */
    casingRollbackSucceeded: boolean | null;
    routeRollbackSucceeded: boolean | null;
    rollbackVerified: boolean;
    /** Authoritative. Every other field is audit evidence and must agree with it. */
    finalStatus: StrictTrimMutationStatus;
    failureReason: string | null;
    rollbackFailureReason: string | null;
    /** Definitely written only: setPaintProperty returned normally. */
    writtenLayers: PresentationTrimLayerId[];
    /** Write threw and read-back did NOT prove the layer unchanged. */
    potentiallyWrittenLayers: PresentationTrimLayerId[];
    /** Ordered union of definite + potential, in rollback order. */
    rollbackScopeLayers: PresentationTrimLayerId[];
    /** Restored AND verified against the snapshot. */
    restoredLayers: PresentationTrimLayerId[];
    writeOrderUsed: PresentationTrimLayerId[];
    rollbackOrderUsed: PresentationTrimLayerId[];
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Sanitize any thrown value into a safe string. Never stores an Error object. */
function describeThrown(prefix: string, err: unknown): string {
    let detail = 'unknown';
    if (typeof err === 'string') {
        detail = err;
    } else if (err !== null && typeof err === 'object') {
        const maybeMessage = (err as { message?: unknown }).message;
        if (typeof maybeMessage === 'string') detail = maybeMessage;
        else detail = 'non_string_error';
    } else if (typeof err === 'number' || typeof err === 'boolean') {
        detail = String(err);
    }
    // Keep it short and free of any object reference.
    return `${prefix}:${detail.slice(0, 120)}`;
}

function copyPair(value: number[] | null): number[] | null {
    return value === null ? null : [value[0], value[1]];
}

function isCallable(candidate: unknown): boolean {
    return typeof candidate === 'function';
}

interface LayerReadResult {
    exists: boolean;
    readable: boolean;
    rawShape: string;
    normalizedValue: number[] | null;
    threw: boolean;
}

/**
 * Read one layer's trim, copying the value immediately so a later adapter-side
 * mutation of the returned array cannot corrupt our snapshot.
 */
function readLayerTrim(adapter: TrimPaintMapAdapter, layerId: PresentationTrimLayerId): LayerReadResult {
    let exists = false;
    try {
        exists = !!adapter.getLayer(layerId);
    } catch {
        return { exists: false, readable: false, rawShape: 'get_layer_threw', normalizedValue: null, threw: true };
    }
    if (!exists) {
        return { exists: false, readable: false, rawShape: 'layer_missing', normalizedValue: null, threw: false };
    }
    let raw: unknown;
    try {
        raw = adapter.getPaintProperty(layerId, TRIM_PAINT_PROPERTY);
    } catch {
        return { exists: true, readable: false, rawShape: 'get_paint_threw', normalizedValue: null, threw: true };
    }
    const normalized = normalizeTrimPaintValue(raw);
    return {
        exists: true,
        readable: normalized.valid,
        rawShape: normalized.shape,
        // copyPair guarantees the result never aliases the adapter's array.
        normalizedValue: copyPair(normalized.value),
        threw: false,
    };
}

function toSnapshot(layerId: PresentationTrimLayerId, read: LayerReadResult): TrimLayerSnapshot {
    return {
        layerId,
        exists: read.exists,
        readable: read.readable,
        rawShape: read.rawShape,
        normalizedValue: copyPair(read.normalizedValue),
    };
}

function structurallyEqual(a: number[] | null, b: number[] | null): boolean {
    const comparison = compareTrimPaintValues(a, b);
    return comparison.bothValid && comparison.structurallyEqual;
}

/** Attempt one paint write. Never throws. Returns whether it returned normally. */
function attemptWrite(
    adapter: TrimPaintMapAdapter,
    layerId: PresentationTrimLayerId,
    value: number[],
): { returned: boolean; failure: string | null } {
    try {
        // Fresh copy every time: if the adapter mutates the array we hand it,
        // our snapshot and intended values stay intact. Called through the
        // adapter object (never a detached reference) and without optional
        // chaining, so a missing method can never silently no-op into a
        // false success.
        adapter.setPaintProperty(layerId, TRIM_PAINT_PROPERTY, [value[0], value[1]]);
        return { returned: true, failure: null };
    } catch (err) {
        return { returned: false, failure: describeThrown(`write_threw_${layerId}`, err) };
    }
}

function buildResult(base: Partial<StrictTrimMutationResult> & {
    generation: number;
    finalStatus: StrictTrimMutationStatus;
}): StrictTrimMutationResult {
    return {
        generation: base.generation,
        entered: base.entered ?? false,
        snapshotComplete: base.snapshotComplete ?? false,
        routeSnapshot: base.routeSnapshot ?? null,
        casingSnapshot: base.casingSnapshot ?? null,
        intendedTrimValue: copyPair(base.intendedTrimValue ?? null),
        intendedTrimValid: base.intendedTrimValid ?? false,
        writeAttempted: base.writeAttempted ?? false,
        casingWriteSucceeded: base.casingWriteSucceeded ?? false,
        routeWriteSucceeded: base.routeWriteSucceeded ?? false,
        readBackVerified: base.readBackVerified ?? false,
        rollbackAttempted: base.rollbackAttempted ?? false,
        casingRollbackSucceeded: base.casingRollbackSucceeded ?? null,
        routeRollbackSucceeded: base.routeRollbackSucceeded ?? null,
        rollbackVerified: base.rollbackVerified ?? false,
        finalStatus: base.finalStatus,
        failureReason: base.failureReason ?? null,
        rollbackFailureReason: base.rollbackFailureReason ?? null,
        writtenLayers: [...(base.writtenLayers ?? [])],
        potentiallyWrittenLayers: [...(base.potentiallyWrittenLayers ?? [])],
        rollbackScopeLayers: [...(base.rollbackScopeLayers ?? [])],
        restoredLayers: [...(base.restoredLayers ?? [])],
        writeOrderUsed: [...STRICT_TRIM_WRITE_ORDER],
        rollbackOrderUsed: [...STRICT_TRIM_ROLLBACK_ORDER],
    };
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Stage `intendedTrim` onto both route layers, verify by read-back, and roll
 * back on any failure. Returns result data only — it never throws, never
 * decides policy, and never calls production code.
 */
export function executeStrictTrimMutation(
    adapter: TrimPaintMapAdapter,
    input: StrictTrimMutationInput,
): StrictTrimMutationResult {
    const generation = input.generation;

    // ── Adapter capability (Phase E) ─────────────────────────────────────────
    // Resolved once, up front. Everything after this point calls the adapter
    // unconditionally, so no optional chaining is needed anywhere.
    if (
        adapter === null
        || typeof adapter !== 'object'
        || !isCallable((adapter as TrimPaintMapAdapter).getLayer)
        || !isCallable((adapter as TrimPaintMapAdapter).getPaintProperty)
        || !isCallable((adapter as TrimPaintMapAdapter).setPaintProperty)
    ) {
        return buildResult({
            generation,
            finalStatus: 'NOT_ENTERED',
            failureReason: 'adapter_capability_unavailable',
        });
    }

    // ── Pre-mutation snapshot (Phase E) ──────────────────────────────────────
    const casingRead = readLayerTrim(adapter, STRICT_TRIM_CASING_LAYER_ID);
    const routeRead = readLayerTrim(adapter, STRICT_TRIM_ROUTE_LAYER_ID);
    const casingSnapshot = toSnapshot(STRICT_TRIM_CASING_LAYER_ID, casingRead);
    const routeSnapshot = toSnapshot(STRICT_TRIM_ROUTE_LAYER_ID, routeRead);

    const intendedNormalized = normalizeTrimPaintValue(input.intendedTrim);
    const intendedTrimValue = copyPair(intendedNormalized.value);
    const intendedTrimValid = intendedNormalized.valid;

    const snapshotComplete = casingRead.exists && casingRead.readable
        && routeRead.exists && routeRead.readable;

    const heldBase = {
        generation,
        entered: true,
        snapshotComplete,
        routeSnapshot,
        casingSnapshot,
        intendedTrimValue,
        intendedTrimValid,
    };

    // Ordered precondition evaluation — the first failure holds.
    let holdReason: string | null = null;
    if (!casingRead.exists) holdReason = 'casing_layer_missing';
    else if (!routeRead.exists) holdReason = 'route_layer_missing';
    else if (!casingRead.readable) holdReason = 'casing_trim_unreadable_or_invalid';
    else if (!routeRead.readable) holdReason = 'route_trim_unreadable_or_invalid';
    else if (!structurallyEqual(casingRead.normalizedValue, routeRead.normalizedValue)) {
        holdReason = 'current_route_casing_trim_values_differ';
    } else if (!intendedTrimValid) holdReason = 'intended_trim_invalid';

    if (holdReason !== null) {
        return buildResult({ ...heldBase, finalStatus: 'HELD', failureReason: holdReason });
    }

    // Guaranteed non-null by the checks above; copies are already independent.
    const casingSnapValue = casingRead.normalizedValue as number[];
    const routeSnapValue = routeRead.normalizedValue as number[];
    const intendedValue = intendedTrimValue as number[];

    const definitelyWritten: PresentationTrimLayerId[] = [];
    const potentiallyWritten: PresentationTrimLayerId[] = [];
    let casingWriteSucceeded = false;
    let routeWriteSucceeded = false;
    let failureReason: string | null = null;

    /**
     * Phase G: a throw never proves the layer is clean. Inspect immediately;
     * only a successful, valid, still-existing read-back that structurally
     * equals the snapshot clears the potentially-written mark.
     */
    const classifyAfterThrow = (
        layerId: PresentationTrimLayerId,
        snapshotValue: number[],
    ): void => {
        potentiallyWritten.push(layerId);
        const postThrow = readLayerTrim(adapter, layerId);
        const provenUnchanged = postThrow.exists
            && postThrow.readable
            && structurallyEqual(postThrow.normalizedValue, snapshotValue);
        if (provenUnchanged) {
            const idx = potentiallyWritten.indexOf(layerId);
            if (idx >= 0) potentiallyWritten.splice(idx, 1);
        }
    };

    // ── Strict write order (Phase F): casing, then route ─────────────────────
    const casingWrite = attemptWrite(adapter, STRICT_TRIM_CASING_LAYER_ID, intendedValue);
    if (casingWrite.returned) {
        casingWriteSucceeded = true;
        definitelyWritten.push(STRICT_TRIM_CASING_LAYER_ID);
    } else {
        failureReason = casingWrite.failure;
        classifyAfterThrow(STRICT_TRIM_CASING_LAYER_ID, casingSnapValue);
        // Casing failed: the route write must not run.
    }

    if (casingWriteSucceeded) {
        const routeWrite = attemptWrite(adapter, STRICT_TRIM_ROUTE_LAYER_ID, intendedValue);
        if (routeWrite.returned) {
            routeWriteSucceeded = true;
            definitelyWritten.push(STRICT_TRIM_ROUTE_LAYER_ID);
        } else {
            failureReason = routeWrite.failure;
            classifyAfterThrow(STRICT_TRIM_ROUTE_LAYER_ID, routeSnapValue);
        }
    }

    // ── Stage read-back verification (Phase H) ───────────────────────────────
    let readBackVerified = false;
    if (casingWriteSucceeded && routeWriteSucceeded) {
        const casingBack = readLayerTrim(adapter, STRICT_TRIM_CASING_LAYER_ID);
        const routeBack = readLayerTrim(adapter, STRICT_TRIM_ROUTE_LAYER_ID);
        const casingOk = casingBack.exists && casingBack.readable
            && structurallyEqual(casingBack.normalizedValue, intendedValue);
        const routeOk = routeBack.exists && routeBack.readable
            && structurallyEqual(routeBack.normalizedValue, intendedValue);
        readBackVerified = casingOk && routeOk;
        if (!readBackVerified) {
            failureReason = !casingOk ? 'casing_read_back_mismatch' : 'route_read_back_mismatch';
        }
    }

    const stageSucceeded = casingWriteSucceeded && routeWriteSucceeded && readBackVerified;

    if (stageSucceeded) {
        return buildResult({
            ...heldBase,
            writeAttempted: true,
            casingWriteSucceeded: true,
            routeWriteSucceeded: true,
            readBackVerified: true,
            finalStatus: 'STAGED_VERIFIED',
            writtenLayers: [STRICT_TRIM_CASING_LAYER_ID, STRICT_TRIM_ROUTE_LAYER_ID],
        });
    }

    // ── Rollback scope: ordered union of definite + potential ────────────────
    const rollbackScope = STRICT_TRIM_ROLLBACK_ORDER.filter(
        (layerId) => definitelyWritten.includes(layerId) || potentiallyWritten.includes(layerId),
    );

    if (rollbackScope.length === 0) {
        // Nothing confirmed or suspected written — the write threw and read-back
        // proved the layer unchanged. Safe no-mutation hold.
        return buildResult({
            ...heldBase,
            writeAttempted: true,
            finalStatus: 'HELD',
            failureReason: failureReason ?? 'write_failed_no_mutation',
        });
    }

    // ── Rollback (Phase I) ───────────────────────────────────────────────────
    const snapshotFor = (layerId: PresentationTrimLayerId): number[] =>
        layerId === STRICT_TRIM_CASING_LAYER_ID ? casingSnapValue : routeSnapValue;

    const restoredLayers: PresentationTrimLayerId[] = [];
    let rollbackFailureReason: string | null = null;
    const rollbackSucceededByLayer = new Map<PresentationTrimLayerId, boolean>();

    for (const layerId of rollbackScope) {
        let restored = false;
        const snapshotValue = snapshotFor(layerId);

        let layerExists = false;
        try {
            layerExists = !!adapter.getLayer(layerId);
        } catch {
            layerExists = false;
        }

        if (!layerExists) {
            rollbackFailureReason = rollbackFailureReason
                ?? `rollback_layer_missing_${layerId}`;
        } else {
            const restoreWrite = attemptWrite(adapter, layerId, snapshotValue);
            if (!restoreWrite.returned) {
                rollbackFailureReason = rollbackFailureReason
                    ?? (restoreWrite.failure ?? `rollback_write_failed_${layerId}`);
            } else {
                const verifyRead = readLayerTrim(adapter, layerId);
                const verified = verifyRead.exists && verifyRead.readable
                    && structurallyEqual(verifyRead.normalizedValue, snapshotValue);
                if (verified) {
                    restored = true;
                    restoredLayers.push(layerId);
                } else {
                    rollbackFailureReason = rollbackFailureReason
                        ?? `rollback_verify_failed_${layerId}`;
                }
            }
        }
        rollbackSucceededByLayer.set(layerId, restored);
        // Continue to the next layer regardless — restoring one of two is
        // strictly better than restoring none.
    }

    const rollbackVerified = restoredLayers.length === rollbackScope.length;

    return buildResult({
        ...heldBase,
        writeAttempted: true,
        casingWriteSucceeded,
        routeWriteSucceeded,
        readBackVerified: false,
        rollbackAttempted: true,
        casingRollbackSucceeded: rollbackScope.includes(STRICT_TRIM_CASING_LAYER_ID)
            ? (rollbackSucceededByLayer.get(STRICT_TRIM_CASING_LAYER_ID) ?? false)
            : null,
        routeRollbackSucceeded: rollbackScope.includes(STRICT_TRIM_ROUTE_LAYER_ID)
            ? (rollbackSucceededByLayer.get(STRICT_TRIM_ROUTE_LAYER_ID) ?? false)
            : null,
        rollbackVerified,
        finalStatus: rollbackVerified ? 'ROLLED_BACK' : 'ROLLBACK_FAILED',
        failureReason: failureReason ?? 'stage_failed',
        rollbackFailureReason,
        writtenLayers: [...definitelyWritten],
        potentiallyWrittenLayers: [...potentiallyWritten],
        rollbackScopeLayers: [...rollbackScope],
        restoredLayers,
    });
}
