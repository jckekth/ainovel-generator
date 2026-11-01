/**
 * Picture size, quality and prices (spec 14.1, decisions 141, 142).
 *
 * Prices are US dollars per picture at PICTURE_SIZE, from OpenAI's price page.
 * Check them against the provider's page before each release: a model that is
 * not listed shows "price not known" in Settings.
 * Checked 2026-11-01: https://developers.openai.com/api/docs/models/gpt-image-1-mini
 */
import type { ImageQuality } from "./lib/settings";

/** Landscape, so a picture fits under a block of text (decision 141). */
export const PICTURE_SIZE = "1536x1024";

/** Asked for as WebP, so each file stays small. */
export const PICTURE_FORMAT = "webp";

export const PICTURE_PRICES: Record<string, Record<ImageQuality, number>> = {
  "gpt-image-1-mini": { low: 0.006, medium: 0.015 },
  "gpt-image-1": { low: 0.016, medium: 0.063 },
};

/** Typical blocks in a chapter of the default length, Medium (spec 5.3), for the Rich cost. */
export const RICH_PICTURES_PER_CHAPTER = { min: 6, max: 8 };
