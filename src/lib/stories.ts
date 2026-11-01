/**
 * Stories on disk. Each story is one folder:
 *
 *   stories/<story-id>/
 *     story.json        title, type, language, status, chapter count
 *     setting.md        see setting.ts
 *     notes.md          see setting.ts
 *     summary.md        the "story so far"; see chapters.ts
 *     characters/       see characters.ts
 *     chapters/         see chapters.ts
 *     draft/            see draft.ts
 */
import { randomSet } from "./curatedSets";
import { readJson, store, writeJson } from "./storage";

export type StoryStatus = "active" | "completed";
export type StoryEnding = "death" | "choice";

export interface Story {
  id: string;
  title: string;
  /** Story type id, fixed for the life of the story. */
  type: string;
  language: string;
  status: StoryStatus;
  chapterCount: number;
  /**
   * Set when the story is heading for its epilogue (spec 5.5): "death" after an
   * accepted main character death, "choice" after End story.
   */
  ending?: StoryEnding;
  /**
   * The curated set the setting started from, or the last one Randomize saved
   * (spec 8, decision 85). The name pool and main character come from it.
   */
  setId?: string;
  createdAt: string;
  updatedAt: string;
  /** Last time the story was opened; the bookshelf puts the latest first (decision 109). */
  openedAt?: string;
}

export interface NewStory {
  title: string;
  type: string;
  language: string;
  /** Picked at random from the type's sets when not given (decision 72). */
  setId?: string;
}

const ROOT = "stories";

export function storyDir(id: string): string {
  return `${ROOT}/${id}`;
}

/** A folder-safe id: a readable slug of the text plus a short random suffix. */
export function makeId(text: string, fallback = "story"): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 8);
  return slug ? `${slug}-${suffix}` : `${fallback}-${suffix}`;
}

export async function listStories(): Promise<Story[]> {
  const entries = await store.list(ROOT);
  const stories: Story[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    try {
      stories.push(await readJson<Story>(`${ROOT}/${entry.name}/story.json`));
    } catch {
      // A folder without a readable story.json is skipped, not treated as an error.
    }
  }
  return stories.sort((a, b) => lastOpened(b).localeCompare(lastOpened(a)));
}

/** A story from before phase 7 has no opened time; its last change stands in for it. */
function lastOpened(story: Story): string {
  return story.openedAt ?? story.updatedAt;
}

export async function getStory(id: string): Promise<Story> {
  return readJson<Story>(`${storyDir(id)}/story.json`);
}

export async function createStory(input: NewStory): Promise<Story> {
  const now = new Date().toISOString();
  const story: Story = {
    id: makeId(input.title),
    title: input.title.trim(),
    type: input.type,
    language: input.language,
    status: "active",
    chapterCount: 0,
    createdAt: now,
    updatedAt: now,
    // A new story counts as opened when created (decision 109).
    openedAt: now,
  };
  const setId = input.setId ?? randomSet(input.type)?.id;
  if (setId) story.setId = setId;
  await writeJson(`${storyDir(story.id)}/story.json`, story);
  return story;
}

export async function deleteStory(id: string): Promise<void> {
  await store.remove(storyDir(id));
}

/** Records that the story was opened. Not a change to the story, so its updated time stays. */
export async function markOpened(id: string, now = new Date()): Promise<Story> {
  const story = { ...(await getStory(id)), openedAt: now.toISOString() };
  await writeJson(`${storyDir(id)}/story.json`, story);
  return story;
}

/** Saves changes to story.json and bumps its updated time. */
export async function updateStory(id: string, patch: Partial<Omit<Story, "id">>): Promise<Story> {
  const story = { ...(await getStory(id)), ...patch, updatedAt: new Date().toISOString() };
  await writeJson(`${storyDir(id)}/story.json`, story);
  return story;
}
