import { type ReactNode, useEffect, useRef } from "react";

import { Logo } from "~/components/app/Mark";
import { href } from "~/lib/router";
import { useSetup } from "~/lib/setup";
import { cn } from "~/lib/utils";

import type { Section } from "./sections";

/**
 * The bar on top of every screen: title, the section's pages as tabs, actions. Its
 * content sits on the same left and right edges as the page body below it. On a phone
 * the tabs get a row of their own that scrolls, with the current one kept in view.
 */
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
  const { demo } = useSetup();
  const current = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [page]);

  const tabs = section.pages.length > 0 && (
    <nav className="max-md:tabs-fade flex min-w-0 items-center gap-0.5 overflow-x-auto max-md:-mx-4 max-md:px-4 max-md:pb-2" aria-label={`${section.label} pages`}>
      {section.pages.map((p) => {
        const on = p.key === page;
        return (
          <a
            key={p.key}
            ref={on ? current : undefined}
            href={href(section.key, p.key)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "h-7 shrink-0 rounded-md px-2.5 text-[13px] leading-7 text-muted-foreground transition-colors hover:text-foreground max-md:h-10 max-md:px-3 max-md:text-sm max-md:leading-10",
              on && "bg-accent font-medium text-foreground",
            )}
          >
            {p.label}
          </a>
        );
      })}
    </nav>
  );

  return (
    <header className="shrink-0 border-b border-border">
      <div className="mx-auto w-full max-w-[var(--page-max)] px-6 max-md:px-4">
        <div className="flex h-[52px] items-center gap-3">
          <Logo className="size-5 md:hidden" />
          <h1 className="shrink-0 text-sm font-semibold tracking-tight max-md:text-base">{title ?? section.label}</h1>
          {demo && <span className="rounded-full border border-border px-1.5 py-px text-xs text-muted-foreground md:hidden">Demo</span>}
          <div className="min-w-0 max-md:hidden">{tabs}</div>
          <div className="ms-auto flex shrink-0 items-center gap-2">{actions}</div>
        </div>
        <div className="md:hidden">{tabs}</div>
      </div>
    </header>
  );
}
