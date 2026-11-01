/**
 * A stand-in for an OpenAI-compatible API, for testing the app without a real key.
 *
 * Run:  npm run mock-ai
 * Then in Settings set the base URL to http://127.0.0.1:8787/v1, any model
 * name, and one of the test keys below. Each key makes the server answer a
 * different way.
 *
 * A key may end in "~<tag>" (e.g. sk-test-valid~prompt-check). The tag does not
 * change the behaviour; it lets a test fetch its own last request with
 * GET /v1/_last-request while other tests run in parallel.
 *
 * POST /v1/images/generations answers with a small PNG (spec 14), a different
 * colour each time; GET /v1/_last-image-request returns that key's last one.
 */
import http from "node:http";
import zlib from "node:zlib";

const PORT = Number(process.env.PORT) || 8787;

const MODELS = ["mock-gpt-large", "mock-gpt-small", "mock-novelist-v1", "mock-image-1"];

/**
 * Test key -> how the server answers. `status`, `models`, `raw` and `delayMs`
 * shape GET /v1/models; `code` and `message` shape an error answer;
 * `status` and `chat` shape POST /v1/chat/completions.
 * Any other key gets 401.
 */
const KEYS = {
  "sk-test-valid": { status: 200, models: MODELS, chat: "block" },
  "sk-test-one-model": { status: 200, models: ["mock-gpt-small"], chat: "block" },
  "sk-test-no-models": { status: 200, models: [], chat: "block" },
  "sk-test-forbidden": { status: 403 },
  "sk-test-rate-limit": { status: 429 },
  "sk-test-no-credit": { status: 429, code: "insufficient_quota", message: "You exceeded your current quota, please check your plan and billing details." },
  "sk-test-server-error": { status: 500 },
  "sk-test-bad-json": { status: 200, raw: "this is not json", chat: "bad-json" },
  "sk-test-slow": { status: 200, models: MODELS, delayMs: 5000, chat: "block" },
  "sk-test-stream-died": { status: 200, models: MODELS, chat: "died" },
  "sk-test-stream-slow": { status: 200, models: MODELS, chat: "slow" },
  "sk-test-stream-error": { status: 200, models: MODELS, chat: "error" },
  "sk-test-stream-cut": { status: 200, models: MODELS, chat: "cut" },
  "sk-test-stream-length": { status: 200, models: MODELS, chat: "length" },
  "sk-test-stream-malformed": { status: 200, models: MODELS, chat: "malformed" },
  "sk-test-stream-inline-marker": { status: 200, models: MODELS, chat: "inline-marker" },
  "sk-test-stream-long": { status: 200, models: MODELS, chat: "long" },
  "sk-test-end-chapter-fail": { status: 200, models: MODELS, chat: "end-fail" },
  "sk-test-new-character-no-age": { status: 200, models: MODELS, chat: "no-age" },
  "sk-test-no-usage": { status: 200, models: MODELS, chat: "block", noUsage: true },
  "sk-test-rejects-usage": { status: 200, models: MODELS, chat: "block", rejectsUsage: true },
  "sk-test-image-refused": { status: 200, models: MODELS, chat: "block", image: "refused" },
  "sk-test-image-slow": { status: 200, models: MODELS, chat: "block", image: "slow" },
  "sk-test-image-error": { status: 200, models: MODELS, chat: "block", image: "error" },
};

const IMAGE_HELP = {
  ok: "a small PNG",
  refused: "400 moderation_blocked, like a picture the safety system refused",
  slow: "a small PNG after about 3 s",
  error: "500",
};

/** Every call that asks for it reports this usage (spec 6.6), so tests can check the totals exactly. */
const USAGE = { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 };

const CHAT_HELP = {
  block: "a normal block; its mood line is a mood the direction names (\"a battle\"), otherwise none",
  died: "a block where the main character dies",
  slow: "a block streamed slowly (about 15 s), to test Stop",
  error: "half a block, then the connection drops",
  cut: "half a block, then the stream closes cleanly, with no [DONE] or finish_reason",
  length: "half a block, then finish_reason \"length\" (cut off at the output limit) and [DONE]",
  malformed: "a block with no === NEXT === line (no suggestions), ending in a bare flag line",
  "inline-marker": "a block whose === NEXT === ends the last story line, with no flag line (decision 90)",
  "bad-json": "a stream that is not JSON",
  long: "blocks of about 800 words, to reach the chapter length limits fast",
  "end-fail": "normal blocks, but the End Chapter call fails with an error",
  "no-age": "normal blocks, but End Chapter's new character comes without an age",
};
const USAGE_HELP = {
  noUsage: "; never sends a usage report (tokens are estimated)",
  rejectsUsage: "; answers 400 to stream_options, like a server that rejects unknown fields",
};

const CORS = {
  // Lets the browser preview (npm run dev) call this server too.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain" : "application/json",
    ...CORS,
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/** An error answer like OpenAI's; `code` and `message` let a key imitate a specific failure. */
function sendError(res, rule) {
  const error = { message: rule.message ?? `Mock error ${rule.status}`, ...(rule.code && { code: rule.code }) };
  send(res, rule.status, { error });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

/** Last chat request body per full key (tag included), for GET /v1/_last-request. */
const lastRequests = new Map();
/** Counts blocks written, so every block and every regenerated version reads differently. */
let blockCount = 0;

/** Reads the direction and hint out of the prompt's "## Next block" section (src/lib/prompt.ts). */
function promptParts(body) {
  const user = (body.messages ?? []).filter((m) => m.role === "user").at(-1)?.content ?? "";
  const direction = /^Direction: (.*)$/m.exec(user)?.[1] ?? "";
  const hint = /^Hint for this version: (.*)$/m.exec(user)?.[1] ?? "";
  return { direction, hint };
}

const MOODS = ["tense", "battle", "reveal", "sad", "triumphant", "romantic"];

/**
 * The block's mood line (spec 13): a mood named as a word in the direction or
 * hint (for example "a battle at the gate"), otherwise none, like most real blocks.
 */
function moodLine(direction, hint) {
  const words = `${direction} ${hint}`.toLowerCase().split(/[^a-z]+/);
  return `MOOD: ${MOODS.find((m) => words.includes(m)) ?? "none"}`;
}

function blockText(kind, body) {
  blockCount += 1;
  const { direction, hint } = promptParts(body);
  const story = [
    `Mock block ${blockCount}. The mist rolled down from the peaks as the next part of the story began.`,
    `Direction followed: ${direction}`,
    hint ? `Hint followed: ${hint}` : "",
    "The wind carried the smell of pine and rain. Somewhere below, a bell rang three times, and the path ahead narrowed between two old stones.",
    kind === "died" ? "A blade flashed in the dark, and the main character fell and did not rise again." : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  // Like a real provider seen in testing: no marker, but the flag line is still there (decision 54).
  if (kind === "malformed") return `${story}\n\nMAIN CHARACTER DIED: no`;
  // Like a real provider seen in testing: the marker glued to the last line, and no flag line (decision 90).
  if (kind === "inline-marker") {
    return `${story}=== NEXT ===\nFollow the stranger into the forest | A new ally, or a trap\nReturn to the sect before nightfall | Safety, but the trail goes cold`;
  }
  // Decision 125: a story type without suggestions asks for none, and gets none.
  const system = (body.messages ?? []).find((m) => m.role === "system")?.content ?? "";
  // Spec 14.2: a picture line only when images are on Rich.
  const picture = pictureLine(body);
  if (system.includes("Do not suggest what could happen next")) {
    return [story, "", "=== NEXT ===", `MAIN CHARACTER DIED: ${kind === "died" ? "yes" : "no"}`, moodLine(direction, hint), ...picture].join("\n");
  }
  return [
    story,
    "",
    "=== NEXT ===",
    // Decision 86: action | what it might do. The last one has no note, like some real answers.
    "Follow the stranger into the forest | A new ally, or a trap",
    "Return to the sect before nightfall | Safety, but the trail goes cold",
    "Rest by the stones and wait",
    `MAIN CHARACTER DIED: ${kind === "died" ? "yes" : "no"}`,
    moodLine(direction, hint),
    ...picture,
  ].join("\n");
}

/** The main character's name, from the "(main character)" heading the prompts use. */
function mainName(body) {
  const user = (body.messages ?? []).filter((m) => m.role === "user").at(-1)?.content ?? "";
  return /^### (.+?) \(main character\)$/m.exec(user)?.[1] ?? "The traveller";
}

/** The picture line, when the prompt asks for one (src/lib/prompt.ts PICTURE_RULE). */
function pictureLine(body) {
  const system = (body.messages ?? []).find((m) => m.role === "system")?.content ?? "";
  if (!system.includes("Then the picture line")) return [];
  return [`PICTURE: ${mainName(body)} stands between two old stones on a misty mountain path at dusk (mock block ${blockCount}).`];
}

/** Which call this is, from the start of the system message (src/lib/prompt.ts, src/lib/endChapter.ts). */
function requestKind(body) {
  const system = (body.messages ?? []).find((m) => m.role === "system")?.content ?? "";
  if (system.startsWith("You are the editor")) return "end-chapter";
  if (system.includes("Write the epilogue")) return "epilogue";
  return "block";
}

/**
 * A fixed End Chapter answer: one valid change for the main character, one
 * invalid change, one new character (without an age for the "no-age" key), the
 * used scenes sent plus one for this chapter, and two next chapter openings
 * when the prompt asks for them.
 */
function endChapterText(body, rule) {
  const system = body.messages.find((m) => m.role === "system").content;
  const user = body.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const chapter = /Chapter (\d+) has just ended/.exec(system)?.[1] ?? "?";
  const main = /^### (.+?) \(main character\)$/m.exec(user)?.[1] ?? "Nobody";
  const used = /## Scenes the story has already used\n([\s\S]*?)(?:\n\n## |$)/.exec(user)?.[1] ?? "";
  const scenes = used.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  const answer = {
    title: `Mock chapter ${chapter}`,
    chapter_summary: `In mock chapter ${chapter}, ${main} walked through the mist and met an old teacher.`,
    story_summary: `The story so far, up to mock chapter ${chapter}: ${main} has left home and found a teacher.`,
    scenes: [...scenes, `Mock scene of chapter ${chapter}: meeting a teacher in the mist`],
    // Only when asked for: a type without suggestions asks for no openings (decision 125).
    ...(system.includes("next_openings")
      ? { next_openings: [`Train with Elder Wu at dawn (after chapter ${chapter})`, "Go back down the mountain to the village"] }
      : {}),
    // Spec 14.2: the chapter's key scene, only when images are on Lite.
    ...(system.includes("- picture:") ? { picture: `${main} meets Elder Wu in the mist (mock chapter ${chapter}).` } : {}),
    character_changes: [
      { character: main, field: "condition", new_value: "Wounded in the left arm", reason: "Cut by a blade in the mist." },
      { character: "Nobody Known", field: "status", new_value: "Dead", reason: "Should be dropped: unknown character." },
    ],
    new_characters: [
      {
        name: "Elder Wu",
        fields:
          rule.chat === "no-age"
            ? { relationship: "Teacher", status: "Alive" }
            : { age: 70, relationship: "Teacher", status: "Alive", appearance: "A thin old man with a long white beard and a grey robe" },
        background: "An old teacher who lives in the mist.",
        reason: "Met in this chapter.",
      },
    ],
  };
  return "```json\n" + JSON.stringify(answer, null, 2) + "\n```";
}

function epilogueText(body) {
  blockCount += 1;
  const { direction } = promptParts(body);
  return [
    `Mock epilogue ${blockCount}. Years later, the mist still rolled down from the peaks.`,
    `Direction followed: ${direction}`,
    "The bell rang three times, and the story came to its end.",
    "MOOD: triumphant",
  ].join("\n\n");
}

/** About 800 words of filler, so a chapter reaches its limits in a few blocks. */
function longBlockText(body) {
  const block = blockText("block", body);
  const filler = Array.from({ length: 80 }, () => "The long road wound on beneath grey clouds and silent pines.").join(" ");
  return block.replace("=== NEXT ===", `${filler}\n\n=== NEXT ===`);
}

/** Splits text into small pieces, the way a real provider streams tokens. */
function pieces(text) {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

const chunk = (content) =>
  `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { content } }] })}\n\n`;
const finish = (reason) =>
  `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\n`;

async function chat(req, res, key, rule) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return send(res, 400, { error: { message: "Request body is not JSON." } });
  }
  lastRequests.set(key, body);
  if (rule.status !== 200) return sendError(res, rule);
  if (rule.rejectsUsage && body.stream_options) {
    return send(res, 400, { error: { message: "Unrecognized request argument supplied: stream_options" } });
  }
  // With include_usage, OpenAI sends the usage in one last chunk with no choices, before [DONE].
  const usage =
    body.stream_options?.include_usage && !rule.noUsage
      ? `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [], usage: USAGE })}\n\n`
      : "";

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...CORS });
  if (rule.chat === "bad-json") {
    res.end("data: this is not json\n\n");
    return;
  }

  const request = requestKind(body);
  if (request === "end-chapter" && rule.chat === "end-fail") {
    res.end(`data: ${JSON.stringify({ error: { message: "Mock End Chapter failure" } })}\n\n`);
    return;
  }
  const kind = ["slow", "end-fail", "no-age", "cut", "length"].includes(rule.chat) ? "block" : rule.chat;
  const text =
    request === "end-chapter"
      ? endChapterText(body, rule)
      : request === "epilogue"
        ? epilogueText(body)
        : kind === "long"
          ? longBlockText(body)
          : blockText(kind, body);
  let parts = pieces(text);
  // Long blocks and the End Chapter JSON go out about 20 words at a time, so they arrive in well under a second.
  if (kind === "long" || request === "end-chapter") {
    parts = Array.from({ length: Math.ceil(parts.length / 20) }, (_, i) => parts.slice(i * 20, i * 20 + 20).join(""));
  }
  const delay = rule.chat === "slow" ? 150 : 8;
  let closed = false;
  res.on("close", () => (closed = true));

  res.write(": keep-alive\n\n");
  for (let i = 0; i < parts.length; i++) {
    if (closed) return;
    if (i === Math.floor(parts.length / 2)) {
      if (rule.chat === "error") {
        res.destroy();
        return;
      }
      if (rule.chat === "cut") {
        res.end();
        return;
      }
      if (rule.chat === "length") {
        res.end(`${finish("length")}${usage}data: [DONE]\n\n`);
        return;
      }
    }
    res.write(chunk(parts[i]));
    await sleep(delay);
  }
  res.end(`${finish("stop")}${usage}data: [DONE]\n\n`);
}

/** CRC-32 of a PNG chunk's type and data. */
function crc32(bytes) {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A small 3:2 PNG, a soft gradient in a colour that changes with each picture, so pictures can be told apart. */
function mockPng(n) {
  const w = 48;
  const h = 32;
  const hue = [
    [180, 120, 90],
    [90, 140, 180],
    [120, 170, 110],
    [170, 110, 160],
  ][n % 4];
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const shade = 0.6 + (0.4 * (x + y)) / (w + h);
      hue.forEach((c, i) => (row[1 + x * 3 + i] = Math.round(c * shade)));
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Last image request body per full key (tag included), for GET /v1/_last-image-request. */
const lastImageRequests = new Map();
let pictureCount = 0;

async function image(req, res, key, rule) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: { message: "Request body is not JSON." } });
  }
  lastImageRequests.set(key, body);
  if (rule.status !== 200) return sendError(res, rule);
  if (rule.image === "refused") {
    return sendError(res, { status: 400, code: "moderation_blocked", message: "Your request was rejected by the safety system." });
  }
  if (rule.image === "error") return sendError(res, { status: 500 });
  if (rule.image === "slow") await sleep(3000);
  pictureCount += 1;
  send(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: mockPng(pictureCount).toString("base64") }] });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");

  const fullKey = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const key = fullKey.split("~")[0];
  console.log(`${req.method} ${req.url}  key=${fullKey || "(none)"}`);

  const rule = KEYS[key];

  if (req.method === "GET" && req.url === "/v1/_last-request") {
    const last = lastRequests.get(fullKey);
    return last ? send(res, 200, last) : send(res, 404, { error: { message: "No chat request with this key yet." } });
  }

  if (req.method === "GET" && req.url === "/v1/_last-image-request") {
    const last = lastImageRequests.get(fullKey);
    return last ? send(res, 200, last) : send(res, 404, { error: { message: "No image request with this key yet." } });
  }

  if (req.method === "POST" && req.url === "/v1/images/generations") {
    if (!rule) return send(res, 401, { error: { message: "Incorrect API key provided." } });
    return image(req, res, fullKey, rule);
  }

  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    if (!rule) return send(res, 401, { error: { message: "Incorrect API key provided." } });
    return chat(req, res, fullKey, rule);
  }

  if (req.method !== "GET" || req.url !== "/v1/models") {
    return send(res, 404, { error: { message: "Not found" } });
  }

  if (!rule) return send(res, 401, { error: { message: "Incorrect API key provided." } });
  if (rule.delayMs) await sleep(rule.delayMs);
  if (rule.raw) return send(res, rule.status, rule.raw);
  if (rule.status !== 200) return sendError(res, rule);

  send(res, 200, {
    object: "list",
    data: rule.models.map((id) => ({ id, object: "model", owned_by: "mock" })),
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock AI server: http://127.0.0.1:${PORT}/v1`);
  console.log("Test keys:");
  for (const [k, r] of Object.entries(KEYS)) {
    const models = `models ${r.status}${r.delayMs ? " (after 5 s)" : ""}`;
    const chatHelp = r.chat ? `; chat: ${CHAT_HELP[r.chat]}${r.noUsage ? USAGE_HELP.noUsage : ""}${r.rejectsUsage ? USAGE_HELP.rejectsUsage : ""}` : "";
    const imageHelp = r.status === 200 ? `; images: ${IMAGE_HELP[r.image ?? "ok"]}` : "";
    console.log(`  ${k.padEnd(26)} -> ${models}${chatHelp}${imageHelp}`);
  }
  console.log(`  ${"anything else".padEnd(26)} -> 401`);
});
