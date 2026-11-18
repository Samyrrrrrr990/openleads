import {
  Building2Icon,
  ClockIcon,
  FilterIcon,
  FlagIcon,
  GitMergeIcon,
  HandIcon,
  LayersIcon,
  ListChecksIcon,
  ListOrderedIcon,
  ListPlusIcon,
  type LucideIcon,
  MinusIcon,
  PenLineIcon,
  RadarIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  TableIcon,
  TagIcon,
  UploadIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  hand: HandIcon,
  clock: ClockIcon,
  users: UsersIcon,
  reply: ReplyIcon,
  find: SearchIcon,
  building: Building2Icon,
  shield: ShieldCheckIcon,
  filter: FilterIcon,
  layers: LayersIcon,
  merge: GitMergeIcon,
  minus: MinusIcon,
  compose: PenLineIcon,
  send: SendIcon,
  list: ListPlusIcon,
  sequence: ListOrderedIcon,
  flag: FlagIcon,
  task: ListChecksIcon,
  tag: TagIcon,
  table: TableIcon,
  upload: UploadIcon,
  bolt: ZapIcon,
  radar: RadarIcon,
};

// One hue per group, used only as a thin accent on the node's icon tile.
export const GROUP_TONE: Record<string, string> = {
  Triggers: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Leads: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Logic: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  Outreach: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Workspace: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  Output: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

export function iconFor(icon: string | undefined): LucideIcon {
  return ICONS[icon ?? ""] ?? ZapIcon;
}

