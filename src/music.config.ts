/**
 * The background music tracks (spec 13.1, decisions 133–135): one per mood,
 * shared by all story types, in src/assets/music/<mood>.mp3. Each has its
 * credit for the About page and a level that evens out loudness.
 */
import type { Mood } from "./lib/mood";

export interface Track {
  title: string;
  artist: string;
  licence: string;
  /** The licence text's address, shown in the credit as CC BY asks. */
  licenceUrl: string;
  /** Where the track was downloaded. */
  source: string;
  /**
   * Gain in dB so every track sounds about as loud as the others, measured on
   * the loudest 10% of each. Battle and tense sit 4 dB lower, since loud,
   * aggressive music distracts from reading (decision 135). Tuned by ear.
   */
  levelDb: number;
}

const MACLEOD = {
  artist: "Kevin MacLeod (incompetech.com)",
  licence: "Creative Commons: By Attribution 4.0 License",
  licenceUrl: "http://creativecommons.org/licenses/by/4.0/",
};

export const TRACKS: Record<Mood, Track> = {
  tense: { title: "Satiate", ...MACLEOD, source: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Satiate.mp3", levelDb: -11 },
  battle: { title: "Death and Axes", ...MACLEOD, source: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Death%20and%20Axes.mp3", levelDb: -13 },
  reveal: { title: "I Can Feel it Coming", ...MACLEOD, source: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/I%20Can%20Feel%20it%20Coming.mp3", levelDb: -4 },
  sad: { title: "Lost Time", ...MACLEOD, source: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Lost%20Time.mp3", levelDb: -3 },
  triumphant: { title: "Rainbows", ...MACLEOD, source: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Rainbows.mp3", levelDb: -4 },
  romantic: {
    title: "Touching Moments Four - Melody",
    ...MACLEOD,
    source: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Touching%20Moments%20Four%20-%20Melody.mp3",
    levelDb: 10,
  },
};
