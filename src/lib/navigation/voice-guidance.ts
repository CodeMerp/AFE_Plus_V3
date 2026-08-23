import type { NavigationManeuverType } from './types';

export const NAVIGATION_VOICE_THRESHOLDS_M = [200, 100, 50] as const;
export type NavigationVoiceThresholdM = typeof NAVIGATION_VOICE_THRESHOLDS_M[number];

export type NavigationVoiceEvent =
  | { kind: 'START' }
  | {
      kind: 'MANEUVER_THRESHOLD';
      thresholdM: NavigationVoiceThresholdM;
      instructionText: string;
      maneuverIdentity: string;
    }
  | { kind: 'NEAR_ARRIVAL' }
  | { kind: 'ARRIVED' };

export type VoiceManeuverObservation = {
  type: NavigationManeuverType;
  location: { lat: number; lng: number };
  instructionText: string;
  distanceToManeuverM: number;
};

export type ManeuverThresholdLedger = {
  previousDistanceM: number;
  consumed: Record<NavigationVoiceThresholdM, boolean>;
};

export type NavigationVoiceControllerState = {
  sessionId: string | null;
  lastFreshStartSequence: number;
  nearArrivalConsumed: boolean;
  arrivedConsumed: boolean;
  maneuverPresentationWasOwned: boolean;
  maneuverLedgers: Record<string, ManeuverThresholdLedger>;
};

export type NavigationVoiceControllerInput = {
  sessionId: string | null;
  freshStartSequence: number;
  guidanceAvailable: boolean;
  maneuverPresentationOwned: boolean;
  currentManeuver: VoiceManeuverObservation | null;
  nearArrival: boolean;
  arrived: boolean;
};

export type NavigationVoiceControllerResult = {
  state: NavigationVoiceControllerState;
  event: NavigationVoiceEvent | null;
};

export function createNavigationVoiceControllerState(
  lastFreshStartSequence = 0,
): NavigationVoiceControllerState {
  return {
    sessionId: null,
    lastFreshStartSequence,
    nearArrivalConsumed: false,
    arrivedConsumed: false,
    maneuverPresentationWasOwned: false,
    maneuverLedgers: {},
  };
}

export function maneuverVoiceIdentity(maneuver: Pick<VoiceManeuverObservation, 'type' | 'location'>): string {
  // JSON number serialization preserves the exact JS coordinate values received
  // from the authoritative backend transition. No quantization/tolerance is used.
  return JSON.stringify([maneuver.type, maneuver.location.lat, maneuver.location.lng]);
}

function initialLedger(distanceM: number): ManeuverThresholdLedger {
  return {
    previousDistanceM: distanceM,
    consumed: {
      200: distanceM <= 200,
      100: distanceM <= 100,
      50: distanceM <= 50,
    },
  };
}

function consumeAllThresholds(ledgers: Record<string, ManeuverThresholdLedger>): void {
  for (const ledger of Object.values(ledgers)) {
    ledger.consumed[200] = true;
    ledger.consumed[100] = true;
    ledger.consumed[50] = true;
  }
}

export function advanceNavigationVoiceController(
  previousState: NavigationVoiceControllerState,
  input: NavigationVoiceControllerInput,
): NavigationVoiceControllerResult {
  const sessionChanged = previousState.sessionId !== input.sessionId;
  const state: NavigationVoiceControllerState = sessionChanged
    ? {
        sessionId: input.sessionId,
        lastFreshStartSequence: previousState.lastFreshStartSequence,
        nearArrivalConsumed: false,
        arrivedConsumed: false,
        maneuverPresentationWasOwned: false,
        maneuverLedgers: {},
      }
    : {
        ...previousState,
        maneuverLedgers: Object.fromEntries(
          Object.entries(previousState.maneuverLedgers).map(([identity, ledger]) => [
            identity,
            { ...ledger, consumed: { ...ledger.consumed } },
          ]),
        ),
      };

  let startEvent: NavigationVoiceEvent | null = null;
  if (input.freshStartSequence > state.lastFreshStartSequence) {
    state.lastFreshStartSequence = input.freshStartSequence;
    if (input.sessionId !== null) startEvent = { kind: 'START' };
  }

  let maneuverEvent: NavigationVoiceEvent | null = null;
  const observation = input.currentManeuver;
  if (observation && Number.isFinite(observation.distanceToManeuverM)) {
    const identity = maneuverVoiceIdentity(observation);
    const currentDistanceM = Math.max(0, observation.distanceToManeuverM);
    const existingLedger = state.maneuverLedgers[identity];

    if (!existingLedger) {
      state.maneuverLedgers[identity] = initialLedger(currentDistanceM);
    } else {
      const crossed = NAVIGATION_VOICE_THRESHOLDS_M.filter((thresholdM) => (
        !existingLedger.consumed[thresholdM]
        && existingLedger.previousDistanceM > thresholdM
        && currentDistanceM <= thresholdM
      ));

      for (const thresholdM of crossed) existingLedger.consumed[thresholdM] = true;
      existingLedger.previousDistanceM = currentDistanceM;

      if (
        crossed.length > 0
        && input.guidanceAvailable
        && input.maneuverPresentationOwned
        && state.maneuverPresentationWasOwned
      ) {
        const thresholdM = crossed[crossed.length - 1];
        maneuverEvent = {
          kind: 'MANEUVER_THRESHOLD',
          thresholdM,
          instructionText: observation.instructionText,
          maneuverIdentity: identity,
        };
      }
    }
  }

  let nearArrivalEvent: NavigationVoiceEvent | null = null;
  if (input.nearArrival && !state.nearArrivalConsumed) {
    state.nearArrivalConsumed = true;
    consumeAllThresholds(state.maneuverLedgers);
    nearArrivalEvent = { kind: 'NEAR_ARRIVAL' };
  }

  let arrivedEvent: NavigationVoiceEvent | null = null;
  if (input.arrived && !state.arrivedConsumed) {
    state.arrivedConsumed = true;
    consumeAllThresholds(state.maneuverLedgers);
    arrivedEvent = { kind: 'ARRIVED' };
  }

  state.maneuverPresentationWasOwned = input.maneuverPresentationOwned;

  return {
    state,
    event: arrivedEvent ?? nearArrivalEvent ?? maneuverEvent ?? startEvent,
  };
}
