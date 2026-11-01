import { BookIcon, FeatherIcon, HeartIcon, SwordIcon, YinYangIcon } from "@phosphor-icons/react";

/** Each story type's emblem on the bookshelf (decision 96): told apart by shape, not colour. */
const EMBLEMS = { cultivation: YinYangIcon, romance: HeartIcon, fantasy: SwordIcon, general: FeatherIcon };

export default function TypeEmblem({ typeId, className }: { typeId: string; className?: string }) {
  const Icon = EMBLEMS[typeId as keyof typeof EMBLEMS] ?? BookIcon;
  return <Icon className={className} weight="fill" aria-hidden />;
}
