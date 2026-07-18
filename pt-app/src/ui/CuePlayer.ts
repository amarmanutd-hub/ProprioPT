/**
 * Plays pre-recorded coaching clips via HTMLAudioElement so output follows
 * AirPods / system media route (unlike speechSynthesis on many browsers).
 *
 * Form cues (valgus / depth / trunk) always cut through. Everything else stays calm.
 */

const BASE = `${import.meta.env.BASE_URL}cues/`;

/** Higher wins if something is already speaking. */
export type CuePriority = 0 | 1 | 2 | 3;

const PRIORITY: Record<string, CuePriority> = {
  unlock: 0,
  "cam-on": 0,
  "audio-on": 0,
  "calib-stand": 0,
  "calib-closer": 0,
  "calib-joints": 0,
  "calib-hold": 0,
  "calib-ready": 1,
  "calib-fail": 1,
  halt: 2,
  resume: 1,
  "phase-down": 1,
  "phase-depth": 1,
  "rep-1": 2,
  "rep-2": 2,
  "rep-3": 2,
  "rep-4": 2,
  "rep-5": 2,
  "rep-6": 2,
  "rep-7": 2,
  "rep-8": 2,
  "rep-9": 2,
  "rep-10": 2,
  "session-done": 2,
  valgus: 3,
  trunk: 3,
  incompleteDepth: 3,
  overFlexion: 3,
};

const MIN_GAP_MS = 2800;
const SAME_KEY_MS = 5500;
const FORM_SAME_KEY_MS = 2800;

export class CuePlayer {
  private muted = false;
  private unlocked = false;
  private lastKey = "";
  private lastAt = 0;
  private playing = false;
  private playingPriority: CuePriority = 0;
  private pending: string | null = null;
  private current: HTMLAudioElement | null = null;
  private readonly cache = new Map<string, HTMLAudioElement>();

  /** Call from a click/tap so mobile browsers allow playback. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    const warm = this.getAudio("unlock");
    if (!warm) return;
    warm.volume = 0.001;
    void warm
      .play()
      .then(() => {
        warm.pause();
        warm.currentTime = 0;
        warm.volume = 1;
      })
      .catch(() => {
        warm.volume = 1;
      });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.pending = null;
      this.stop();
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  speak(key: string): void {
    void this.playKey(key);
  }

  speakRep(n: number): void {
    if (n >= 1 && n <= 10) void this.playKey(`rep-${n}`);
  }

  private stop(): void {
    if (!this.current) {
      this.playing = false;
      return;
    }
    try {
      this.current.onended = null;
      this.current.onerror = null;
      this.current.pause();
      this.current.currentTime = 0;
    } catch {
      /* ignore */
    }
    this.current = null;
    this.playing = false;
  }

  private async playKey(key: string): Promise<void> {
    if (this.muted) return;
    const priority = PRIORITY[key] ?? 1;
    const isForm = priority >= 3;
    const now = performance.now();
    const sameMs = isForm ? FORM_SAME_KEY_MS : SAME_KEY_MS;

    if (key === this.lastKey && now - this.lastAt < sameMs) return;
    // Soft gap for chatter only — form cues always allowed.
    if (!isForm && now - this.lastAt < MIN_GAP_MS && priority < 2) return;

    if (this.playing) {
      if (isForm || priority > this.playingPriority) {
        this.pending = null;
        this.stop();
      } else {
        if (priority >= 2) this.pending = key;
        return;
      }
    }

    const audio = this.getAudio(key);
    if (!audio) return;

    this.playing = true;
    this.playingPriority = priority;
    this.current = audio;

    const finish = (played: boolean): void => {
      if (this.current !== audio) return;
      this.playing = false;
      this.current = null;
      if (played) {
        this.lastKey = key;
        this.lastAt = performance.now();
      }
      const next = this.pending;
      this.pending = null;
      if (next) void this.playKey(next);
    };

    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
      await audio.play();
    } catch {
      finish(false);
    }
  }

  private getAudio(key: string): HTMLAudioElement | null {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const el = new Audio(`${BASE}${key}.wav`);
    el.preload = "auto";
    this.cache.set(key, el);
    return el;
  }
}
