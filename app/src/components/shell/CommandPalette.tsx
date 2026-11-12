import {
  ArrowRightIcon,
  CornerDownLeftIcon,
  ExternalLinkIcon,
  MoonIcon,
  SparklesIcon,
  UserIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "~/components/ui/command";
import { Kbd } from "~/components/ui/kbd";
import { api } from "~/lib/api";
import { ask as askOpenLeads } from "~/views/today/useAsk";
import { navigate } from "~/lib/router";
import { toggleTheme } from "~/lib/theme";
import type { Page, Person } from "~/lib/types";

import { SECTIONS } from "./sections";

interface Entry {
  id: string;
  label: string;
  hint?: string;
  icon: typeof ArrowRightIcon;
  run: () => void;
}

function destinations(): Entry[] {
  const out: Entry[] = [];
  for (const s of SECTIONS) {
    out.push({ id: `go:${s.key}`, label: s.label, hint: `g ${s.jump}`, icon: s.icon, run: () => navigate(s.key) });
    for (const p of s.pages) {
      if (p.key === s.key) continue;
      out.push({
        id: `go:${s.key}/${p.key}`,
        label: p.label,
        hint: s.label,
        icon: ArrowRightIcon,
        run: () => navigate(s.key, p.key),
      });
    }
  }
  out.push({ id: "do:theme", label: "Switch light and dark", icon: MoonIcon, run: toggleTheme });
  out.push({
    id: "do:classic",
    label: "Open the classic dashboard",
    icon: ExternalLinkIcon,
    run: () => window.location.assign("/classic/"),
  });
  return out;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const all = useMemo(destinations, []);

  useEffect(() => {
    if (!open) setText("");
  }, [open]);

  // People matching what you typed, a moment after you stop typing.
  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2) {
      setPeople([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.post<Page<Person>>("/api/people/search", { filters: { q }, per_page: 5 });
        if (live) setPeople(res.rows);
      } catch {
        if (live) setPeople([]);
      }
    }, 160);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [text, open]);

  const items = useMemo(() => {
    const q = text.trim().toLowerCase();
    const matches = q ? all.filter((e) => `${e.label} ${e.hint ?? ""}`.toLowerCase().includes(q)) : all;
    const found: Entry[] = people.map((p) => ({
      id: `person:${p.email}`,
      label: p.name || p.email,
      hint: [p.title, p.organization].filter(Boolean).join(", "),
      icon: UserIcon,
      run: () => navigate("people", "people", p.email),
    }));
    const ask: Entry[] = q
      ? [
          {
            id: "ask",
            label: `Ask OpenLeads: ${text.trim()}`,
            hint: "see the plan first",
            icon: SparklesIcon,
            run: () => {
              navigate("ask");
              void askOpenLeads(text.trim());
            },
          },
        ]
      : [];
    // A request reads like a sentence; a jump is a word or two.
    const sentence = q.split(/\s+/).length >= 3;
    return sentence ? [...ask, ...found, ...matches] : [...matches, ...found, ...ask];
  }, [text, all, people]);

  const run = (entry: Entry) => {
    onOpenChange(false);
    entry.run();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup aria-label="Search or jump to">
        <Command
          items={items}
          filter={null}
          value={text}
          onValueChange={(v) => setText(v)}
          itemToStringValue={(e) => (e as Entry).label}
        >
          <CommandInput placeholder="Jump to a page, find a person, or say what you want" />
          <CommandPanel>
            <CommandList>
              {(entry: Entry) => {
                const Icon = entry.icon;
                return (
                  <CommandItem key={entry.id} value={entry} onClick={() => run(entry)}>
                    <Icon className="size-4 shrink-0 text-icon-muted" />
                    <span className="truncate">{entry.label}</span>
                    {entry.hint &&
                      (entry.id.startsWith("go:") ? (
                        <span className="ms-auto flex shrink-0 items-center gap-1 ps-3" aria-label={`Shortcut: ${entry.hint.split(" ").join(" then ")}`}>
                          {entry.hint.split(" ").map((k, i) => (
                            <Kbd key={i}>{k}</Kbd>
                          ))}
                        </span>
                      ) : (
                        <span className="ms-auto shrink-0 truncate ps-3 text-xs text-secondary-label">{entry.hint}</span>
                      ))}
                  </CommandItem>
                );
              }}
            </CommandList>
            {items.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">Nothing matches.</div>}
          </CommandPanel>
          <CommandFooter>
            <span className="flex items-center gap-1.5 text-xs text-secondary-label">
              <Kbd>
                <CornerDownLeftIcon className="size-3" />
              </Kbd>
              open
            </span>
            <span className="flex items-center gap-1.5 text-xs text-secondary-label">
              <Kbd>esc</Kbd> close
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
