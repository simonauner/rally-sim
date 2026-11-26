import type { Lang, PaceNote } from './physics/pacenotes';

/** Kartläsarens röst via webbläsarens inbyggda talsyntes; inga ljudfiler. */
export class CoDriver {
  private voice: SpeechSynthesisVoice | null = null;
  /** true när webbläsaren har laddat sina röster men ingen av dem är svensk eller engelsk. */
  missingVoice = false;

  constructor() {
    if (!('speechSynthesis' in window)) {
      this.missingVoice = true;
      return;
    }
    // Rösterna laddas asynkront; listan kan vara tom tills voiceschanged har kommit.
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
    // Utan svensk röst läses noterna på engelska, med engelsk röst.
    this.voice = find('sv') ?? find('en') ?? null;
    this.missingVoice = !this.voice;
  }

  say(notes: PaceNote[]) {
    if (!this.voice) this.pickVoice();
    // Utan röst läser webbläsaren med sin standardröst på fel språk. Hellre tyst.
    if (!this.voice) return;
    const lang: Lang = this.voice.lang.toLowerCase().startsWith('sv') ? 'sv' : 'en';
    const u = new SpeechSynthesisUtterance(notes.map((n) => n.speech[lang]).join(', '));
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.rate = 1.25;
    speechSynthesis.speak(u);
  }

  /** Tystar det som köats, t.ex. vid omstart. */
  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
