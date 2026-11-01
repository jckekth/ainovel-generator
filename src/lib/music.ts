/**
 * Background music (spec 13, decisions 130–135). Silent by default: a block
 * that reaches an emotional peak brings in its mood's track, which fades in,
 * plays once and fades out (decision 131). Leaving the story pauses it, and
 * coming back to the same story resumes it (decision 132).
 *
 * One player for the whole app, so a track keeps playing across tab changes
 * inside a story. It uses the Web Audio API: a gain node per track carries its
 * fades and its level, which can go above 1 for a quiet track (decision 135).
 * Where there is no Web Audio (unit tests), it does nothing.
 */
import { TRACKS } from "../music.config";
import type { Mood } from "./mood";

const files = import.meta.glob<string>("../assets/music/*.mp3", { eager: true, query: "?url", import: "default" });

/**
 * Fade lengths in seconds (spec 13.2, 13.3). Slow, so music eases in and out
 * under the reading (decision 149); pause and off stay short, since they must
 * act at once.
 */
export const FADE = { in: 6, out: 10, change: 5, endChapter: 5, resume: 3, pause: 0.2, off: 0.2 };

export function trackUrl(mood: Mood): string | undefined {
  return files[`../assets/music/${mood}.mp3`];
}

/** dB to a gain factor: -6 dB is about half. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * What a finished block does to the music (spec 13.2). `playing` is the mood
 * of a track still playing, or null when the app is silent.
 * - keep: no mood, or the same mood still playing; the track plays on
 * - play: a new peak; the playing track (if any) fades out as the new one fades in
 */
export function musicStep(playing: Mood | null, mood: Mood | undefined): "keep" | "play" {
  return !mood || mood === playing ? "keep" : "play";
}

interface Playing {
  mood: Mood;
  storyId: string;
  audio: HTMLAudioElement;
  gain: GainNode;
  /** The track's level as a gain factor: the top of its fades. */
  level: number;
  /** Set once the closing fade has started, so it starts only once. */
  closing: boolean;
  /** The pending pause after a short fade, cancelled by a resume. */
  pauseTimer?: number;
}

/** What tests and the dev tools can read: "<mood> playing", "<mood> paused" or "" (on <html data-music>). */
export type MusicState = string;

class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private on = true;
  private volume = 0.5;
  /** The story whose pages are open, or null when none is (decision 132). */
  private story: string | null = null;
  private hidden = false;
  private current: Playing | null = null;

  /** Music on or off and the volume, 0 to 1, from the settings (spec 9). */
  configure(on: boolean, volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    if (this.on && !on) this.stop(FADE.off);
    this.on = on;
  }

  /** A story's pages opened. The same story resumes its paused track; another story starts silent. */
  enterStory(storyId: string): void {
    this.story = storyId;
    if (this.current && this.current.storyId !== storyId) this.stop(0);
    this.resume();
  }

  /** The story was left in any way: back to the shelf, Settings, About (decision 132). */
  leaveStory(): void {
    this.story = null;
    this.pause();
  }

  /** The window was minimised or hidden, or shown again. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.pause();
    else this.resume();
  }

  /** A block has finished with this mood (spec 13.2). */
  blockFinished(mood: Mood | undefined): void {
    if (!this.on || !this.story || this.hidden) return;
    if (musicStep(this.current?.mood ?? null, mood) === "keep" || !mood) return;
    const url = trackUrl(mood);
    // A missing track is silence for that mood; it never stops writing (spec 13.1).
    if (!url || !this.ensureContext()) return;
    this.stop(this.current ? FADE.change : 0);
    this.start(mood, url, this.story);
  }

  /** End Chapter: the next chapter starts in silence (spec 13.2). */
  endChapter(): void {
    this.stop(FADE.endChapter);
  }

  private ensureContext(): boolean {
    if (this.ctx) return true;
    const Ctx = typeof window === "undefined" ? undefined : window.AudioContext;
    if (!Ctx) return false;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    return true;
  }

  private start(mood: Mood, url: string, storyId: string): void {
    const ctx = this.ctx!;
    const audio = new Audio(url);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(audio).connect(gain);
    gain.connect(this.master!);
    const playing: Playing = { mood, storyId, audio, gain, level: dbToGain(TRACKS[mood].levelDb), closing: false };
    this.current = playing;
    // The closing fade over the last seconds: play once, no loop (decision 131).
    audio.addEventListener("timeupdate", () => {
      if (playing.closing || !audio.duration || audio.duration - audio.currentTime > FADE.out) return;
      playing.closing = true;
      this.rampTo(playing, 0, Math.max(0.1, audio.duration - audio.currentTime));
    });
    audio.addEventListener("ended", () => this.drop(playing));
    audio.addEventListener("error", () => this.drop(playing));
    void ctx.resume();
    audio.play().then(
      () => {
        // The story was left while the track was loading: hold it for the return.
        if (this.current === playing && (this.story !== storyId || this.hidden)) playing.audio.pause();
        else this.rampTo(playing, playing.level, FADE.in);
        this.report();
      },
      () => this.drop(playing),
    );
  }

  private pause(): void {
    const playing = this.current;
    if (!playing || playing.audio.paused || playing.pauseTimer !== undefined) return;
    this.rampTo(playing, 0, FADE.pause);
    playing.pauseTimer = window.setTimeout(() => {
      playing.pauseTimer = undefined;
      playing.audio.pause();
      this.report();
    }, FADE.pause * 1000);
    this.report("paused");
  }

  /** Picks a paused track up where it stopped, when its story is open and the window shown. */
  private resume(): void {
    const playing = this.current;
    if (!playing || !this.on || this.hidden || this.story !== playing.storyId) return;
    if (playing.pauseTimer !== undefined) {
      window.clearTimeout(playing.pauseTimer);
      playing.pauseTimer = undefined;
    }
    void this.ctx?.resume();
    const fadeIn = () => {
      // A track paused during its closing fade fades in again; the next time
      // update starts its closing fade over what is left.
      playing.closing = false;
      this.rampTo(playing, playing.level, FADE.resume);
      this.report();
    };
    if (playing.audio.paused) playing.audio.play().then(fadeIn, () => this.drop(playing));
    else fadeIn();
  }

  /** Fades the current track out over `seconds` and forgets it; 0 stops it at once. */
  private stop(seconds: number): void {
    const playing = this.current;
    if (!playing) return;
    this.current = null;
    if (playing.pauseTimer !== undefined) window.clearTimeout(playing.pauseTimer);
    playing.closing = true;
    if (seconds > 0 && !playing.audio.paused) {
      this.rampTo(playing, 0, seconds);
      window.setTimeout(() => this.release(playing), seconds * 1000 + 50);
    } else {
      this.release(playing);
    }
    this.report();
  }

  private drop(playing: Playing): void {
    if (this.current === playing) this.current = null;
    this.release(playing);
    this.report();
  }

  private release(playing: Playing): void {
    playing.audio.pause();
    playing.audio.removeAttribute("src");
    playing.gain.disconnect();
  }

  private rampTo(playing: Playing, value: number, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = playing.gain.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(value, now + seconds);
  }

  /** Mirrors the state on <html data-music> for E2E tests and checking by hand. */
  private report(status?: "paused"): void {
    if (typeof document === "undefined") return;
    const playing = this.current;
    const state: MusicState = playing ? `${playing.mood} ${status ?? (playing.audio.paused ? "paused" : "playing")}` : "";
    document.documentElement.dataset.music = state;
  }
}

/** The app's one music player. */
export const music = new MusicPlayer();
