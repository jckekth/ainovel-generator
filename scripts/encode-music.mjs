// Converts music tracks to the bundled format (spec 13.1, decision 133): MP3 at
// 128 kbps stereo, tags removed, written to src/assets/music/<name>.mp3. A track
// already at or below 128 kbps is copied as it is, since encoding it again would
// only lose quality. Usage: npm run encode-music -- <file.mp3> [more files...]
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import ffmpeg from "ffmpeg-static";

const outDir = resolve(import.meta.dirname, "../src/assets/music");
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Give the tracks to convert, for example: npm run encode-music -- battle.mp3 sad.mp3");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const out = join(outDir, basename(file, extname(file)) + ".mp3");
  // ffmpeg prints the source's bitrate on stderr when given no output.
  const info = spawnSync(ffmpeg, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr;
  const kbps = Number(/bitrate: (\d+) kb\/s/.exec(info)?.[1] ?? Infinity);
  if (kbps <= 128 && extname(file).toLowerCase() === ".mp3") {
    if (resolve(file) !== out) copyFileSync(file, out);
    console.log(`${basename(out)}: already ${kbps} kbps, kept as it is`);
    continue;
  }
  // Write next to the target first, so converting a file in place never reads a half-written one.
  const tmp = out + ".tmp.mp3";
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", file,
    "-map", "0:a", "-map_metadata", "-1", "-ac", "2", "-codec:a", "libmp3lame", "-b:a", "128k", tmp]);
  renameSync(tmp, out);
  console.log(`${basename(out)}: ${kbps} kbps -> 128 kbps, ${(statSync(out).size / 1e6).toFixed(1)} MB`);
}
