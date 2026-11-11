import type { ReactNode } from "react";

import { href } from "~/lib/router";
import { cn } from "~/lib/utils";

import { classic } from "~/lib/router";
import { type Section } from "./sections";

/** The 52px bar on top of every screen: title, the section's pages as tabs, actions. */
export function PageHeader({
  section,
  page,
  title,
  actions,
}: {
  section: Section;
  page?: string;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-border px-5">
      <h1 className="text-sm font-semibold tracking-tight">{title ?? section.label}</h1>
      {section.pages.length > 0 && (
        <nav className="flex items-center gap-0.5 overflow-x-auto" aria-label={`${section.label} pages`}>
          {section.pages.map((p) => {
            const on = p.key === page;
            return (
              <a
                key={p.key}
                href={p.classic ? classic(p.classic) : href(section.key, p.key)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "h-7 shrink-0 rounded-md px-2.5 text-[13px] leading-7 text-muted-foreground transition-colors hover:text-foreground",
                  on && "bg-accent font-medium text-foreground",
                )}
              >
                {p.label}
                {p.classic && <span className="ms-1 text-2xs opacity-60">↗</span>}
              </a>
            );
          })}
        </nav>
      )}
      <div className="ms-auto flex items-center gap-2">{actions}</div>
    </header>
  );
}
