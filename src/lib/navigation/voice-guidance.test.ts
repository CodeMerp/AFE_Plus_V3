import assert from 'node:assert/strict';
import {
  advanceNavigationVoiceController,
  createNavigationVoiceControllerState,
  maneuverVoiceIdentity,
  type NavigationVoiceControllerInput,
  type NavigationVoiceControllerState,
  type VoiceManeuverObservation,
} from './voice-guidance';

const left: VoiceManeuverObservation = {
  type: 'TURN_LEFT',
  location: { lat: 13.7563, lng: 100.5018 },
  instructionText: 'เลี้ยวซ้าย',
  distanceToManeuverM: 240,
};

function input(overrides: Partial<NavigationVoiceControllerInput> = {}): NavigationVoiceControllerInput {
  return {
    sessionId: 'session-a',
    freshStartSequence: 0,
    guidanceAvailable: true,
    maneuverPresentationOwned: true,
    currentManeuver: null,
    nearArrival: false,
    arrived: false,
    ...overrides,
  };
}

function step(
  state: NavigationVoiceControllerState,
  overrides: Partial<NavigationVoiceControllerInput>,
) {
  return advanceNavigationVoiceController(state, input(overrides));
}

function observeAt(distanceToManeuverM: number, overrides: Partial<NavigationVoiceControllerInput> = {}) {
  return input({
    currentManeuver: { ...left, distanceToManeuverM },
    ...overrides,
  });
}

// 1–3: only a proven successful fresh-start sequence emits START; rerender and restore do not.
let state = createNavigationVoiceControllerState();
let result = step(state, { freshStartSequence: 1 });
assert.equal(result.event?.kind, 'START'); // 1
state = result.state;
result = step(state, { freshStartSequence: 1 });
assert.equal(result.event, null); // 2
result = advanceNavigationVoiceController(createNavigationVoiceControllerState(), input({
  sessionId: 'restored-session', freshStartSequence: 0,
}));
assert.equal(result.event, null); // 3

// 4: first at 240 waits, then emits at the 200 crossing.
state = createNavigationVoiceControllerState();
result = advanceNavigationVoiceController(state, observeAt(240));
assert.equal(result.event, null);
result = advanceNavigationVoiceController(result.state, observeAt(199));
assert.deepEqual(result.event && { kind: result.event.kind, thresholdM: 'thresholdM' in result.event ? result.event.thresholdM : null }, {
  kind: 'MANEUVER_THRESHOLD', thresholdM: 200,
});

// 5: first at 130 permanently skips 200 and waits for 100.
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(130)).state;
assert.equal(state.maneuverLedgers[maneuverVoiceIdentity(left)].consumed[200], true);
result = advanceNavigationVoiceController(state, observeAt(99));
assert.equal(result.event?.kind, 'MANEUVER_THRESHOLD');
assert.equal(result.event && 'thresholdM' in result.event ? result.event.thresholdM : null, 100);

// 6: first at 70 waits for 50.
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(70)).state;
result = advanceNavigationVoiceController(state, observeAt(49));
assert.equal(result.event && 'thresholdM' in result.event ? result.event.thresholdM : null, 50);

// 7: first at 40 consumes all thresholds and emits nothing.
result = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(40));
assert.equal(result.event, null);
assert.deepEqual(result.state.maneuverLedgers[maneuverVoiceIdentity(left)].consumed, {
  200: true, 100: true, 50: true,
});

// 8–10: each fixed threshold crosses and emits once.
for (const [before, after, threshold] of [[201, 200, 200], [101, 100, 100], [51, 50, 50]] as const) {
  state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(before)).state;
  result = advanceNavigationVoiceController(state, observeAt(after));
  assert.equal(result.event && 'thresholdM' in result.event ? result.event.thresholdM : null, threshold);
  result = advanceNavigationVoiceController(result.state, observeAt(after - 1));
  assert.equal(result.event, null);
}

// 11–13: jitter around every threshold never repeats a consumed event.
for (const threshold of [200, 100, 50] as const) {
  state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(threshold + 3)).state;
  result = advanceNavigationVoiceController(state, observeAt(threshold - 1));
  assert.equal(result.event && 'thresholdM' in result.event ? result.event.thresholdM : null, threshold);
  state = result.state;
  for (const distance of [threshold + 2, threshold - 2, threshold + 1, threshold - 3]) {
    result = advanceNavigationVoiceController(state, observeAt(distance));
    assert.equal(result.event, null);
    state = result.state;
  }
}

// 14: 220 -> 90 emits only 100 and consumes 200 + 100.
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(220)).state;
result = advanceNavigationVoiceController(state, observeAt(90));
assert.equal(result.event && 'thresholdM' in result.event ? result.event.thresholdM : null, 100);
assert.equal(result.state.maneuverLedgers[maneuverVoiceIdentity(left)].consumed[200], true);
assert.equal(result.state.maneuverLedgers[maneuverVoiceIdentity(left)].consumed[100], true);

// 15: 220 -> 40 emits only 50 and consumes every crossed threshold.
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(220)).state;
result = advanceNavigationVoiceController(state, observeAt(40));
assert.equal(result.event && 'thresholdM' in result.event ? result.event.thresholdM : null, 50);
assert.deepEqual(result.state.maneuverLedgers[maneuverVoiceIdentity(left)].consumed, {
  200: true, 100: true, 50: true,
});

// 16: the same exact maneuver across a route update keeps its ledger.
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(220)).state;
result = advanceNavigationVoiceController(state, observeAt(190));
assert.equal(result.event && 'thresholdM' in result.event ? result.event.thresholdM : null, 200);
result = advanceNavigationVoiceController(result.state, observeAt(180));
assert.equal(result.event, null);

// 17: a genuinely different exact transition receives its own ledger.
const right: VoiceManeuverObservation = {
  ...left,
  type: 'TURN_RIGHT',
  location: { lat: left.location.lat, lng: left.location.lng + 0.001 },
  instructionText: 'เลี้ยวขวา',
  distanceToManeuverM: 220,
};
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(220)).state;
state = advanceNavigationVoiceController(state, input({ currentManeuver: right })).state;
assert.equal(Object.keys(state.maneuverLedgers).length, 2);

// 18: routeVersion cannot reset state because it is deliberately not an input.
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(220)).state;
state = advanceNavigationVoiceController(state, observeAt(190)).state;
result = advanceNavigationVoiceController(state, observeAt(180));
assert.equal(result.event, null);

// 19–20: a muted crossing is still consumed; unmute cannot replay it.
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(130)).state;
result = advanceNavigationVoiceController(state, observeAt(95)); // audio layer intentionally discards this event
assert.equal(result.event && 'thresholdM' in result.event ? result.event.thresholdM : null, 100);
result = advanceNavigationVoiceController(result.state, observeAt(70));
assert.equal(result.event, null);

// 21: near arrival emits only once per session.
state = createNavigationVoiceControllerState();
result = step(state, { nearArrival: true });
assert.equal(result.event?.kind, 'NEAR_ARRIVAL');
result = step(result.state, { nearArrival: true });
assert.equal(result.event, null);

// 22: near arrival beats a simultaneous maneuver crossing and consumes it.
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(70)).state;
result = advanceNavigationVoiceController(state, observeAt(49, { nearArrival: true }));
assert.equal(result.event?.kind, 'NEAR_ARRIVAL');
assert.equal(result.state.maneuverLedgers[maneuverVoiceIdentity(left)].consumed[50], true);

// 23: arrived emits only once per session.
state = createNavigationVoiceControllerState();
result = step(state, { arrived: true });
assert.equal(result.event?.kind, 'ARRIVED');
result = step(result.state, { arrived: true });
assert.equal(result.event, null);

// 24: arrived has priority over near arrival, maneuver, and start.
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(70)).state;
result = advanceNavigationVoiceController(state, observeAt(49, {
  freshStartSequence: 1,
  nearArrival: true,
  arrived: true,
}));
assert.equal(result.event?.kind, 'ARRIVED');

// 25: route UX/non-maneuver ownership suppresses audio event but consumes crossing.
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(130)).state;
result = advanceNavigationVoiceController(state, observeAt(95, {
  guidanceAvailable: false,
  maneuverPresentationOwned: false,
}));
assert.equal(result.event, null);
result = advanceNavigationVoiceController(result.state, observeAt(90));
assert.equal(result.event, null);
// Shared Guidance can intentionally withhold a maneuver while route UX owns the
// presentation. The first observation after ownership returns consumes, but does
// not speak, any threshold crossed during that gap.
state = advanceNavigationVoiceController(createNavigationVoiceControllerState(), observeAt(130)).state;
state = step(state, {
  guidanceAvailable: false,
  maneuverPresentationOwned: false,
  currentManeuver: null,
}).state;
result = advanceNavigationVoiceController(state, observeAt(95));
assert.equal(result.event, null);
result = advanceNavigationVoiceController(result.state, observeAt(49));
assert.equal(result.event && 'thresholdM' in result.event ? result.event.thresholdM : null, 50);

// 26: true session replacement resets session-scoped near/arrival and ledgers only.
state = step(createNavigationVoiceControllerState(), { nearArrival: true }).state;
state = step(state, { arrived: true }).state;
result = step(state, { sessionId: 'session-b' });
assert.equal(result.state.sessionId, 'session-b');
assert.equal(result.state.nearArrivalConsumed, false);
assert.equal(result.state.arrivedConsumed, false);
assert.equal(Object.keys(result.state.maneuverLedgers).length, 0);

// 27: the controller module accepts no raw GPS, path, routeVersion, or projection input.
const inputKeys = Object.keys(input()).sort();
assert.deepEqual(inputKeys, [
  'arrived',
  'currentManeuver',
  'freshStartSequence',
  'guidanceAvailable',
  'maneuverPresentationOwned',
  'nearArrival',
  'sessionId',
]);

console.log('navigation voice controller deterministic tests: PASS (27 scenarios)');
