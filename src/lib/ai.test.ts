import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, AiStopped, explainStatus, listModels, providerError, providerMessage, SseDecoder, streamChat } from "./ai";

const config = { baseUrl: "https://api.example.com/v1", apiKey: "sk-test" };

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("explainStatus (spec 9: errors in plain words)", () => {
  it.each([
    [401, /key was rejected/],
    [403, /not allowed/],
    [404, /most end in \/v1/],
    [429, /too many requests from this key. Wait a minute and try again/],
    [402, /no credit left. Add credit on the provider/],
    [500, /server error \(500\)/],
    [503, /server error \(503\)/],
    [418, /unexpected status \(418\)/],
  ])("explains %i", (status, message) => {
    expect(explainStatus(status)).toMatch(message);
  });

  it("tells no credit from a rate limit by the provider's code (decision 58)", () => {
    for (const code of ["insufficient_quota", "insufficient_balance", "billing_hard_limit_reached"]) {
      expect(explainStatus(429, "chat", code)).toMatch(/no credit left\. Add credit/);
    }
    expect(explainStatus(429, "chat", "rate_limit_exceeded")).toMatch(/Wait a minute and try again/);
    expect(explainStatus(402, "chat")).toMatch(/no credit left/);
  });
});

describe("listModels", () => {
  it("asks for a key first", async () => {
    await expect(listModels({ ...config, apiKey: "" })).rejects.toThrow("Enter an API key first.");
  });

  it("rejects a base URL that is not http or https", async () => {
    const fetch = stubFetch(async () => json({}));
    await expect(listModels({ ...config, baseUrl: "api.example.com" })).rejects.toThrow(/must start with http/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls /models with the Bearer key, with or without a trailing slash", async () => {
    const fetch = stubFetch(async () => json({ data: [] }));
    await listModels({ ...config, baseUrl: "  https://api.example.com/v1///  " });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/models");
    expect(init.headers).toEqual({ Authorization: "Bearer sk-test" });
  });

  it("returns model ids sorted, dropping ids that are not strings", async () => {
    stubFetch(async () => json({ data: [{ id: "b-model" }, { id: 7 }, {}, { id: "a-model" }] }));
    expect(await listModels(config)).toEqual(["a-model", "b-model"]);
  });

  it("gives an empty list when the provider lists no models", async () => {
    stubFetch(async () => json({}));
    expect(await listModels(config)).toEqual([]);
  });

  it("explains a network failure", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(listModels(config)).rejects.toThrow(/Could not reach the provider/);
  });

  it("explains an error status", async () => {
    stubFetch(async () => json({ error: {} }, 401));
    const err = await listModels(config).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.message).toMatch(/key was rejected/);
  });

  it("explains an answer that is not JSON", async () => {
    stubFetch(async () => new Response("this is not json", { status: 200 }));
    await expect(listModels(config)).rejects.toThrow(/not in the expected format/);
  });
});

describe("SseDecoder", () => {
  it("joins lines split across pieces", () => {
    const sse = new SseDecoder();
    expect(sse.push('data: {"a"')).toEqual([]);
    expect(sse.push(":1}\n")).toEqual([]);
    expect(sse.push("\ndata: two\n\n")).toEqual(['{"a":1}', "two"]);
  });

  it("accepts CRLF line endings, also split between pieces", () => {
    const sse = new SseDecoder();
    expect(sse.push("data: one\r")).toEqual([]);
    expect(sse.push("\n\r\ndata: two\r\n\r\n")).toEqual(["one", "two"]);
  });

  it("skips keep-alive comments and other fields", () => {
    const sse = new SseDecoder();
    expect(sse.push(": keep-alive\n\nevent: message\nid: 7\ndata: x\n\n")).toEqual(["x"]);
  });

  it("joins several data lines of one event, and accepts data without a space", () => {
    expect(new SseDecoder().push("data: a\ndata:b\n\n")).toEqual(["a\nb"]);
  });

  it("delivers a last event that has no closing blank line", () => {
    const sse = new SseDecoder();
    expect(sse.push("data: [DONE]")).toEqual([]);
    expect(sse.push("", true)).toEqual(["[DONE]"]);
    expect(sse.push("", true)).toEqual([]);
  });
});

const chatConfig = { ...config, model: "gpt-test" };
const messages = [{ role: "user" as const, content: "Hi" }];

const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const finish = (reason: string) => `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;

/** A streamed response that sends each piece as its own chunk. */
function sse(pieces: string[], opts: { failAfter?: number } = {}) {
  const bytes = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (opts.failAfter !== undefined && i === opts.failAfter) {
        controller.error(new TypeError("network error"));
      } else if (i < pieces.length) {
        controller.enqueue(bytes.encode(pieces[i++]));
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("streamChat (spec 5.1: streamed blocks)", () => {
  it("posts the model, messages, stream: true and the usage option with the Bearer key (decision 87)", async () => {
    const fetch = stubFetch(async () => sse(["data: [DONE]\n\n"]));
    await streamChat({ config: { ...chatConfig, baseUrl: "https://api.example.com/v1/" }, messages });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer sk-test", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-test",
      messages,
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("returns the joined text and reports the text so far as it arrives", async () => {
    // The second delta is split mid-line across two chunks.
    const second = delta("lo, ");
    stubFetch(async () =>
      sse([": keep-alive\n\n", delta("Hel"), second.slice(0, 12), second.slice(12), delta("world"), "data: [DONE]\n\n"]),
    );
    const seen: string[] = [];
    const text = await streamChat({ config: chatConfig, messages, onText: (t) => seen.push(t) });
    expect(text).toBe("Hello, world");
    expect(seen).toEqual(["Hel", "Hello, ", "Hello, world"]);
  });

  it("ignores chunks without content, such as the role chunk", async () => {
    stubFetch(async () =>
      sse([`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}\n\n`, delta("Hi"), "data: [DONE]\n\n"]),
    );
    expect(await streamChat({ config: chatConfig, messages })).toBe("Hi");
  });

  it("keeps a multi-byte character split between chunks intact", async () => {
    const bytes = new TextEncoder().encode(delta("林风"));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 41));
        c.enqueue(bytes.slice(41));
        c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        c.close();
      },
    });
    stubFetch(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    expect(await streamChat({ config: chatConfig, messages })).toBe("林风");
  });

  it("accepts a stream that ends without [DONE] once a finish_reason came", async () => {
    stubFetch(async () => sse([delta("All of it."), finish("stop")]));
    expect(await streamChat({ config: chatConfig, messages })).toBe("All of it.");
  });

  it("treats a stream that closes with neither [DONE] nor a finish_reason as broken off (decision 74)", async () => {
    stubFetch(async () => sse([delta("Lin Feng climbed the stairs and reached for the")]));
    const err = await streamChat({ config: chatConfig, messages }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.message).toMatch(/broke off/);
  });

  it("refuses an answer cut off at the provider's output limit, with or without [DONE] (decision 74)", async () => {
    stubFetch(async () => sse([delta("Lin Feng ran and"), finish("length"), "data: [DONE]\n\n"]));
    await expect(streamChat({ config: chatConfig, messages })).rejects.toThrow(/output limit/);
    stubFetch(async () => sse([delta("Lin Feng ran and"), finish("length")]));
    await expect(streamChat({ config: chatConfig, messages })).rejects.toThrow(/output limit/);
    stubFetch(async () => json({ choices: [{ message: { content: "Lin Feng ran and" }, finish_reason: "length" }] }));
    await expect(streamChat({ config: chatConfig, messages })).rejects.toThrow(/output limit/);
  });

  it("accepts a provider that answers with one JSON body instead of a stream", async () => {
    stubFetch(async () => json({ choices: [{ message: { content: "Whole block." } }] }));
    const seen: string[] = [];
    expect(await streamChat({ config: chatConfig, messages, onText: (t) => seen.push(t) })).toBe("Whole block.");
    expect(seen).toEqual(["Whole block."]);
  });

  it("explains a JSON body without a message", async () => {
    stubFetch(async () => json({ choices: [] }));
    await expect(streamChat({ config: chatConfig, messages })).rejects.toThrow(/not in the expected format/);
  });

  it("asks for a model first", async () => {
    const fetch = stubFetch(async () => sse([]));
    await expect(streamChat({ config: { ...chatConfig, model: " " }, messages })).rejects.toThrow(
      "Choose a model in Settings first.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks for a key first", async () => {
    await expect(streamChat({ config: { ...chatConfig, apiKey: "" }, messages })).rejects.toThrow(
      "Enter an API key first.",
    );
  });

  it("explains a network failure (spec 9)", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(streamChat({ config: chatConfig, messages })).rejects.toThrow(/Could not reach the provider/);
  });

  it("explains an error status (spec 9)", async () => {
    stubFetch(async () => json({ error: {} }, 429));
    await expect(streamChat({ config: chatConfig, messages })).rejects.toThrow(/Wait a minute and try again/);
  });

  it("explains a connection that breaks off mid-stream", async () => {
    stubFetch(async () => sse([delta("Half a "), delta("block")], { failAfter: 2 }));
    const err = await streamChat({ config: chatConfig, messages }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.message).toMatch(/broke off/);
  });

  it("passes on an error the provider sends inside the stream", async () => {
    stubFetch(async () => sse([delta("Half"), `data: ${JSON.stringify({ error: { message: "overloaded" } })}\n\n`]));
    await expect(streamChat({ config: chatConfig, messages })).rejects.toThrow(
      "The provider stopped with an error: overloaded. Try again.",
    );
  });

  it("explains a stream that is not JSON", async () => {
    stubFetch(async () => sse(["data: this is not json\n\n"]));
    await expect(streamChat({ config: chatConfig, messages })).rejects.toThrow(/not in the expected format/);
  });

  it("throws AiStopped when the request is aborted before an answer", async () => {
    const controller = new AbortController();
    stubFetch(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(streamChat({ config: chatConfig, messages, signal: controller.signal })).rejects.toBeInstanceOf(
      AiStopped,
    );
  });

  it("throws AiStopped when Stop is pressed mid-stream", async () => {
    const controller = new AbortController();
    stubFetch(async () => sse([delta("Half a "), delta("block")], { failAfter: 1 }));
    const err = await streamChat({
      config: chatConfig,
      messages,
      signal: controller.signal,
      onText: () => controller.abort(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AiStopped);
  });
});

describe("provider messages (decision 56)", () => {
  it("points a chat 400 or 404 to the model name", () => {
    expect(explainStatus(404, "chat")).toMatch(/did not accept the request \(404\)\. Check the model name in Settings/);
    expect(explainStatus(400, "chat")).toMatch(/Check the model name/);
    expect(explainStatus(404)).toMatch(/Nothing was found at this base URL/);
    expect(explainStatus(401, "chat")).toMatch(/key was rejected/);
  });

  it("reads error.message, a string error or message from JSON, and short plain text", async () => {
    expect(await providerMessage(json({ error: { message: " The model does not exist. " } }, 404))).toBe("The model does not exist.");
    expect(await providerMessage(json({ error: "Bad key" }, 401))).toBe("Bad key");
    expect(await providerMessage(json({ message: "Slow down" }, 429))).toBe("Slow down");
    expect(await providerMessage(new Response("Service unavailable", { status: 503 }))).toBe("Service unavailable");
  });

  it("reads the error code, or the type when there is no code", async () => {
    expect(await providerError(json({ error: { message: "Quota", code: "insufficient_quota" } }, 429))).toEqual({
      message: "Quota",
      code: "insufficient_quota",
    });
    expect((await providerError(json({ error: { type: "insufficient_quota" } }, 429))).code).toBe("insufficient_quota");
    expect((await providerError(json({ error: "Bad key" }, 401))).code).toBe("");
  });

  it("says the account has no credit when a 429 carries insufficient_quota (decision 58)", async () => {
    stubFetch(async () => json({ error: { message: "You exceeded your current quota.", code: "insufficient_quota" } }, 429));
    await expect(streamChat({ config: chatConfig, messages })).rejects.toThrow(
      "The account has no credit left. Add credit on the provider's website, then try again. The provider said: “You exceeded your current quota.”",
    );
  });

  it("ignores HTML pages and JSON without a message, and shortens long messages", async () => {
    expect(await providerMessage(new Response("<html>Bad gateway</html>", { status: 502 }))).toBe("");
    expect(await providerMessage(json({ error: {} }, 500))).toBe("");
    const long = await providerMessage(json({ error: { message: "x".repeat(500) } }, 400));
    expect(long).toHaveLength(301);
    expect(long.endsWith("…")).toBe(true);
  });

  it("adds the provider's words after ours, for chat and for the connection test", async () => {
    stubFetch(async () => json({ error: { message: "The model gpt-9 does not exist." } }, 404));
    await expect(streamChat({ config: chatConfig, messages })).rejects.toThrow(
      /Check the model name in Settings.*The provider said: “The model gpt-9 does not exist\.”$/,
    );
    stubFetch(async () => json({ error: { message: "Invalid key." } }, 401));
    await expect(listModels(config)).rejects.toThrow(/key was rejected.*The provider said: “Invalid key\.”$/);
  });
});

describe("usage report (spec 6.6, decision 87)", () => {
  const usage = (prompt: number, completion: number) =>
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } })}\n\n`;

  it("reads the usage from the last chunk of a stream", async () => {
    stubFetch(async () => sse([delta("Hello"), finish("stop"), usage(1200, 300), "data: [DONE]\n\n"]));
    const seen: unknown[] = [];
    expect(await streamChat({ config: chatConfig, messages, onUsage: (u) => seen.push(u) })).toBe("Hello");
    expect(seen).toEqual([{ input: 1200, output: 300 }]);
  });

  it("reads the usage from a provider that answers with one JSON body", async () => {
    stubFetch(async () =>
      json({ choices: [{ message: { content: "Hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 7 } }),
    );
    const seen: unknown[] = [];
    await streamChat({ config: chatConfig, messages, onUsage: (u) => seen.push(u) });
    expect(seen).toEqual([{ input: 50, output: 7 }]);
  });

  it("reports nothing when the provider sends no usage, or a broken one", async () => {
    stubFetch(async () => sse([delta("Hi"), `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: "x" } })}\n\n`, "data: [DONE]\n\n"]));
    const seen: unknown[] = [];
    await streamChat({ config: chatConfig, messages, onUsage: (u) => seen.push(u) });
    expect(seen).toEqual([]);
  });

  it("asks once more without stream_options when the provider rejects it", async () => {
    const fetch = stubFetch(async (_url, init) =>
      JSON.parse(init.body as string).stream_options
        ? json({ error: { message: "Unrecognized request argument supplied: stream_options" } }, 400)
        : sse([delta("Hi"), "data: [DONE]\n\n"]),
    );
    expect(await streamChat({ config: chatConfig, messages })).toBe("Hi");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toEqual({ model: "gpt-test", messages, stream: true });
  });

  it("does not retry other 400s, and keeps the model-name message", async () => {
    const fetch = stubFetch(async () => json({ error: { message: "The model `x` does not exist" } }, 400));
    await expect(streamChat({ config: chatConfig, messages })).rejects.toThrow(/Check the model name.*does not exist/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
