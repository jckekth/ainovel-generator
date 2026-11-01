import { describe, expect, it } from "vitest";
import { TRACKS } from "../music.config";
import { parseBlock } from "./block";
import { isMood, MOODS, readMood } from "./mood";
import { dbToGain, music, musicStep, trackUrl } from "./music";

describe("moods (spec 13.1, decision 130)", () => {
  it("reads the six moods and nothing else", () => {
    expect(MOODS).toEqual(["tense", "battle", "reveal", "sad", "triumphant", "romantic"]);
    expect(readMood(" Battle. ")).toBe("battle");
    expect(readMood("`sad`")).toBe("sad");
    for (const v of ["none", "calm", "", undefined, 3]) expect(readMood(v)).toBeUndefined();
    expect(isMood("none")).toBe(false);
  });
});

describe("tracks (spec 13.1, decisions 133–135)", () => {
  it("has a bundled MP3 for every mood", () => {
    for (const mood of MOODS) expect(trackUrl(mood), mood).toMatch(new RegExp(`${mood}.*\\.mp3`));
  });

  it("credits every track with title, artist, licence and source", () => {
    for (const mood of MOODS) {
      const t = TRACKS[mood];
      expect(t.title && t.artist && t.licence && t.licenceUrl && t.source, mood).toBeTruthy();
    }
  });

  it("keeps the aggressive tracks lower than the rest (decision 135)", () => {
    const calmer = (["reveal", "sad", "triumphant", "romantic"] as const).map((m) => TRACKS[m].levelDb);
    for (const loud of ["battle", "tense"] as const) expect(TRACKS[loud].levelDb).toBeLessThan(Math.min(...calmer));
  });

  it("turns dB into a gain factor", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-20)).toBeCloseTo(0.1);
    expect(dbToGain(10)).toBeCloseTo(3.162, 3);
  });
});

describe("what a finished block does to the music (spec 13.2, decision 131)", () => {
  it("keeps the music as it is for a block with no mood", () => {
    expect(musicStep(null, undefined)).toBe("keep");
    expect(musicStep("battle", undefined)).toBe("keep");
  });

  it("keeps a track playing when the next block has the same mood", () => {
    expect(musicStep("battle", "battle")).toBe("keep");
  });

  it("plays a peak's track from silence, or in place of another mood", () => {
    expect(musicStep(null, "sad")).toBe("play");
    expect(musicStep("battle", "sad")).toBe("play");
  });

  it("does nothing where there is no Web Audio, so writing never fails on music", () => {
    music.enterStory("s1");
    expect(() => music.blockFinished(parseBlock("Text\n=== NEXT ===\nMOOD: battle").mood)).not.toThrow();
    music.endChapter();
    music.leaveStory();
    expect(document.documentElement.dataset.music ?? "").toBe("");
  });
});
