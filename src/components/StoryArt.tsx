import { useState } from "react";
import { backgroundStrength, backgroundUrl } from "../lib/art";

/**
 * The story type's background behind the workspace (spec 12.3, decision 98):
 * fixed to the window, anchored at the bottom, fading toward the top. An image
 * that is missing or fails to load leaves the plain page colour.
 */
export default function StoryArt({ typeId }: { typeId: string }) {
  const url = backgroundUrl(typeId);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <div className="story-art" aria-hidden="true" style={{ opacity: backgroundStrength(typeId) }}>
      <img src={url} alt="" onError={() => setFailed(true)} />
    </div>
  );
}
