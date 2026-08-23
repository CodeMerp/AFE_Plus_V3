import assert from 'node:assert/strict';
import { navigationManeuverInstruction } from '../../hooks/useNavigationGuidance';
import { applyNavigationSoundState, processNavigationVoiceUpdate } from '../../hooks/useNavigationVoice';
import {
  createNavigationVoiceControllerState,
  type NavigationVoiceControllerInput,
  type NavigationVoiceEvent,
} from './voice-guidance';
import {
  createNavigationSpeechDriver,
  navigationVoiceEventText,
  type NavigationSpeechDriver,
  type SpeechEnvironment,
  type SpeechUtteranceLike,
  type SpeechVoiceLike,
} from './speech';

class MockUtterance implements SpeechUtteranceLike {
  lang = '';
  voice: SpeechVoiceLike | null = null;

  constructor(public text: string) {}
}

function createMockEnvironment(voices: SpeechVoiceLike[] = []) {
  const spoken: SpeechUtteranceLike[] = [];
  let cancelCount = 0;
  const environment: SpeechEnvironment = {
    SpeechSynthesisUtterance: MockUtterance,
    speechSynthesis: {
      getVoices: () => voices,
      speak: (utterance) => spoken.push(utterance),
      cancel: () => { cancelCount += 1; },
    },
  };
  return { environment, spoken, getCancelCount: () => cancelCount };
}

function controllerInput(
  distanceToManeuverM: number | null,
  overrides: Partial<NavigationVoiceControllerInput> = {},
): NavigationVoiceControllerInput {
  return {
    sessionId: 'session-a',
    freshStartSequence: 0,
    guidanceAvailable: true,
    maneuverPresentationOwned: true,
    currentManeuver: distanceToManeuverM === null ? null : {
      type: 'TURN_LEFT',
      location: { lat: 13.75, lng: 100.5 },
      instructionText: navigationManeuverInstruction('TURN_LEFT'),
      distanceToManeuverM,
    },
    nearArrival: false,
    arrived: false,
    ...overrides,
  };
}

function recordingDriver(): NavigationSpeechDriver & { spoken: string[]; cancelCount: () => number } {
  const spoken: string[] = [];
  let cancels = 0;
  return {
    supported: () => true,
    speak: (text) => spoken.push(text),
    cancel: () => { cancels += 1; },
    spoken,
    cancelCount: () => cancels,
  };
}

// 1: exact th-TH is preferred over another Thai system voice.
let mock = createMockEnvironment([{ lang: 'th' }, { lang: 'th-TH' }, { lang: 'en-US' }]);
let driver = createNavigationSpeechDriver(mock.environment);
driver.speak('ทดสอบ');
assert.equal(mock.spoken[0].voice?.lang, 'th-TH');

// 2: an empty voice list retains the required th-TH utterance fallback.
mock = createMockEnvironment([]);
driver = createNavigationSpeechDriver(mock.environment);
driver.speak('ทดสอบ');
assert.equal(mock.spoken[0].lang, 'th-TH');
assert.equal(mock.spoken[0].voice, null);
// A later browser voiceschanged population is observed by the next event only;
// the adapter never replays the already-spoken fallback utterance.
const laterVoices: SpeechVoiceLike[] = [];
mock = createMockEnvironment(laterVoices);
driver = createNavigationSpeechDriver(mock.environment);
driver.speak('ก่อนโหลดเสียง');
laterVoices.push({ lang: 'th-TH' });
driver.speak('หลังโหลดเสียง');
assert.equal(mock.spoken.length, 2);
assert.equal(mock.spoken[1].voice?.lang, 'th-TH');

// 3: unsupported/partial browser speech APIs are silent and never throw.
const unsupported = createNavigationSpeechDriver(undefined);
assert.equal(unsupported.supported(), false);
assert.doesNotThrow(() => unsupported.speak('ทดสอบ'));
assert.doesNotThrow(() => unsupported.cancel());

// 4: START exact text.
assert.equal(navigationVoiceEventText({ kind: 'START' }), 'เริ่มนำทาง');

// 5–7: exact fixed-threshold maneuver text.
for (const thresholdM of [200, 100, 50] as const) {
  assert.equal(navigationVoiceEventText({
    kind: 'MANEUVER_THRESHOLD',
    thresholdM,
    instructionText: 'เลี้ยวซ้าย',
    maneuverIdentity: 'test',
  }), `อีก ${thresholdM} เมตร เลี้ยวซ้าย`);
}

// 8: slight wording is imported from Shared Guidance, not remapped by speech.
assert.equal(navigationVoiceEventText({
  kind: 'MANEUVER_THRESHOLD',
  thresholdM: 100,
  instructionText: navigationManeuverInstruction('SLIGHT_RIGHT'),
  maneuverIdentity: 'test',
}), 'อีก 100 เมตร เบี่ยงขวา');

// 9: U-turn wording also comes from Shared Guidance.
assert.equal(navigationVoiceEventText({
  kind: 'MANEUVER_THRESHOLD',
  thresholdM: 50,
  instructionText: navigationManeuverInstruction('UTURN'),
  maneuverIdentity: 'test',
}), 'อีก 50 เมตร กลับรถ');

// 10–11: near-arrival and arrived exact text.
assert.equal(navigationVoiceEventText({ kind: 'NEAR_ARRIVAL' }), 'ใกล้ถึงจุดหมายแล้ว');
assert.equal(navigationVoiceEventText({ kind: 'ARRIVED' }), 'ถึงจุดหมายแล้ว');

// 12: every new speech cancels the stale queue before speaking.
mock = createMockEnvironment([{ lang: 'th-TH' }]);
driver = createNavigationSpeechDriver(mock.environment);
driver.speak('หนึ่ง');
driver.speak('สอง');
assert.equal(mock.getCancelCount(), 2);
assert.deepEqual(mock.spoken.map((utterance) => utterance.text), ['หนึ่ง', 'สอง']);

// 13: mute calls cancel.
const output = recordingDriver();
applyNavigationSoundState(false, output);
assert.equal(output.cancelCount(), 1);

// 14–15: a threshold crossed while muted advances state without speech;
// unmuting at the same/lower distance does not replay it.
let state = createNavigationVoiceControllerState();
let update = processNavigationVoiceUpdate(state, controllerInput(130), false, output);
update = processNavigationVoiceUpdate(update.state, controllerInput(95), false, output);
assert.equal(update.event && 'thresholdM' in update.event ? update.event.thresholdM : null, 100);
assert.deepEqual(output.spoken, []);
update = processNavigationVoiceUpdate(update.state, controllerInput(70), true, output);
assert.equal(update.event, null);
assert.deepEqual(output.spoken, []);

// 16–17: ARRIVED is emitted/spoken once; one controller/adapter owns the text.
state = createNavigationVoiceControllerState();
update = processNavigationVoiceUpdate(state, controllerInput(null, { arrived: true }), true, output);
assert.equal(output.spoken.at(-1), 'ถึงจุดหมายแล้ว');
const arrivalSpeechCount = output.spoken.filter((text) => text === 'ถึงจุดหมายแล้ว').length;
update = processNavigationVoiceUpdate(update.state, controllerInput(null, { arrived: true }), true, output);
assert.equal(output.spoken.filter((text) => text === 'ถึงจุดหมายแล้ว').length, arrivalSpeechCount);

// 18: same exact maneuver across route updates cannot repeat a consumed threshold.
const routeOutput = recordingDriver();
state = processNavigationVoiceUpdate(
  createNavigationVoiceControllerState(), controllerInput(220), true, routeOutput,
).state;
update = processNavigationVoiceUpdate(state, controllerInput(190), true, routeOutput);
assert.equal(routeOutput.spoken.length, 1);
update = processNavigationVoiceUpdate(update.state, controllerInput(180), true, routeOutput);
assert.equal(routeOutput.spoken.length, 1);

// 19: Target polling is not a controller input and therefore cannot reset voice.
assert.equal('target' in controllerInput(180), false);
assert.equal('routeVersion' in controllerInput(180), false);

// 20: incompatible handoff (no Shared Guidance maneuver/ownership) cannot speak.
const handoffOutput = recordingDriver();
update = processNavigationVoiceUpdate(
  createNavigationVoiceControllerState(),
  controllerInput(null, {
    guidanceAvailable: false,
    maneuverPresentationOwned: false,
  }),
  true,
  handoffOutput,
);
assert.equal(update.event, null);
assert.deepEqual(handoffOutput.spoken, []);

// Compile-time guard: all formatter inputs are NavigationVoiceEvent variants.
const eventTypeGuard: NavigationVoiceEvent = { kind: 'START' };
assert.equal(navigationVoiceEventText(eventTypeGuard), 'เริ่มนำทาง');

console.log('browser navigation speech deterministic tests: PASS (20 scenarios)');
