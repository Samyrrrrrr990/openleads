import { MoonIcon, SearchIcon, SunIcon } from "lucide-react";
import { useEffect } from "react";

import { Logo } from "~/components/app/Mark";
import { href } from "~/lib/router";
import { useSetup } from "~/lib/setup";
import { toggleTheme, useTheme } from "~/lib/theme";

import { SECTIONS } from "./sections";

const row = "flex h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-[15px] hover:bg-accent";

/** On a phone, "More" is the rest of the sidebar: every section, search, and the theme. */
export function MoreSheet({ open, active, onClose, onSearch }: { open: boolean; active: string; onClose: () => void; onSearch: () => void }) {
  const theme = useTheme();
  const setup = useSetup();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="All sections">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="pop-in absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2.5 px-3 pb-2">
          <Logo className="size-5" />
          <span className="text-[15px] font-semibold tracking-tight">OpenLeads</span>
          <span className="ms-auto text-xs text-muted-foreground">
            {setup.demo ? "Demo, " : ""}
            {setup.version ? `version ${setup.version}` : ""}
          </span>
        </div>
        <nav aria-label="All sections">
          {SECTIONS.map((s) => (
            <a key={s.key} href={href(s.key)} onClick={onClose} aria-current={s.key === active ? "page" : undefined} className={row + (s.key === active ? " bg-accent font-medium" : "")}>
              <s.icon className="size-5 text-muted-foreground" />
              {s.label}
            </a>
          ))}
        </nav>
        <div className="mt-2 border-t border-border pt-2">
          <button
            type="button"
            className={row}
            onClick={() => {
              onClose();
              onSearch();
            }}
          >
            <SearchIcon className="size-5 text-muted-foreground" /> Search people and pages
          </button>
          <button type="button" className={row} onClick={toggleTheme}>
            {theme === "dark" ? <SunIcon className="size-5 text-muted-foreground" /> : <MoonIcon className="size-5 text-muted-foreground" />}
            {theme === "dark" ? "Switch to light" : "Switch to dark"}
          </button>
        </div>
      </div>
    </div>
  );
}
