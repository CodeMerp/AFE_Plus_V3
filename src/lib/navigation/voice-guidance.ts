import type { NavigationManeuverType } from './types';

export const NAVIGATION_VOICE_THRESHOLDS_M = [200, 100, 50] as const;

/** Repeat interval for the long-stretch reassurance cue. */
export const NAVIGATION_VOICE_STRAIGHT_INTERVAL_MS = 120_000;
/** Only reassure when the next turn is at least this far away. */
export const NAVIGATION_VOICE_STRAIGHT_MIN_CLEAR_M = 400;
export type NavigationVoiceThresholdM = typeof NAVIGATION_VOICE_THRESHOLDS_M[number];

export type NavigationVoiceEvent =
  | { kind: 'START' }
  | {
      kind: 'MANEUVER_THRESHOLD';
      thresholdM: NavigationVoiceThresholdM;
      instructionText: string;
      maneuverIdentity: string;
    }
  | { kind: 'CONTINUE_STRAIGHT' }
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
  lastStraightAtMs: number | null;
};

export type NavigationVoiceControllerInput = {
  sessionId: string | null;
  freshStartSequence: number;
  guidanceAvailable: boolean;
  maneuverPresentationOwned: boolean;
  currentManeuver: VoiceManeuverObservation | null;
  nearArrival: boolean;
  arrived: boolean;
  /** Monotonic clock for the straight-ahead cue. Optional so existing
   *  deterministic suites and callers that do not use the cue compile
   *  unchanged; omitting it simply never arms the interval. */
  nowMs?: number;
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
    lastStraightAtMs: null,
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
        lastStraightAtMs: null,
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
      // A threshold is DUE while the agent is at or inside it and it has not
      // been announced yet. Previously this used a strict crossing test
      // (previous > t && current <= t) and marked the threshold consumed
      // BEFORE the eligibility gate below — so a single frame in which
      // guidance/presentation ownership dipped at the crossing instant
      // swallowed that warning permanently while the top bar kept showing the
      // turn. Thresholds already passed when the maneuver was first seen stay
      // pre-consumed by initialLedger, so this never announces a turn the
      // agent had already driven past.
      const due = NAVIGATION_VOICE_THRESHOLDS_M.filter((thresholdM) => (
        !existingLedger.consumed[thresholdM]
        && currentDistanceM <= thresholdM
      ));

      existingLedger.previousDistanceM = currentDistanceM;

      if (
        due.length > 0
        && input.guidanceAvailable
        && input.maneuverPresentationOwned
        && state.maneuverPresentationWasOwned
      ) {
        // Consume only what is actually announced; the smallest due threshold
        // wins and the coarser ones it overtook are consumed with it.
        for (const thresholdM of due) existingLedger.consumed[thresholdM] = true;
        const thresholdM = due[due.length - 1];
        maneuverEvent = {
          kind: 'MANEUVER_THRESHOLD',
          thresholdM,
          instructionText: observation.instructionText,
          maneuverIdentity: identity,
        };
      }
    }
  }

  // Long clear stretch reassurance. Eligible only while guidance owns the
  // presentation and the next turn (if any) is comfortably far away.
  let straightEvent: NavigationVoiceEvent | null = null;
  const distanceToNextTurnM = observation && Number.isFinite(observation.distanceToManeuverM)
    ? Math.max(0, observation.distanceToManeuverM)
    : Infinity;
  const roadAhead = input.guidanceAvailable
    && input.maneuverPresentationOwned
    && distanceToNextTurnM >= NAVIGATION_VOICE_STRAIGHT_MIN_CLEAR_M;
  if (roadAhead && !input.nearArrival && !input.arrived) {
    const nowMs = input.nowMs;
    const dueAt = state.lastStraightAtMs === null
      ? null
      : state.lastStraightAtMs + NAVIGATION_VOICE_STRAIGHT_INTERVAL_MS;
    if (nowMs !== undefined && (dueAt === null || nowMs >= dueAt)) {
      state.lastStraightAtMs = nowMs;
      // The very first evaluation only arms the interval; it does not speak,
      // so START is never immediately followed by a straight-ahead cue.
      if (dueAt !== null) straightEvent = { kind: 'CONTINUE_STRAIGHT' };
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
    event: arrivedEvent ?? nearArrivalEvent ?? maneuverEvent ?? startEvent ?? straightEvent,
  };
}
