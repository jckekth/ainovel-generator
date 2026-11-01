/**
 * Calls to an OpenAI-compatible API.
 *
 * Three calls: list models (the settings page's connection test), a streamed
 * chat completion (story blocks) and an image generation (pictures, spec 14).
 * Pages only see these functions, so another provider format can be added here
 * without touching them (spec 2).
 */
import { t } from "../i18n";
import { isTauri } from "./platform";
import { base64ToBytes } from "./storage";

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** An error with a message written for the user, saying what to do next. */
export class AiError extends Error {}

/** Thrown when the user pressed Stop. Not an error to show. */
export class AiStopped extends Error {
  constructor() {
    super("Stopped.");
  }
}

// Read when thrown, so they are in the UI language of that moment.
const NO_CONNECTION = () => t("error.noConnection");
const BAD_FORMAT = () => t("error.badFormat");
const BROKE_OFF = () => t("error.brokeOff");
const CUT_OFF = () => t("error.cutOff");

async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  if (isTauri()) {
    // The plugin's fetch runs in Rust, so it is not blocked by browser CORS rules.
    // It streams the body and honours init.signal, like the browser's fetch.
    const http = await import("@tauri-apps/plugin-http");
    return http.fetch(url, init);
  }
  return fetch(url, init);
}

function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.trim().replace(/\/+$/, "") + path;
}

function checkConfig(config: AiConfig): void {
  if (!config.apiKey) throw new AiError(t("error.enterKey"));
  if (!/^https?:\/\//i.test(config.baseUrl.trim())) {
    throw new AiError(t("error.baseUrl"));
  }
}

/**
 * Error codes that mean the account is out of credit. OpenAI answers 429 with
 * `insufficient_quota`; others send 402 or a code like these (decision 58).
 */
const NO_CREDIT_CODE = /insufficient_quota|insufficient_balance|insufficient_credit|billing/i;

/**
 * Our plain-words message for an error status. For chat completions, 400 and
 * 404 usually mean the model name is wrong (decision 56). `code` is the
 * provider's `error.code` or `error.type`, which tells no credit from a rate limit.
 */
export function explainStatus(status: number, call: "models" | "chat" | "image" = "models", code = ""): string {
  if (call === "chat" && (status === 400 || status === 404)) {
    return t("error.status.chat", { status: String(status) });
  }
  if (call === "image" && (status === 400 || status === 404)) {
    return t("error.status.image", { status: String(status) });
  }
  if (status === 402 || (status === 429 && NO_CREDIT_CODE.test(code))) {
    return t("error.status.noCredit");
  }
  switch (status) {
    case 401:
      return t("error.status.401");
    case 403:
      return t("error.status.403");
    case 404:
      return t("error.status.404");
    case 429:
      return t("error.status.429");
    default:
      if (status >= 500) return t("error.status.server", { status: String(status) });
      return t("error.status.other", { status: String(status) });
  }
}

const MAX_PROVIDER_MESSAGE = 300;

/**
 * The provider's own words from an error response: `error.message` in JSON, or
 * short plain text; and `error.code` (or `error.type`) when it sent one.
 */
export async function providerError(response: Response): Promise<{ message: string; code: string }> {
  let text: string;
  try {
    text = (await response.text()).trim();
  } catch {
    return { message: "", code: "" };
  }
  let message = "";
  let code = "";
  try {
    const body = JSON.parse(text) as {
      error?: { message?: unknown; code?: unknown; type?: unknown } | string;
      message?: unknown;
    };
    const found = typeof body.error === "string" ? body.error : (body.error?.message ?? body.message);
    message = typeof found === "string" ? found.trim() : "";
    if (typeof body.error === "object") {
      const c = body.error.code ?? body.error.type;
      code = typeof c === "string" ? c : "";
    }
  } catch {
    // Not JSON: plain text is useful, an HTML error page is not.
    message = text.startsWith("<") ? "" : text;
  }
  if (message.length > MAX_PROVIDER_MESSAGE) message = `${message.slice(0, MAX_PROVIDER_MESSAGE)}…`;
  return { message, code };
}

/** The provider's own message from an error response, without the code. */
export async function providerMessage(response: Response): Promise<string> {
  return (await providerError(response)).message;
}

/** Our message, then the provider's own words when it sent any (decision 56). */
async function statusError(
  response: Response,
  call: "models" | "chat" | "image",
  theirs?: { message: string; code: string },
): Promise<AiError> {
  theirs ??= await providerError(response);
  const ours = explainStatus(response.status, call, theirs.code);
  return new AiError(theirs.message ? t("error.providerSaid", { ours, theirs: theirs.message }) : ours);
}

/** Returns the model ids the key can use, sorted by name. Also serves as the connection test. */
export async function listModels(config: AiConfig): Promise<string[]> {
  checkConfig(config);

  let response: Response;
  try {
    response = await httpFetch(joinUrl(config.baseUrl, "/models"), {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
  } catch {
    throw new AiError(NO_CONNECTION());
  }

  if (!response.ok) throw await statusError(response, "models");

  try {
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    const ids = (body.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string");
    return ids.sort((a, b) => a.localeCompare(b));
  } catch {
    throw new AiError(BAD_FORMAT());
  }
}

/**
 * Splits a server-sent event stream into the data of each event.
 * Pieces of the stream can end anywhere, even mid-line, so an incomplete line waits for the next piece.
 */
export class SseDecoder {
  private buffer = "";
  private data: string[] = [];

  /** Feeds the next piece of the stream. Returns the data of every event it completed. */
  push(piece: string, end = false): string[] {
    this.buffer += piece;
    const lines = this.buffer.split("\n");
    this.buffer = end ? "" : (lines.pop() ?? "");
    const events: string[] = [];
    for (const raw of lines) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (line === "") {
        if (this.data.length > 0) events.push(this.data.join("\n"));
        this.data = [];
      } else if (line.startsWith("data:")) {
        this.data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
      }
      // Comments (": keep-alive") and other fields (event:, id:) carry nothing we need.
    }
    // A stream that ends without a closing blank line still delivers its last event.
    if (end && this.data.length > 0) {
      events.push(this.data.join("\n"));
      this.data = [];
    }
    return events;
  }
}

/** Tokens one call used, from the provider's usage report (spec 6.6). */
export interface Usage {
  input: number;
  output: number;
}

export interface ChatRequest {
  config: AiConfig & { model: string };
  messages: ChatMessage[];
  /** Aborting it stops the request; streamChat then throws AiStopped. */
  signal?: AbortSignal;
  /** Called with the whole text so far, each time a piece arrives. */
  onText?: (text: string) => void;
  /** Called with the provider's usage report, if it sends one. */
  onUsage?: (usage: Usage) => void;
  /** Called with each request body as it is sent, so the AI call log records the one that answered (CR6-05). */
  onRequest?: (body: ReturnType<typeof chatBody>) => void;
}

interface RawUsage {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
}

interface StreamChunk {
  choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
  error?: { message?: string };
  usage?: RawUsage | null;
}

/** The usage report as numbers, or null when it is missing or not numbers. */
export function readUsage(raw: RawUsage | null | undefined): Usage | null {
  if (!raw) return null;
  const input = Number(raw.prompt_tokens);
  const output = Number(raw.completion_tokens);
  return Number.isFinite(input) && Number.isFinite(output) ? { input, output } : null;
}

/**
 * The request body of a streamed chat completion, as sent. The AI call log
 * (devlog.ts) records the same object. Usage is asked for (decision 87).
 */
export function chatBody(model: string, messages: ChatMessage[], usage = true) {
  const body = { model: model.trim(), messages, stream: true };
  return usage ? { ...body, stream_options: { include_usage: true } } : body;
}

/** A provider that rejects the usage option says so in a 400 or 422 naming it (decision 87). */
function rejectsUsageOption(status: number, message: string): boolean {
  return (status === 400 || status === 422) && /stream_options|include_usage/i.test(message);
}

/** Thrown when the image provider's safety rules refused the picture (spec 14.4). */
export class PictureRefused extends AiError {}

/** Codes and words providers use for a picture their safety system refused. */
const REFUSED = /moderation_blocked|content_policy_violation|safety|moderation/i;

/**
 * The request body of one picture (OpenAI images API, decision 140). The AI
 * call log (devlog.ts) records the same object.
 */
export function imageBody(model: string, prompt: string, quality: string, size: string, format: string) {
  return { model: model.trim(), prompt, n: 1, size, quality, output_format: format };
}

export interface ImageRequest {
  config: AiConfig & { model: string };
  body: ReturnType<typeof imageBody>;
  signal?: AbortSignal;
}

/** Makes one picture and returns its bytes. A refused picture throws PictureRefused. */
export async function generateImage({ config, body, signal }: ImageRequest): Promise<Uint8Array> {
  checkConfig(config);
  if (!config.model.trim()) throw new AiError(t("error.chooseImageModel"));

  let response: Response;
  try {
    response = await httpFetch(joinUrl(config.baseUrl, "/images/generations"), {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal?.aborted) throw new AiStopped();
    throw new AiError(NO_CONNECTION());
  }
  if (!response.ok) {
    const theirs = await providerError(response);
    if (response.status === 400 && (REFUSED.test(theirs.code) || REFUSED.test(theirs.message))) {
      const ours = t("error.pictureRefused");
      throw new PictureRefused(theirs.message ? t("error.providerSaid", { ours, theirs: theirs.message }) : ours);
    }
    throw await statusError(response, "image", theirs);
  }

  let item: { b64_json?: unknown; url?: unknown } | undefined;
  try {
    item = ((await response.json()) as { data?: { b64_json?: unknown; url?: unknown }[] }).data?.[0];
  } catch {
    if (signal?.aborted) throw new AiStopped();
    throw new AiError(BAD_FORMAT());
  }
  if (typeof item?.b64_json === "string") return base64ToBytes(item.b64_json);
  // Some providers send a link to the picture instead of the picture itself.
  if (typeof item?.url === "string") {
    try {
      const picture = await httpFetch(item.url, { method: "GET", signal });
      if (picture.ok) return new Uint8Array(await picture.arrayBuffer());
    } catch {
      if (signal?.aborted) throw new AiStopped();
      throw new AiError(NO_CONNECTION());
    }
  }
  throw new AiError(BAD_FORMAT());
}

/** Streams one chat completion and returns its full text. */
export async function streamChat({ config, messages, signal, onText, onUsage, onRequest }: ChatRequest): Promise<string> {
  checkConfig(config);
  if (!config.model.trim()) throw new AiError(t("error.chooseModel"));

  const post = async (usage: boolean): Promise<Response> => {
    const body = chatBody(config.model, messages, usage);
    onRequest?.(body);
    try {
      return await httpFetch(joinUrl(config.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      if (signal?.aborted) throw new AiStopped();
      throw new AiError(NO_CONNECTION());
    }
  };

  let response = await post(true);
  if (!response.ok) {
    const theirs = await providerError(response);
    if (!rejectsUsageOption(response.status, theirs.message)) throw await statusError(response, "chat", theirs);
    response = await post(false);
    if (!response.ok) throw await statusError(response, "chat");
  }

  // Some providers ignore stream: true and send the whole answer as one JSON body.
  if ((response.headers.get("Content-Type") ?? "").includes("application/json")) {
    let text: unknown;
    let finishReason: unknown;
    let usage: Usage | null = null;
    try {
      const body = (await response.json()) as {
        choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
        usage?: RawUsage;
      };
      text = body.choices?.[0]?.message?.content;
      finishReason = body.choices?.[0]?.finish_reason;
      usage = readUsage(body.usage);
    } catch {
      if (signal?.aborted) throw new AiStopped();
      throw new AiError(BAD_FORMAT());
    }
    if (typeof text !== "string") throw new AiError(BAD_FORMAT());
    if (finishReason === "length") throw new AiError(CUT_OFF());
    if (usage) onUsage?.(usage);
    onText?.(text);
    return text;
  }
  if (!response.body) throw new AiError(BAD_FORMAT());

  const reader = response.body.getReader();
  const utf8 = new TextDecoder();
  const sse = new SseDecoder();
  let text = "";
  /** The last finish_reason the provider sent; "length" means the answer was cut off (decision 74). */
  let finishReason: string | undefined;

  /** Returns true at the end-of-stream event. */
  const handle = (data: string): boolean => {
    if (data.trim() === "[DONE]") return true;
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      throw new AiError(BAD_FORMAT());
    }
    if (chunk.error) {
      throw new AiError(t("error.streamError", { message: chunk.error.message ?? t("error.noDetails") }));
    }
    // With include_usage, the report comes in a last chunk with no choices.
    const usage = readUsage(chunk.usage);
    if (usage) onUsage?.(usage);
    const reason = chunk.choices?.[0]?.finish_reason;
    if (typeof reason === "string" && reason) finishReason = reason;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      text += delta;
      onText?.(text);
    }
    return false;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      const events = done ? sse.push(utf8.decode(), true) : sse.push(utf8.decode(value, { stream: true }));
      for (const data of events) {
        if (handle(data)) {
          void reader.cancel().catch(() => undefined);
          if (finishReason === "length") throw new AiError(CUT_OFF());
          return text;
        }
      }
      if (done) {
        if (finishReason === "length") throw new AiError(CUT_OFF());
        // Some providers close the stream without [DONE]. That is complete only when a
        // finish_reason came; a stream that just closes may have been cut mid-block.
        if (finishReason) return text;
        throw new AiError(BROKE_OFF());
      }
    }
  } catch (e) {
    if (signal?.aborted) throw new AiStopped();
    if (e instanceof AiError) throw e;
    throw new AiError(BROKE_OFF());
  }
}
