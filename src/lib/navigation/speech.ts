import type { NavigationVoiceEvent } from './voice-guidance';

export type SpeechVoiceLike = { lang: string };

export type SpeechUtteranceLike = {
  text: string;
  lang: string;
  voice: SpeechVoiceLike | null;
};

export type SpeechSynthesisLike = {
  getVoices: () => SpeechVoiceLike[];
  speak: (utterance: SpeechUtteranceLike) => void;
  cancel: () => void;
};

export type SpeechEnvironment = {
  speechSynthesis?: SpeechSynthesisLike;
  SpeechSynthesisUtterance?: new (text: string) => SpeechUtteranceLike;
};

export type NavigationSpeechDriver = {
  supported: () => boolean;
  speak: (text: string) => void;
  cancel: () => void;
};

function browserSpeechEnvironment(): SpeechEnvironment | undefined {
  if (typeof window === 'undefined') return undefined;
  return window as unknown as SpeechEnvironment;
}

export function selectThaiVoice(voices: SpeechVoiceLike[]): SpeechVoiceLike | null {
  const exact = voices.find((voice) => voice.lang.toLowerCase() === 'th-th');
  return exact ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('th')) ?? null;
}

export function createNavigationSpeechDriver(
  environment: SpeechEnvironment | undefined = browserSpeechEnvironment(),
): NavigationSpeechDriver {
  const supported = () => Boolean(
    environment?.speechSynthesis
    && environment.SpeechSynthesisUtterance,
  );

  const cancel = () => {
    if (!supported()) return;
    try {
      environment?.speechSynthesis?.cancel();
    } catch {
      // Browser speech is optional; navigation must continue if the API fails.
    }
  };

  const speak = (text: string) => {
    if (!supported() || !environment?.speechSynthesis || !environment.SpeechSynthesisUtterance) return;
    try {
      const utterance = new environment.SpeechSynthesisUtterance(text);
      utterance.lang = 'th-TH';
      const thaiVoice = selectThaiVoice(environment.speechSynthesis.getVoices());
      if (thaiVoice) utterance.voice = thaiVoice;

      // Navigation events supersede stale queued/current guidance.
      environment.speechSynthesis.cancel();
      environment.speechSynthesis.speak(utterance);
    } catch {
      // Unsupported/partial browser implementations fail silently by policy.
    }
  };

  return { supported, speak, cancel };
}

export function navigationVoiceEventText(event: NavigationVoiceEvent): string {
  switch (event.kind) {
    case 'START':
      return 'เริ่มนำทาง';
    case 'MANEUVER_THRESHOLD':
      return `อีก ${event.thresholdM} เมตร ${event.instructionText}`;
    case 'NEAR_ARRIVAL':
      return 'ใกล้ถึงจุดหมายแล้ว';
    case 'ARRIVED':
      return 'ถึงจุดหมายแล้ว';
  }
}
