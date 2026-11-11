import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Body, ErrorNote, LoadingRows, Panel, Quiet } from "~/components/app/bits";
import { Pick } from "~/components/app/Pick";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { api } from "~/lib/api";
import { refreshCounts } from "~/lib/counts";
import { ago, money, pct } from "~/lib/format";
import { classic, href } from "~/lib/router";
import { fail, toast } from "~/lib/toast";
import type { Activity as ActivityRow, Task } from "~/lib/types";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";
import { TaskRow } from "~/views/today/Briefing";

const SECTION = sectionOf("pipeline");

interface Deal {
  id: number;
  name: string;
  stage: string;
  amount: number;
  currency: string;
  close_date: string;
  contact: string;
  account_name: string;
  contact_name: string;
}

interface Board {
  columns: { key: string; label: string; probability: number; deals: Deal[]; count: number; total: number }[];
  totals: { open_count: number; open_value: number; weighted: number; won_value: number; win_rate: number };
}

export function Deals() {
  const res = useApi<Board>("/api/deals");
  const board = res.data;
  const move = async (d: Deal, stage: string) => {
    try {
      await api.post("/api/deals/move", { id: d.id, stage });
      toast(`${d.name} moved`);
      void res.reload();
    } catch (e) {
      fail(e);
    }
  };
  const stages = board?.columns.map((c) => ({ key: c.key, label: c.label })) ?? [];
  return (
    <>
      <PageHeader
        section={SECTION}
        page="deals"
        actions={
          <Button size="sm" render={<a href={classic("pipeline", "deals")} />}>
            New deal
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!board && res.loading && <LoadingRows />}
        {board && (
          <>
            <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2">
              {[
                ["Open", `${money(board.totals.open_value)} in ${board.totals.open_count}`],
                ["Weighted", money(board.totals.weighted)],
                ["Won", money(board.totals.won_value)],
                ["Win rate", pct(board.totals.win_rate)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-[15px] font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex min-w-max gap-3">
              {board.columns.map((col) => (
                <section key={col.key} className="flex w-64 shrink-0 flex-col rounded-xl border border-border bg-muted/60">
                  <header className="flex items-center gap-2 px-3 py-2.5">
                    <h2 className="text-[13px] font-semibold">{col.label}</h2>
                    <span className="text-xs text-muted-foreground tabular-nums">{col.count}</span>
                    <span className="ms-auto text-xs text-muted-foreground tabular-nums">{col.total ? money(col.total) : ""}</span>
                  </header>
                  <div className="flex flex-col gap-2 px-2 pb-2">
                    {col.deals.length === 0 && <p className="px-1 py-3 text-center text-xs text-muted-foreground">Nothing here</p>}
                    {col.deals.map((d) => (
                      <article key={d.id} className="rounded-lg border border-border bg-card p-3 shadow-xs/5">
                        <p className="text-[13px] font-medium leading-5">{d.name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {d.contact ? (
                            <a className="hover:underline" href={href("people", "people", d.contact)}>
                              {d.contact_name || d.contact}
                            </a>
                          ) : (
                            d.account_name
                          )}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[13px] font-semibold tabular-nums">{money(d.amount, d.currency || "USD")}</span>
                          <Pick label={`Stage of ${d.name}`} value={d.stage} onChange={(s) => move(d, s)} options={stages} className="ms-auto h-6 text-xs sm:h-6" />
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

const BUCKETS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "nodate", label: "No date" },
];

function Bucket({ bucket, label, stamp, onChanged }: { bucket: string; label: string; stamp: number; onChanged: () => void }) {
  const res = useApi<{ tasks: Task[] }>(`/api/tasks?bucket=${bucket}&v=${stamp}`);
  const tasks = res.data?.tasks ?? [];
  if (!tasks.length) return null;
  return (
    <Panel title={<span className={cn(bucket === "overdue" && "text-error-foreground")}>{label}</span>} count={tasks.length}>
      {tasks.map((t) => (
        <TaskRow key={t.id} t={t} onChanged={onChanged} />
      ))}
    </Panel>
  );
}

export function Tasks() {
  const [title, setTitle] = useState("");
  const [stamp, setStamp] = useState(0);
  const counts = useApi<{ counts: Record<string, number> }>(`/api/tasks?bucket=open&v=${stamp}`);
  const changed = () => {
    setStamp((s) => s + 1);
    void refreshCounts();
  };
  const add = async () => {
    const t = title.trim();
    if (!t) return;
    try {
      await api.post("/api/tasks/save", { title: t, due: "today" });
      setTitle("");
      toast("Task added for today");
      changed();
    } catch (e) {
      fail(e);
    }
  };
  const open = counts.data?.counts.open ?? 0;
  return (
    <>
      <PageHeader section={SECTION} page="tasks" />
      <Body>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task for today" aria-label="New task" />
          <Button type="submit" variant="outline" disabled={!title.trim()}>
            <PlusIcon /> Add
          </Button>
        </form>
        {counts.error && <ErrorNote message={counts.error} onRetry={changed} />}
        {counts.data && open === 0 && <Quiet>No open tasks. Sequences and replies add them for you.</Quiet>}
        {BUCKETS.map((b) => (
          <Bucket key={b.key} bucket={b.key} label={b.label} stamp={stamp} onChanged={changed} />
        ))}
      </Body>
    </>
  );
}

export function Activity() {
  const res = useApi<{ activity: ActivityRow[] }>("/api/activity?limit=100");
  const rows = res.data?.activity ?? [];
  return (
    <>
      <PageHeader section={SECTION} page="activity" />
      <Body>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!res.data && res.loading && <LoadingRows rows={8} />}
        {res.data && rows.length === 0 && <Quiet>Nothing has happened yet.</Quiet>}
        {rows.length > 0 && (
          <Panel>
            {rows.map((a) => (
              <div key={a.id} className="flex items-baseline gap-3 border-b border-border px-3.5 py-2 text-[13px] last:border-b-0">
                <span className="w-28 shrink-0 font-medium">{a.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {a.name && a.ref ? (
                    <a href={href("people", "people", a.ref)} className="text-foreground hover:underline">
                      {a.name}
                    </a>
                  ) : null}
                  {a.name && a.summary ? "  " : ""}
                  {a.summary}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(a.ts)}</span>
              </div>
            ))}
          </Panel>
        )}
      </Body>
    </>
  );
}
