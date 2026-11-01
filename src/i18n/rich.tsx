import { Fragment, ReactNode } from "react";
import { MessageKey, Params, t } from ".";

/**
 * A UI text with some placeholders filled by elements, e.g. a bold title:
 * tRich("deleteStory.text", { count }, { title: <strong>…</strong> }).
 * The element can sit anywhere in the sentence, as each language needs.
 */
export function tRich(key: MessageKey, params: Params, nodes: Record<string, ReactNode>): ReactNode {
  const marked = Object.fromEntries(Object.keys(nodes).map((name) => [name, `\u0000${name}\u0000`]));
  const parts = t(key, { ...params, ...marked }).split("\u0000");
  // Odd parts are placeholder names.
  return parts.map((part, i) => <Fragment key={i}>{i % 2 === 1 ? nodes[part] : part}</Fragment>);
}
