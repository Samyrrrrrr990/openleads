import { ExternalLinkIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react";

import { Logo } from "~/components/app/Mark";
import { Kbd } from "~/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCounts } from "~/lib/counts";
import { href } from "~/lib/router";
import { useSetup } from "~/lib/setup";
import { toggleTheme, useTheme } from "~/lib/theme";
import { cn, IS_MAC } from "~/lib/utils";

import { SECTIONS } from "./sections";

export function Sidebar({
  active,
  version,
  onOpenPalette,
}: {
  active: string;
  version: string;
  onOpenPalette: () => void;
}) {
  const counts = useCounts();
  const setup = useSetup();
  const theme = useTheme();
  const waiting = counts.replies + counts.drafts;

  return (
    <aside
      data-app-sidebar
      className="flex w-[var(--sidebar-width)] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground max-md:hidden"
    >
      <a href={href("today")} className="flex h-[52px] items-center gap-2.5 px-3.5" aria-label="OpenLeads, go to Today">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight">OpenLeads</span>
        {setup.demo && (
          <span className="ms-auto rounded-full border border-sidebar-border px-1.5 py-px text-xs text-sidebar-muted-foreground" title="A made-up workspace to look around in. Nothing here is real and nothing can send.">
            Demo
          </span>
        )}
      </a>

      <div className="px-2">
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-row-active px-2.5 text-[13px] text-sidebar-muted-foreground shadow-xs/5 transition-colors hover:text-sidebar-foreground"
        >
          <SearchIcon className="size-3.5" />
          <span>Search or jump to</span>
          <Kbd className="ms-auto">{IS_MAC ? "⌘K" : "Ctrl K"}</Kbd>
        </button>
      </div>

      <nav className="mt-3 flex flex-col gap-px px-2" aria-label="Sections">
        {SECTIONS.map((s) => {
          const on = s.key === active;
          const Icon = s.icon;
          return (
            <a
              key={s.key}
              href={href(s.key)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "group flex h-8 items-center gap-2.5 rounded-lg border border-transparent px-2.5 text-[13px] font-medium text-sidebar-muted-foreground transition-colors",
                "hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                on && "border-sidebar-border bg-sidebar-row-active text-sidebar-foreground shadow-xs/5 dark:border-transparent",
              )}
            >
              <Icon className={cn("size-4", on ? "text-sidebar-foreground" : "text-sidebar-muted-foreground")} />
              <span>{s.label}</span>
              {s.key === "today" && waiting > 0 && (
                <span className="ms-auto rounded-full bg-primary px-1.5 text-2xs font-semibold leading-4 text-primary-foreground tabular-nums">
                  {waiting}
                </span>
              )}
              {s.key === "pipeline" && counts.tasks > 0 && (
                <span className="ms-auto text-2xs text-sidebar-muted-foreground tabular-nums">{counts.tasks}</span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-1 border-t border-sidebar-border px-2 py-2">
        <span className="flex min-w-0 items-center gap-1.5 px-1.5 text-xs text-sidebar-muted-foreground" title="Everything stays on this computer">
          <span className="size-1.5 shrink-0 rounded-full bg-success" />
          <span className="truncate">Local{version || setup.version ? `, version ${version || setup.version}` : ""}</span>
        </span>
        <span className="ms-auto" />
        <Tooltip>
          <TooltipTrigger
            render={
              <a
                href="/classic/"
                className="grid size-7 place-items-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                aria-label="Open the classic dashboard"
              />
            }
          >
            <ExternalLinkIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>Classic dashboard</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={toggleTheme}
                className="grid size-7 cursor-pointer place-items-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                aria-label="Switch between light and dark"
              />
            }
          >
            {theme === "dark" ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" />}
          </TooltipTrigger>
          <TooltipPopup>{theme === "dark" ? "Light mode" : "Dark mode"}</TooltipPopup>
        </Tooltip>
      </div>
    </aside>
  );
}
