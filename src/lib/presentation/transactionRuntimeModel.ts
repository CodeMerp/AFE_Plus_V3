// ----------------------------------------------------------------------------
// PR2a-1C-A - Real Route/Trim Transaction Runtime Model (INERT, PURE)
//
// This module defines only data types and deterministic helpers for a FUTURE
// route/trim transaction runtime. PR2a-1C-A wires none of these helpers into
// navigation runtime: no React, no Mapbox, no DOM, no refs, no callbacks, no
// mutation helpers, and no production branch consumes these results.
// ----------------------------------------------------------------------------

import type { PresentationTransactionPhase } from './presentationModel.ts';

export type PresentationTransactionRuntimeState =
    | 'DISABLED'
    | 'IDLE'
    | 'PREPARING'
    | 'VALIDATING'
    | 'SNAPSHOTTING'
    | 'SOURCE_BASIS_PREPARED'
    | 'SOURCE_BASIS_VERIFIED'
    | 'STAGING_TRIM'
    | 'VERIFYING_STAGE'
    | 'COMMITTING_FRONTEND'
    | 'OBSERVING_P1'
    | 'OBSERVING_P2'
    | 'OBSERVING_P3'
    | 'FINALIZED'
    | 'HELD'
    | 'ROLLING_BACK'
    | 'ROLLED_BACK'
    | 'AUTO_DISABLED'
    | 'DEGRADED_PRESENTATION';

export const PRESENTATION_TRANSACTION_RUNTIME_STATES: readonly PresentationTransactionRuntimeState[] = [
    'DISABLED',
    'IDLE',
    'PREPARING',
    'VALIDATING',
    'SNAPSHOTTING',
    'SOURCE_BASIS_PREPARED',
    'SOURCE_BASIS_VERIFIED',
    'STAGING_TRIM',
    'VERIFYING_STAGE',
    'COMMITTING_FRONTEND',
    'OBSERVING_P1',
    'OBSERVING_P2',
    'OBSERVING_P3',
    'FINALIZED',
    'HELD',
    'ROLLING_BACK',
    'ROLLED_BACK',
    'AUTO_DISABLED',
    'DEGRADED_PRESENTATION',
] as const;

export interface PresentationTransactionGateSnapshotInput {
    generation: number;
    buildCapabilityEnabled: boolean;
    fieldTestSwitchEnabled: boolean;
    sessionAutoDisabled: boolean;
}

export interface PresentationTransactionGateSnapshot {
    generation: number;
    buildCapabilityEnabled: boolean;
    fieldTestSwitchEnabled: boolean;
    sessionAutoDisabled: boolean;
    gateOpen: boolean;
    disabledReason: 'build_capability_disabled' | 'field_test_switch_disabled' | 'session_auto_disabled' | null;
}

export interface PresentationTransactionGeneration {
    generation: number;
    gateSnapshot: PresentationTransactionGateSnapshot;
}

export type PresentationTransactionResultKind =
    | 'TRANSACTION_COMMITTED'
    | 'TRANSACTION_HELD_USE_LEGACY'
    | 'TRANSACTION_ROLLED_BACK_USE_LEGACY'
    | 'TRANSACTION_AUTO_DISABLED_NO_FALLBACK'
    | 'TRANSACTION_DEGRADED_USE_LEGACY';

export interface PresentationTransactionResult {
    generation: number;
    resultKind: PresentationTransactionResultKind;
    runtimeState: PresentationTransactionRuntimeState;
    diagnosticPhase: PresentationTransactionPhase;
    reason: string | null;
}

export interface PresentationTransactionRuntimeTransitionResult {
    from: PresentationTransactionRuntimeState;
    to: PresentationTransactionRuntimeState;
    allowed: boolean;
    state: PresentationTransactionRuntimeState;
}

const RUNTIME_TRANSITIONS: Readonly<Record<PresentationTransactionRuntimeState, readonly PresentationTransactionRuntimeState[]>> = {
    DISABLED: ['IDLE'],
    IDLE: ['DISABLED', 'PREPARING', 'AUTO_DISABLED'],
    PREPARING: ['VALIDATING', 'HELD', 'AUTO_DISABLED'],
    VALIDATING: ['SNAPSHOTTING', 'HELD', 'DEGRADED_PRESENTATION', 'AUTO_DISABLED'],
    SNAPSHOTTING: ['SOURCE_BASIS_PREPARED', 'HELD', 'ROLLING_BACK', 'AUTO_DISABLED'],
    SOURCE_BASIS_PREPARED: ['SOURCE_BASIS_VERIFIED', 'ROLLING_BACK', 'AUTO_DISABLED'],
    SOURCE_BASIS_VERIFIED: ['STAGING_TRIM', 'ROLLING_BACK', 'AUTO_DISABLED'],
    STAGING_TRIM: ['VERIFYING_STAGE', 'ROLLING_BACK', 'AUTO_DISABLED'],
    VERIFYING_STAGE: ['COMMITTING_FRONTEND', 'ROLLING_BACK', 'AUTO_DISABLED'],
    COMMITTING_FRONTEND: ['OBSERVING_P1', 'FINALIZED', 'AUTO_DISABLED'],
    OBSERVING_P1: ['OBSERVING_P2', 'FINALIZED', 'AUTO_DISABLED'],
    OBSERVING_P2: ['OBSERVING_P3', 'FINALIZED', 'AUTO_DISABLED'],
    OBSERVING_P3: ['FINALIZED', 'AUTO_DISABLED'],
    FINALIZED: ['IDLE'],
    HELD: ['IDLE'],
    ROLLING_BACK: ['ROLLED_BACK', 'AUTO_DISABLED'],
    ROLLED_BACK: ['IDLE'],
    AUTO_DISABLED: ['DISABLED'],
    DEGRADED_PRESENTATION: ['IDLE'],
} as const;

export function createPresentationTransactionGateSnapshot(
    input: PresentationTransactionGateSnapshotInput,
): PresentationTransactionGateSnapshot {
    let disabledReason: PresentationTransactionGateSnapshot['disabledReason'] = null;
    if (!input.buildCapabilityEnabled) disabledReason = 'build_capability_disabled';
    else if (!input.fieldTestSwitchEnabled) disabledReason = 'field_test_switch_disabled';
    else if (input.sessionAutoDisabled) disabledReason = 'session_auto_disabled';

    return {
        generation: input.generation,
        buildCapabilityEnabled: input.buildCapabilityEnabled,
        fieldTestSwitchEnabled: input.fieldTestSwitchEnabled,
        sessionAutoDisabled: input.sessionAutoDisabled,
        gateOpen: disabledReason === null,
        disabledReason,
    };
}

export function isPresentationTransactionGateOpen(snapshot: PresentationTransactionGateSnapshot): boolean {
    return snapshot.gateOpen;
}

export function canTransitionPresentationTransactionRuntimeState(
    from: PresentationTransactionRuntimeState,
    to: PresentationTransactionRuntimeState,
): boolean {
    return RUNTIME_TRANSITIONS[from].includes(to);
}

export function transitionPresentationTransactionRuntimeState(
    from: PresentationTransactionRuntimeState,
    to: PresentationTransactionRuntimeState,
): PresentationTransactionRuntimeTransitionResult {
    const allowed = canTransitionPresentationTransactionRuntimeState(from, to);
    return {
        from,
        to,
        allowed,
        state: allowed ? to : from,
    };
}

export function mapPresentationTransactionRuntimeStateToPhase(
    state: PresentationTransactionRuntimeState,
): PresentationTransactionPhase {
    switch (state) {
        case 'DISABLED':
        case 'IDLE':
            return 'IDLE';
        case 'PREPARING':
            return 'PREPARE';
        case 'VALIDATING':
            return 'VALIDATE';
        case 'SNAPSHOTTING':
            return 'SNAPSHOT_CURRENT';
        case 'SOURCE_BASIS_PREPARED':
        case 'SOURCE_BASIS_VERIFIED':
        case 'STAGING_TRIM':
            return 'STAGE_MAPBOX';
        case 'VERIFYING_STAGE':
            return 'VERIFY_STAGE';
        case 'COMMITTING_FRONTEND':
            return 'COMMIT_FRONTEND';
        case 'OBSERVING_P1':
            return 'POST_RENDER_P1';
        case 'OBSERVING_P2':
            return 'POST_RENDER_P2';
        case 'OBSERVING_P3':
            return 'POST_RENDER_P3';
        case 'FINALIZED':
            return 'FINALIZED';
        case 'HELD':
            return 'HELD';
        case 'ROLLING_BACK':
        case 'ROLLED_BACK':
            return 'ROLLED_BACK';
        case 'AUTO_DISABLED':
            return 'AUTO_DISABLED';
        case 'DEGRADED_PRESENTATION':
            return 'DEGRADED_PRESENTATION';
        default: {
            const exhaustive: never = state;
            return exhaustive;
        }
    }
}
