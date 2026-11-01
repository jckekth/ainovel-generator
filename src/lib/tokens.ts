/**
 * Tokens the AI calls used (spec 6.6, decision 87): from the provider's usage
 * report, or estimated when it sends none.
 */
import { t } from "../i18n";
import type { ChatMessage, Usage } from "./ai";

export interface Tokens {
  input: number;
  output: number;
  /** True when any part was estimated, because a provider sent no usage report. */
  estimated?: boolean;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/**
 * A rough count for mixed text, such as English instructions around Chinese
 * story text: one per Chinese, Japanese or Korean character, and words × 4/3
 * for the rest (spec 6.1, decision 53).
 */
export function estimateTextTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const words = text.replace(CJK, " ").split(/\s+/).filter(Boolean).length;
  return cjk + Math.ceil((words * 4) / 3);
}

/** The tokens of one call: the provider's report, or an estimate from what was sent and received. */
export function callTokens(usage: Usage | null, messages: ChatMessage[], answer: string): Tokens {
  if (usage) return { input: usage.input, output: usage.output };
  return {
    input: estimateTextTokens(messages.map((m) => m.content).join("\n")),
    output: estimateTextTokens(answer),
    estimated: true,
  };
}

export function addTokens(a: Tokens | undefined, b: Tokens | undefined): Tokens | undefined {
  if (!a) return b;
  if (!b) return a;
  const sum: Tokens = { input: a.input + b.input, output: a.output + b.output };
  if (a.estimated || b.estimated) sum.estimated = true;
  return sum;
}

/** Tokens read from a file, which may have been edited by hand; undefined when unusable. */
export function readTokens(raw: unknown): Tokens | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const input = Number(r.input);
  const output = Number(r.output);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  return r.estimated === true ? { input, output, estimated: true } : { input, output };
}

/** "1,200 in · 300 out tokens", with "≈" and "estimated" when estimated. */
export function formatTokens(tokens: Tokens): string {
  return t(tokens.estimated ? "tokens.amountEstimated" : "tokens.amount", { input: tokens.input, output: tokens.output });
}
