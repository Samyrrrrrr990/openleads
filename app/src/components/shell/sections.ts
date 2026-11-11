import {
  CircleCheckIcon,
  HouseIcon,
  KanbanSquareIcon,
  type LucideIcon,
  SendIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
  WorkflowIcon,
} from "lucide-react";

export interface Page {
  key: string;
  label: string;
  /** Opens in the classic dashboard until the app has its own screen. */
  classic?: string;
}

export interface Section {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Keyboard: "g" then this letter. */
  jump: string;
  pages: Page[];
}

// The seven sections of 5.5. Everything the old sidebar had lives under one of them.
export const SECTIONS: Section[] = [
  { key: "today", label: "Today", icon: HouseIcon, jump: "t", pages: [] },
  { key: "ask", label: "Ask", icon: SparklesIcon, jump: "a", pages: [] },
  {
    key: "people",
    label: "People",
    icon: UsersIcon,
    jump: "p",
    pages: [
      { key: "people", label: "People" },
      { key: "companies", label: "Companies" },
      { key: "lists", label: "Lists" },
      { key: "find", label: "Find people", classic: "prospect" },
      { key: "import", label: "Import & enrich", classic: "import" },
      { key: "health", label: "Data health", classic: "health" },
    ],
  },
  {
    key: "outreach",
    label: "Outreach",
    icon: SendIcon,
    jump: "o",
    pages: [
      { key: "approvals", label: "Approvals" },
      { key: "sequences", label: "Sequences" },
      { key: "templates", label: "Templates" },
      { key: "compose", label: "Compose & send", classic: "compose" },
    ],
  },
  { key: "workflows", label: "Workflows", icon: WorkflowIcon, jump: "w", pages: [] },
  {
    key: "pipeline",
    label: "Pipeline",
    icon: KanbanSquareIcon,
    jump: "d",
    pages: [
      { key: "deals", label: "Deals" },
      { key: "tasks", label: "Tasks" },
      { key: "activity", label: "Activity" },
      { key: "analytics", label: "Analytics" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    icon: SettingsIcon,
    jump: "s",
    pages: [
      { key: "connections", label: "Connections" },
      { key: "doctor", label: "Doctor" },
      { key: "all", label: "All settings", classic: "settings" },
    ],
  },
];

export const DONE_ICON = CircleCheckIcon;

export function sectionOf(key: string): Section {
  return SECTIONS.find((s) => s.key === key) ?? SECTIONS[0];
}
