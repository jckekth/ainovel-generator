import { useEffect, useState } from "react";
import { figureKind, figureUrl } from "../lib/art";

/**
 * The character's figure behind the character sheet (spec 12.3, decision 112):
 * the PNG used as a mask and filled with the text colour at 20%, at the bottom
 * right. It breathes when idle and holds still while a field has focus
 * (decision 111). A figure that fails to load is simply not shown.
 */
export default function CharacterFigure({ gender, still }: { gender: unknown; still: boolean }) {
  const url = figureUrl(gender);
  const [ok, setOk] = useState(false);

  // The mask cannot report a failed load, so the image is loaded once to check it.
  useEffect(() => {
    if (!url) return setOk(false);
    const img = new Image();
    img.onload = () => setOk(true);
    img.onerror = () => setOk(false);
    img.src = url;
  }, [url]);

  if (!url || !ok) return null;
  return (
    <div
      className={still ? "character-figure still" : "character-figure"}
      data-figure={figureKind(gender)}
      aria-hidden="true"
      style={{ maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` }}
    />
  );
}
