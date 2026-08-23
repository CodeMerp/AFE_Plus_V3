// ─────────────────────────────────────────────────────────────────────────────
// PR2a-1C-C4-B — Controlled Enablement (pure, narrow)
//
// Two small pure helpers used by the compiled ON-branch wiring in
// app/navigation/page.tsx. Neither touches refs, React, or Mapbox — kept
// separate purely so default-OFF behavior and decision-labeling can be
// covered by execution tests instead of source-text regex scanning alone.
// ─────────────────────────────────────────────────────────────────────────────

import type { ProductionPolicyOutcome } from './presentationTransactionProductionPolicy';

/**
 * Compiled-deployment field-test switch decision. Mirrors the
 * TRANSACTION_GATE_COMPILED pattern: the caller passes the raw
 * NEXT_PUBLIC_* build-time value (or undefined) and gets back a boolean.
 * Any value other than the literal string "true" resolves to false —
 * default is OFF whenever the env var is unset or malformed.
 */
export function isFieldTestSwitchEnabled(envValue: string | undefined): boolean {
    return envValue === 'true';
}

export type ProductionFinalDecisionLabel = 'LEGACY_PATH' | 'TRANSACTION_COMMITTED' | 'AUTO_DISABLED';

/**
 * Normalizes an already-validated ProductionPolicyOutcome into a
 * diagnostic-safe label via an exhaustive switch. Reads only `decision`,
 * which is the terminal output of the pure policy boundary
 * (presentationTransactionProductionPolicy.ts) — never touches the
 * pre-validation C3 result or any attemptOutcome field.
 */
export function toFinalDecisionLabel(outcome: ProductionPolicyOutcome): ProductionFinalDecisionLabel {
    switch (outcome.decision) {
        case 'USE_LEGACY':
            return 'LEGACY_PATH';
        case 'TRANSACTION_COMMITTED':
            return 'TRANSACTION_COMMITTED';
        case 'AUTO_DISABLE_NO_FALLBACK':
            return 'AUTO_DISABLED';
    }
}
