import { Body, ErrorNote, LoadingRows, Quiet } from "~/components/app/bits";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { api } from "~/lib/api";
import { classic } from "~/lib/router";
import { fail, toast } from "~/lib/toast";
import { useApi } from "~/lib/use-api";

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

interface Run {
  id: number;
  workflow: string;
  status: string;
  started_at?: string;
  trigger?: string;
}

/** "reply-to-task" is how it's stored; "Reply to task" is how it's said. */
function title(name: string): string {
  const text = name.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sentence(text: string): string {
  const t = (text || "").replace(/\b0(\d:\d\d)\b/, "$1");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const STATUS: Record<string, string> = { ok: "Finished", error: "Failed", running: "Running", waiting: "Waiting for approval", paused: "Paused" };

function when(iso: string): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function Workflows() {
  const res = useApi<{ workflows: Workflow[] }>("/api/workflows");
  const runs = useApi<{ runs: Run[]; waiting: { count: number } }>("/api/workflows/runs");
  const list = res.data?.workflows ?? [];
  const setActive = async (w: Workflow, active: boolean) => {
    res.set((prev) => (prev ? { workflows: prev.workflows.map((x) => (x.name === w.name ? { ...x, active } : x)) } : prev));
    try {
      await api.post("/api/workflows/flags", { name: w.name, active });
      toast(active ? `${title(w.name)} is on` : `${title(w.name)} is off`);
    } catch (e) {
      fail(e);
      void res.reload();
    }
  };
  return (
    <>
      <PageHeader
        section={sectionOf("workflows")}
        actions={
          <Button size="sm" render={<a href={classic("workflows", "workflows")} />}>
            New workflow
          </Button>
        }
      />
      <Body>
        <p className="text-[13px] text-muted-foreground">
          A workflow is a saved plan: find, filter, write, send, on a schedule or when something happens. Asking for something "every weekday" in Ask saves one here.
        </p>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!res.data && res.loading && <LoadingRows />}
        {res.data && list.length === 0 && <Quiet>No workflows yet. Ask for something "every weekday" to make one, or use New workflow.</Quiet>}
        {list.map((w) => (
          <section key={w.name} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <a href={classic("workflows", `workflows/${encodeURIComponent(w.name)}`)} className="text-[13px] font-semibold hover:underline max-md:text-sm">
                  {title(w.name)}
                </a>
                <span className="text-xs text-muted-foreground">{sentence(w.when) || "Run by hand"}</span>
                {w.live ? <Badge variant="warning">Sends without asking</Badge> : <Badge variant="secondary">Emails wait for approval</Badge>}
                {w.waiting > 0 && <Badge variant="info">{w.waiting} waiting</Badge>}
              </div>
              {w.description && <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground max-md:text-sm">{w.description}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                {w.nodes} steps. Last run: {when(w.last_run_at)}.{" "}
                <a className="font-medium text-foreground underline underline-offset-2 max-md:inline-flex max-md:min-h-10 max-md:items-center" href={classic("workflows", `workflows/${encodeURIComponent(w.name)}`)}>
                  Edit the steps
                </a>
              </p>
            </div>
            <label className="flex min-h-10 shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {w.active ? "On" : "Off"}
              <Switch checked={w.active} onCheckedChange={(v) => setActive(w, v)} aria-label={title(w.name)} />
            </label>
          </section>
        ))}
        {runs.data && runs.data.runs.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="flex h-10 items-center border-b border-border px-3.5 text-[13px] font-semibold">Recent runs</header>
            {runs.data.runs.slice(0, 10).map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-border px-3.5 py-2 text-[13px] last:border-b-0">
                <span className="min-w-0 truncate font-medium">{title(r.workflow)}</span>
                <Badge variant={r.status === "ok" ? "success" : r.status === "error" ? "error" : "secondary"}>{STATUS[r.status] ?? title(r.status)}</Badge>
                <span className="ms-auto shrink-0 text-xs text-muted-foreground">{when(r.started_at || "")}</span>
              </div>
            ))}
          </section>
        )}
      </Body>
    </>
  );
}
