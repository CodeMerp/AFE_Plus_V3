'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  advanceNavigationVoiceController,
  createNavigationVoiceControllerState,
  type NavigationVoiceControllerInput,
  type NavigationVoiceControllerResult,
  type NavigationVoiceControllerState,
} from '../lib/navigation/voice-guidance';
import {
  createNavigationSpeechDriver,
  navigationVoiceEventText,
  type NavigationSpeechDriver,
} from '../lib/navigation/speech';

export function processNavigationVoiceUpdate(
  state: NavigationVoiceControllerState,
  input: NavigationVoiceControllerInput,
  soundEnabled: boolean,
  speechDriver: NavigationSpeechDriver,
): NavigationVoiceControllerResult {
  const result = advanceNavigationVoiceController(state, input);
  if (result.event && soundEnabled) {
    speechDriver.speak(navigationVoiceEventText(result.event));
  }
  return result;
}

export function applyNavigationSoundState(
  soundEnabled: boolean,
  speechDriver: NavigationSpeechDriver,
): void {
  if (!soundEnabled) speechDriver.cancel();
}

export type UseNavigationVoiceInput = NavigationVoiceControllerInput & {
  soundEnabled: boolean;
  speechDriver?: NavigationSpeechDriver;
};

export function useNavigationVoice(input: UseNavigationVoiceInput): {
  cancelSpeech: () => void;
  speechSupported: boolean;
} {
  const speechDriverRef = useRef<NavigationSpeechDriver | null>(null);
  if (!speechDriverRef.current) {
    speechDriverRef.current = input.speechDriver ?? createNavigationSpeechDriver();
  }
  const speechDriver = speechDriverRef.current;
  const controllerStateRef = useRef(createNavigationVoiceControllerState());
  const previousSessionIdRef = useRef<string | null>(input.sessionId);

  useEffect(() => {
    if (
      previousSessionIdRef.current !== input.sessionId
      || input.sessionId === null
    ) {
      speechDriver.cancel();
    }
    previousSessionIdRef.current = input.sessionId;

    const controllerInput: NavigationVoiceControllerInput = {
      sessionId: input.sessionId,
      freshStartSequence: input.freshStartSequence,
      guidanceAvailable: input.guidanceAvailable,
      maneuverPresentationOwned: input.maneuverPresentationOwned,
      currentManeuver: input.currentManeuver,
      nearArrival: input.nearArrival,
      arrived: input.arrived,
      nowMs: input.nowMs,
    };
    const result = processNavigationVoiceUpdate(
      controllerStateRef.current,
      controllerInput,
      input.soundEnabled,
      speechDriver,
    );
    controllerStateRef.current = result.state;
  }, [
    input.arrived,
    input.currentManeuver,
    input.freshStartSequence,
    input.guidanceAvailable,
    input.maneuverPresentationOwned,
    input.nearArrival,
    input.sessionId,
    input.soundEnabled,
    speechDriver,
  ]);

  useEffect(() => {
    applyNavigationSoundState(input.soundEnabled, speechDriver);
  }, [input.soundEnabled, speechDriver]);

  useEffect(() => () => speechDriver.cancel(), [speechDriver]);

  const cancelSpeech = useCallback(() => speechDriver.cancel(), [speechDriver]);
  return {
    cancelSpeech,
    speechSupported: speechDriver.supported(),
  };
}
