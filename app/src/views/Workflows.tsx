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
      toast(active ? `${w.name} is on` : `${w.name} is off`);
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
          A workflow is a saved plan: find, filter, write, send, on a schedule or when something happens. Asking for something "every weekday" on Today saves one here.
        </p>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!res.data && res.loading && <LoadingRows />}
        {res.data && list.length === 0 && <Quiet>No workflows yet.</Quiet>}
        {list.map((w) => (
          <section key={w.name} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <a href={classic("workflows", `workflows/${encodeURIComponent(w.name)}`)} className="font-medium hover:underline">
                  {w.name}
                </a>
                <Badge variant="secondary">{w.when || "run by hand"}</Badge>
                {w.live ? <Badge variant="warning">Sends for real</Badge> : <Badge variant="outline">Emails wait for approval</Badge>}
                {w.waiting > 0 && <Badge variant="info">{w.waiting} waiting</Badge>}
              </div>
              {w.description && <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{w.description}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                {w.nodes} steps. Last run: {when(w.last_run_at)}.{" "}
                <a className="text-foreground hover:underline" href={classic("workflows", `workflows/${encodeURIComponent(w.name)}`)}>
                  Open the editor
                </a>
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {w.active ? "On" : "Off"}
              <Switch checked={w.active} onCheckedChange={(v) => setActive(w, v)} aria-label={`Turn ${w.name} ${w.active ? "off" : "on"}`} />
            </label>
          </section>
        ))}
        {runs.data && runs.data.runs.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="flex h-10 items-center border-b border-border px-3.5 text-[13px] font-semibold">Recent runs</header>
            {runs.data.runs.slice(0, 10).map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-border px-3.5 py-2 text-[13px] last:border-b-0">
                <span className="font-medium">{r.workflow}</span>
                <Badge variant={r.status === "ok" ? "success" : r.status === "error" ? "error" : "secondary"}>{r.status}</Badge>
                <span className="ms-auto text-xs text-muted-foreground">{when(r.started_at || "")}</span>
              </div>
            ))}
          </section>
        )}
      </Body>
    </>
  );
}
