/** Kartläsarens röst via webbläsarens inbyggda talsyntes; inga ljudfiler. */
export class CoDriver {
  private voice: SpeechSynthesisVoice | null = null;
  /** true när webbläsaren har laddat sina röster men ingen av dem är svensk. */
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
    const sv = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('sv'));
    this.voice = sv.find((v) => v.localService) ?? sv[0] ?? null;
    this.missingVoice = !this.voice;
  }

  say(text: string) {
    if (!this.voice) this.pickVoice();
    // Utan svensk röst läser webbläsaren med sin standardröst, oftast engelska. Hellre tyst.
    if (!this.voice) return;
    const u = new SpeechSynthesisUtterance(text);
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
