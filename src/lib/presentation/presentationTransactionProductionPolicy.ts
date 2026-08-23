// ─────────────────────────────────────────────────────────────────────────────
// PR2a-1C-C4-A — Pure Production Result Policy
//
// Decides what the ON-branch production wrapper should do with one attempt at
// a presentation transaction. Pure: no legacy call, no refs, no React, no
// Mapbox, no callback, no mutation, no Error object ever stored or returned.
//
// The public boundary accepts `unknown`, not a trusted typed C3 result — the
// caller may hand this function a real C3 result, a clean-precondition hold,
// an unexpected-error marker, or (in principle) anything else. Every branch
// validates full runtime shape and cross-field invariants before choosing a
// decision. Any malformed, contradictory, unrecognized, or incomplete input
// resolves to AUTO_DISABLE_NO_FALLBACK — never a silent guess toward
// USE_LEGACY or TRANSACTION_COMMITTED.
// ─────────────────────────────────────────────────────────────────────────────

export type ProductionPolicyDecision = 'USE_LEGACY' | 'TRANSACTION_COMMITTED' | 'AUTO_DISABLE_NO_FALLBACK';

export interface ProductionPolicyOutcome {
    decision: ProductionPolicyDecision;
    requestAutoDisable: boolean;
    reason: string;
}

export type ProductionAttemptOutcome =
    | { kind: 'C3_RESULT'; result: unknown }
    | { kind: 'CLEAN_PRECONDITION_HOLD'; reason: string }
    | { kind: 'UNEXPECTED_ATTEMPT_ERROR'; reason: string };

// ── Internal shape guards ────────────────────────────────────────────────────

function isPlainRecord(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isBool(v: unknown): v is boolean {
    return typeof v === 'boolean';
}

function isStr(v: unknown): v is string {
    return typeof v === 'string';
}

const auto = (reason: string): ProductionPolicyOutcome =>
    ({ decision: 'AUTO_DISABLE_NO_FALLBACK', requestAutoDisable: true, reason });

/**
 * Recognizes exactly the two evidence shapes a genuine C3 TRIM_ROLLED_BACK
 * result can carry:
 *   A — C1 internal rollback: trimResult.finalStatus === 'ROLLED_BACK',
 *       no restore was ever attempted because C1 rolled back within its own
 *       single stage call.
 *   B — post-stage drift + explicit restore: trimResult.finalStatus ===
 *       'STAGED_VERIFIED', a second C1 call (restore) proved via read-back
 *       that it wrote the pre-transaction value back cleanly.
 * Mutually exclusive by construction — trimResult.finalStatus is one string
 * and cannot equal both 'ROLLED_BACK' and 'STAGED_VERIFIED' at once.
 */
function hasValidTrimRolledBackEvidence(r: Record<string, unknown>): boolean {
    const trimResult = r.trimResult;
    if (!isPlainRecord(trimResult) || !isStr(trimResult.finalStatus)) return false;

    const isVariantA = trimResult.finalStatus === 'ROLLED_BACK'
        && r.trimRestoreAttempted === false
        && r.trimRestoredToPreTransaction === false;

    const trimRestoreResult = r.trimRestoreResult;
    const isVariantB = trimResult.finalStatus === 'STAGED_VERIFIED'
        && r.trimRestoreAttempted === true
        && isPlainRecord(trimRestoreResult)
        && trimRestoreResult.finalStatus === 'STAGED_VERIFIED'
        && r.trimRestoredToPreTransaction === true;

    return isVariantA || isVariantB;
}

/** Full runtime validation of a value claiming to be a C3 integration result. */
function validateC3Result(result: unknown): ProductionPolicyOutcome {
    if (!isPlainRecord(result)) return auto('malformed_c3_result_not_object');
    const r = result;

    const requiredBoolFields = [
        'entered', 'stagingExecuted', 'commitExecuted', 'ownershipCommitted',
        'commitFailed', 'legacyFallbackSafe', 'uncertainPresentationState',
    ] as const;
    for (const f of requiredBoolFields) {
        if (!isBool(r[f])) return auto(`malformed_field_${f}`);
    }
    if (!isStr(r.finalStatus) || !isStr(r.finalState)) return auto('malformed_status_or_state');

    switch (r.finalStatus) {
        case 'NOT_ENTERED':
            if (r.entered !== false || r.stagingExecuted !== false || r.commitExecuted !== false
                || r.ownershipCommitted !== false || r.commitFailed !== false
                || r.legacyFallbackSafe !== true || r.uncertainPresentationState !== false) {
                return auto('not_entered_invariant_contradiction');
            }
            return { decision: 'USE_LEGACY', requestAutoDisable: false, reason: 'not_entered' };

        case 'HELD':
            if (r.stagingExecuted !== false || r.commitExecuted !== false || r.ownershipCommitted !== false
                || r.commitFailed !== false || r.legacyFallbackSafe !== true || r.uncertainPresentationState !== false) {
                return auto('held_invariant_contradiction');
            }
            return { decision: 'USE_LEGACY', requestAutoDisable: false, reason: 'held' };

        case 'TRIM_HELD':
            if (r.stagingExecuted !== false || r.commitExecuted !== false || r.ownershipCommitted !== false
                || r.commitFailed !== false || r.legacyFallbackSafe !== true || r.uncertainPresentationState !== false) {
                return auto('trim_held_invariant_contradiction');
            }
            return { decision: 'USE_LEGACY', requestAutoDisable: false, reason: 'trim_held' };

        case 'TRIM_ROLLED_BACK':
            if (r.stagingExecuted !== true || r.commitExecuted !== false || r.ownershipCommitted !== false
                || r.commitFailed !== false || r.legacyFallbackSafe !== true || r.uncertainPresentationState !== false
                || r.finalState !== 'ROLLED_BACK') {
                return auto('trim_rolled_back_invariant_contradiction');
            }
            if (!hasValidTrimRolledBackEvidence(r)) {
                return auto('trim_rolled_back_missing_or_invalid_evidence');
            }
            return { decision: 'USE_LEGACY', requestAutoDisable: false, reason: 'trim_rolled_back' };

        case 'COMMITTED':
            if (r.finalState !== 'FINALIZED' || r.stagingExecuted !== true || r.postStageVerified !== true
                || r.commitExecuted !== true || r.ownershipCommitted !== true || r.commitFailed !== false
                || r.legacyFallbackSafe !== false || r.uncertainPresentationState !== false) {
                return auto('committed_invariant_contradiction');
            }
            return { decision: 'TRANSACTION_COMMITTED', requestAutoDisable: false, reason: 'committed' };

        case 'FAILED_UNCERTAIN':
            // Deliberately not over-restricted: FAILED_UNCERTAIN is reachable
            // both before commit (C1 throw, snapshot extraction failure, C1
            // ROLLBACK_FAILED, post-stage drift restore failure) and after a
            // commit attempt (commit throw/false/malformed, with or without a
            // successful trim restore). Only the three fields the frozen
            // design requires are checked — commitExecuted/commitFailed are
            // deliberately NOT constrained here, since both false-false
            // (pre-commit failure) and true-true (post-commit failure) are
            // legitimate FAILED_UNCERTAIN shapes.
            if (r.uncertainPresentationState !== true || r.legacyFallbackSafe !== false || r.ownershipCommitted !== false) {
                return auto('failed_uncertain_invariant_contradiction');
            }
            return auto(isStr(r.failureReason) ? r.failureReason : 'failed_uncertain');

        default:
            return auto('unrecognized_final_status');
    }
}

/**
 * The single production decision boundary. Never calls legacy itself — it
 * only classifies. The caller (the ON-branch wrapper) is solely responsible
 * for acting on `decision` exactly once.
 */
export function decideProductionWiringAction(outcome: unknown): ProductionPolicyOutcome {
    if (!isPlainRecord(outcome)) {
        // Covers null, arrays, primitives, and functions (typeof 'function' !== 'object').
        return auto('malformed_outcome_not_object');
    }
    if (!isStr(outcome.kind)) return auto('malformed_outcome_missing_kind');

    switch (outcome.kind) {
        case 'CLEAN_PRECONDITION_HOLD': {
            if (!isStr(outcome.reason)) return auto('malformed_clean_hold_reason');
            return { decision: 'USE_LEGACY', requestAutoDisable: false, reason: outcome.reason };
        }
        case 'UNEXPECTED_ATTEMPT_ERROR': {
            if (!isStr(outcome.reason)) return auto('malformed_unexpected_error_reason');
            return auto(outcome.reason);
        }
        case 'C3_RESULT': {
            if (!('result' in outcome)) return auto('malformed_c3_result_outcome_missing_result');
            return validateC3Result(outcome.result);
        }
        default:
            return auto('unrecognized_outcome_kind');
    }
}
