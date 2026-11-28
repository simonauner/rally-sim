import type { Lang, PaceNote } from './physics/pacenotes';
import { settings } from './settings';

/** The co-driver's voice via the browser's built-in speech synthesis; no audio files. */
export class CoDriver {
  private voice: SpeechSynthesisVoice | null = null;
  /** true when the browser has loaded its voices but none of them is Swedish or English. */
  missingVoice = false;

  constructor() {
    if (!('speechSynthesis' in window)) {
      this.missingVoice = true;
      return;
    }
    // Voices load asynchronously; the list can be empty until voiceschanged has fired.
    this.pickVoice();
    speechSynthesis.addEventListener('voiceschanged', () => this.pickVoice());
  }

  private pickVoice() {
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) return;
    const find = (lang: Lang) => {
      const all = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang));
      return all.find((v) => v.localService) ?? all[0];
    };
    // Without a Swedish voice the notes are read in English, with an English voice.
    this.voice = find('sv') ?? find('en') ?? null;
    this.missingVoice = !this.voice;
  }

  say(notes: PaceNote[]) {
    if (!settings.voice) return;
    if (!this.voice) this.pickVoice();
    // Without a voice the browser reads with its default voice in the wrong language. Better silent.
    if (!this.voice) return;
    const lang: Lang = this.voice.lang.toLowerCase().startsWith('sv') ? 'sv' : 'en';
    const u = new SpeechSynthesisUtterance(notes.map((n) => n.speech[lang]).join(', '));
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.rate = 1.25;
    speechSynthesis.speak(u);
  }

  /** Silences anything queued, e.g. on restart. */
  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
