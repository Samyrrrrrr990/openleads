import { MenuIcon } from "lucide-react";

import { useCounts } from "~/lib/counts";
import { href } from "~/lib/router";
import { cn } from "~/lib/utils";

import { SECTIONS } from "./sections";

const PRIMARY = ["today", "ask", "people", "outreach"];

/** Phones have no sidebar: four places you go all day, and More for the rest. */
export function TabBar({ active, onMore }: { active: string; onMore: () => void }) {
  const counts = useCounts();
  const waiting = counts.replies + counts.drafts;
  const item = "relative flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-2xs";
  return (
    <nav className="flex h-14 shrink-0 border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Sections">
      {SECTIONS.filter((s) => PRIMARY.includes(s.key)).map((s) => {
        const on = s.key === active;
        return (
          <a key={s.key} href={href(s.key)} aria-current={on ? "page" : undefined} className={cn(item, on ? "font-medium text-foreground" : "text-muted-foreground")}>
            <span className="relative">
              <s.icon className="size-5" />
              {s.key === "today" && waiting > 0 && (
                <span className="absolute -end-2.5 -top-1 rounded-full bg-primary px-1 text-3xs font-semibold leading-3.5 text-primary-foreground tabular-nums">{waiting}</span>
              )}
            </span>
            {s.label}
          </a>
        );
      })}
      <button type="button" onClick={onMore} className={cn(item, PRIMARY.includes(active) ? "text-muted-foreground" : "font-medium text-foreground")}>
        <MenuIcon className="size-5" />
        More
      </button>
    </nav>
  );
}
