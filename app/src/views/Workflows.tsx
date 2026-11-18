import { PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorNote } from "~/components/app/bits";
import { Button } from "~/components/ui/button";
import { api } from "~/lib/api";
import { href, navigate } from "~/lib/router";
import { fail } from "~/lib/toast";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";
import { type Template, title } from "~/views/workflows/model";
import { setDraft } from "~/views/workflows/useWorkflow";
import { DescribeComposer, WorkflowView } from "~/views/workflows/WorkflowView";
import type { Graph } from "~/views/workflows/model";

interface Workflow {
  name: string;
  description: string;
  active: boolean;
  live: boolean;
  nodes: number;
  when: string;
  last_run_at: string;
  waiting: number;
}

const EXAMPLES = [
  "Every weekday at 9 find 20 dentists in Toronto, write emails and send them",
  "When someone replies, move them to interested and create a task",
  "Every Monday take people in list Hot, wait 3 days, then start the Follow-up sequence",
  "Daily find 50 roofers in Denver, only safe ones, export to sheets and notify me",
];

/** "3h", "2d": T3's thread-list time. */
function short(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sentence(text: string): string {
  const t = (text || "").replace(/\b0(\d:\d\d)\b/, "$1");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function useWorkflowList() {
  const res = useApi<{ workflows: Workflow[] }>("/api/workflows");
  useEffect(() => {
    const reload = () => void res.reload();
    window.addEventListener("openleads:workflows-changed", reload);
    return () => window.removeEventListener("openleads:workflows-changed", reload);
  }, [res]);
  return res;
}

/** Turn a sentence into a draft workflow and open it. */
async function describeNew(text: string) {
  const out = await api.post<{ workflow: Graph; understood: string[]; skipped: string }>("/api/workflows/draft", { text });
  setDraft(out.workflow, out.understood, out.skipped, text);
  navigate("workflows", "new");
}

/** "#/workflows" opens the start screen; "#/workflows/<name>" (or "new") one workflow. */
export function Workflows({ open }: { open?: string }) {
  const list = useWorkflowList();
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <WorkflowList list={list.data?.workflows ?? null} error={list.error} onRetry={() => void list.reload()} active={open} className="max-md:hidden" />
      {open ? <WorkflowView name={open === "new" ? "" : open} /> : <Start list={list.data?.workflows ?? []} />}
    </div>
  );
}

/** T3's thread list: a dot for on or off, the name, when it last ran. */
function WorkflowList({ list, error, onRetry, active, className }: { list: Workflow[] | null; error: string; onRetry: () => void; active?: string; className?: string }) {
  const [q, setQ] = useState("");
  const hits = (list ?? []).filter((w) => !q || `${w.name} ${w.description}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <aside className={cn("flex w-64 shrink-0 flex-col border-e border-border", className)} aria-label="Workflows">
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-3.5">
        <h1 className="text-sm font-semibold">Workflows</h1>
        <Button size="icon-sm" variant="ghost" className="ms-auto" aria-label="New workflow" render={<a href={href("workflows", "new")} />}>
          <PlusIcon />
        </Button>
      </div>
      {list && list.length > 6 && (
        <div className="relative px-2 pb-2">
          <SearchIcon className="pointer-events-none absolute left-4.5 top-1/2 size-3.5 -translate-y-1/2 -mt-1 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search workflows"
            aria-label="Search workflows"
            className="h-8 w-full rounded-lg border border-border bg-transparent ps-7.5 pe-2.5 text-[13px] outline-none placeholder:text-placeholder focus:border-ring/60"
          />
        </div>
      )}
      <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-2">
        <a
          href={href("workflows")}
          aria-current={!active ? "page" : undefined}
          className={cn("flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground", !active && "bg-accent font-medium text-foreground")}
        >
          <PlusIcon className="size-3.5" /> Describe a new one
        </a>
        {active === "new" && (
          <span className="flex h-8 shrink-0 items-center gap-2 rounded-lg bg-accent px-2.5 text-[13px] font-medium">
            <span className="size-1.5 rounded-full border border-muted-foreground" /> New workflow
          </span>
        )}
        {error && <ErrorNote message={error} onRetry={onRetry} />}
        {list === null && !error && <span className="px-2.5 py-2 text-xs text-muted-foreground">Loading</span>}
        {hits.map((w) => {
          const on = active === w.name;
          return (
            <a
              key={w.name}
              href={href("workflows", w.name)}
              aria-current={on ? "page" : undefined}
              title={w.description || title(w.name)}
              className={cn("group flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground", on && "bg-accent text-foreground")}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", w.waiting > 0 ? "bg-warning" : w.active ? "bg-success" : "bg-muted-foreground/40")} aria-label={w.waiting > 0 ? "Waiting for approval" : w.active ? "On" : "Off"} />
              <span className={cn("min-w-0 flex-1 truncate", on && "font-medium")}>{title(w.name)}</span>
              {w.waiting > 0 ? (
                <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-2xs font-medium leading-4 text-warning-foreground tabular-nums">{w.waiting}</span>
              ) : (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground/80">{short(w.last_run_at)}</span>
              )}
            </a>
          );
        })}
        {list && list.length === 0 && <p className="px-2.5 py-2 text-xs leading-5 text-muted-foreground">Nothing yet. Describe one, or start from a template.</p>}
      </nav>
    </aside>
  );
}

/** No workflow open: T3's empty thread, a composer and some places to start. */
function Start({ list }: { list: Workflow[] }) {
  const templates = useApi<{ templates: Template[] }>("/api/workflows/templates");
  const [busy, setBusy] = useState(false);
  const go = async (text: string) => {
    setBusy(true);
    try {
      await describeNew(text);
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };
  const fromTemplate = (t: Template) => {
    setDraft({ name: "", description: t.graph.description, active: false, live: false, nodes: t.graph.nodes, edges: t.graph.edges }, [], "");
    navigate("workflows", "new");
  };
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[var(--content-max)] flex-col justify-center gap-6 px-5 py-8 max-md:px-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">What should run on its own?</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">Say when and what. You get the steps to read and change, and nothing is saved or sent until you say so.</p>
        </div>
        <DescribeComposer onSend={(t) => void go(t)} busy={busy} autoFocus hint="You get the steps to check first" />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={busy}
              onClick={() => void go(ex)}
              className="cursor-pointer rounded-lg border border-border bg-card px-2.5 py-2 text-start text-[13px] leading-5 text-muted-foreground transition-colors hover:border-input hover:text-foreground disabled:opacity-60 max-md:text-sm"
            >
              {ex}
            </button>
          ))}
        </div>

        {/* On a phone the list column is hidden, so the workflows show here. */}
        {list.length > 0 && (
          <section className="md:hidden">
            <h3 className="mb-1.5 text-[13px] font-medium">Your workflows</h3>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {list.map((w) => (
                <a key={w.name} href={href("workflows", w.name)} className="flex min-h-12 items-center gap-2.5 border-b border-border px-3.5 py-2 text-sm last:border-b-0">
                  <span className={cn("size-1.5 shrink-0 rounded-full", w.active ? "bg-success" : "bg-muted-foreground/40")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{title(w.name)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{sentence(w.when) || "Run by hand"}</span>
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}

        {templates.data && templates.data.templates.length > 0 && (
          <section>
            <h3 className="text-[13px] font-medium">Or start from a template</h3>
            <div className="mt-2 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
              {templates.data.templates.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => fromTemplate(t)}
                  className="flex cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-border bg-card px-3 py-2.5 text-start transition-colors hover:border-input"
                >
                  <span className="text-[13px] font-medium">{t.title || t.name || title(t.key)}</span>
                  <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">{t.description || t.graph.description}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
