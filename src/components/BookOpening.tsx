import { useEffect, useState } from "react";
import { getStory, Story } from "../lib/stories";
import TypeEmblem from "./TypeEmblem";

/** Longest the opening may take (spec 12.4). */
const DURATION = 600;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The book opening when a story is entered (spec 12.4). It covers the page for
 * at most 600 ms while the story loads behind it; a click on it or any key ends
 * it at once, and with reduced motion it is not shown at all. The cover is the
 * story's own: its type's shade and emblem, and its title (QA-13).
 */
export default function BookOpening({ storyId }: { storyId: string }) {
  const [shown, setShown] = useState(() => !reducedMotion());
  const [story, setStory] = useState<Story | null>(null);

  useEffect(() => {
    if (!shown) return;
    void getStory(storyId).then(setStory, () => undefined);
    const end = () => setShown(false);
    const timer = window.setTimeout(end, DURATION);
    window.addEventListener("keydown", end, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", end, true);
    };
  }, [shown, storyId]);

  if (!shown) return null;
  return (
    // The click that ends it lands on the book, not on the page under it (CR-05).
    <div className="book-opening" aria-hidden="true" onClick={() => setShown(false)}>
      <div className={story ? `book-cover type-${story.type}` : "book-cover"}>
        {story && (
          <>
            <span className="cover-title">{story.title}</span>
            <TypeEmblem typeId={story.type} className="cover-emblem" />
          </>
        )}
      </div>
    </div>
  );
}
