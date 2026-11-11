import { useEffect, useState } from "react";

import { CommandPalette } from "~/components/shell/CommandPalette";
import { SECTIONS, sectionOf } from "~/components/shell/sections";
import { Sidebar } from "~/components/shell/Sidebar";
import { Toasts } from "~/components/shell/Toasts";
import { TooltipProvider } from "~/components/ui/tooltip";
import { api } from "~/lib/api";
import { refreshCounts } from "~/lib/counts";
import { navigate, useRoute } from "~/lib/router";
import { toggleTheme } from "~/lib/theme";
import { Approvals, Sequences, Templates } from "~/views/outreach/Outreach";
import { Companies } from "~/views/people/Companies";
import { Lists } from "~/views/people/Lists";
import { People } from "~/views/people/People";
import { Activity, Deals, Tasks } from "~/views/pipeline/Pipeline";
import { Doctor, Model } from "~/views/settings/Settings";
import { Soon } from "~/views/Soon";
import { Today } from "~/views/today/Today";
import { Workflows } from "~/views/Workflows";

function Screen() {
  const route = useRoute();
  const section = sectionOf(route.section);
  const page = route.rest[0] ?? section.pages[0]?.key;
  const arg = route.rest[1];
  switch (`${section.key}/${page ?? ""}`) {
    case "today/":
      return <Today />;
    case "people/people":
      return <People open={arg} />;
    case "people/companies":
      return <Companies />;
    case "people/lists":
      return <Lists open={arg} person={route.rest[2]} />;
    case "outreach/approvals":
      return <Approvals />;
    case "outreach/sequences":
      return <Sequences />;
    case "outreach/templates":
      return <Templates />;
    case "workflows/":
      return <Workflows />;
    case "pipeline/deals":
      return <Deals />;
    case "pipeline/tasks":
      return <Tasks />;
    case "pipeline/activity":
      return <Activity />;
    case "settings/model":
      return <Model />;
    case "settings/doctor":
      return <Doctor />;
    default: {
      const p = section.pages.find((x) => x.key === page);
      return <Soon section={section} page={page} label={p?.label ?? section.label} classicPath={p?.classic ?? section.key} />;
    }
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function App() {
  const route = useRoute();
  const [palette, setPalette] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    api
      .get<{ version: string }>("/api/state")
      .then((s) => setVersion(s.version))
      .catch(() => {});
    void refreshCounts();
  }, []);

  // Keyboard first: ⌘K opens the palette, "g" then a letter jumps, "t" flips the theme.
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const s = SECTIONS.find((x) => x.jump === k);
        if (s) {
          e.preventDefault();
          navigate(s.key);
        }
        return;
      }
      if (k === "g") pendingG = Date.now();
      else if (k === "t" && !e.shiftKey) toggleTheme();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = `${sectionOf(route.section).label} | OpenLeads`;
  }, [route.section]);

  return (
    <TooltipProvider delay={350}>
      <div className="flex h-full">
        <Sidebar active={sectionOf(route.section).key} version={version} onOpenPalette={() => setPalette(true)} />
        <main className="flex min-w-0 flex-1 flex-col bg-background">
          <Screen />
        </main>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      <Toasts />
    </TooltipProvider>
  );
}
