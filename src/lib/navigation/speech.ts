import type { NavigationVoiceEvent } from './voice-guidance';

export type SpeechVoiceLike = { lang: string };

export type SpeechUtteranceLike = {
  text: string;
  lang: string;
  voice: SpeechVoiceLike | null;
  onstart?: () => void;
  onend?: () => void;
  onerror?: (e: any) => void;
};

export type SpeechSynthesisLike = {
  getVoices: () => SpeechVoiceLike[];
  speak: (utterance: SpeechUtteranceLike) => void;
  cancel: () => void;
  speaking?: boolean;
  pending?: boolean;
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
  let speakGeneration = 0;

  const supported = () => Boolean(
    environment?.speechSynthesis
    && environment.SpeechSynthesisUtterance,
  );

  const cancel = () => {
    speakGeneration++; // invalidate any pending retries
    if (!supported()) return;
    try {
      environment?.speechSynthesis?.cancel();
    } catch {
      // Browser speech is optional
    }
  };

  const speak = (text: string) => {
    if (!supported() || !environment?.speechSynthesis || !environment.SpeechSynthesisUtterance) return;
    try {
      speakGeneration++;
      const currentGen = speakGeneration;

      const attemptSpeak = () => {
        if (currentGen !== speakGeneration) return; // superseded

        const utterance = new environment.SpeechSynthesisUtterance!(text);
        utterance.lang = 'th-TH';
        const thaiVoice = selectThaiVoice(environment.speechSynthesis!.getVoices());
        if (thaiVoice) utterance.voice = thaiVoice;

        let started = false;
        utterance.onstart = () => { started = true; };
        utterance.onerror = () => {
          // If the utterance errors before starting, it was likely erased by an async WebKit cancel().
          // We safely retry it if this generation is still the active owner.
          if (!started && currentGen === speakGeneration) {
            Promise.resolve().then(attemptSpeak);
          }
        };

        environment.speechSynthesis!.speak(utterance);
      };

      environment.speechSynthesis.cancel();
      
      attemptSpeak();
    } catch {
      // Unsupported/partial implementations fail silently
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
    case 'CONTINUE_STRAIGHT':
      return 'ขับตรงไปตามเส้นทาง';
    case 'NEAR_ARRIVAL':
      return 'ใกล้ถึงจุดหมายแล้ว';
    case 'ARRIVED':
      return 'ถึงจุดหมายแล้ว';
  }
}
