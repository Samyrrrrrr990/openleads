import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Body, ErrorNote, LoadingRows, Panel, Quiet, Stat } from "~/components/app/bits";
import { Pick } from "~/components/app/Pick";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { api } from "~/lib/api";
import { refreshCounts } from "~/lib/counts";
import { ago, money, pct, plural } from "~/lib/format";
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
  const closed = board?.columns.filter((c) => c.key === "won" || c.key === "lost").reduce((a, c) => a + c.count, 0) ?? 0;
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
      <Body>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!board && res.loading && <LoadingRows />}
        {board && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Open deals" value={money(board.totals.open_value)} note={`Across ${plural(board.totals.open_count, "deal", "deals")}`} />
              <Stat label="Likely to close" value={money(board.totals.weighted)} note="Each deal counted by its stage's odds" />
              <Stat label="Won" value={money(board.totals.won_value)} note="Deals marked won" />
              <Stat label="Win rate" value={pct(board.totals.win_rate)} note={closed < 10 ? `From ${plural(closed, "closed deal", "closed deals")}. Too few to judge yet` : `From ${closed} closed deals`} />
            </div>
            <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-1 max-md:-mx-4 max-md:snap-x max-md:px-4">
              {board.columns.map((col) => (
                <section key={col.key} className="flex min-w-40 flex-1 flex-col rounded-xl border border-border bg-muted/60 max-md:min-w-[78vw] max-md:snap-start">
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
                        <p className="mt-2 text-[13px] font-semibold tabular-nums">{money(d.amount, d.currency || "USD")}</p>
                        <Pick label={`Stage of ${d.name}`} value={d.stage} onChange={(s) => move(d, s)} options={stages} className="mt-2 w-full text-xs" />
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </Body>
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

function rest(a: ActivityRow): string {
  const s = (a.summary ?? "").trim();
  if (!a.name) return s;
  return s.toLowerCase().startsWith(a.name.toLowerCase()) ? s.slice(a.name.length).replace(/^[\s,:.-]+/, "") : s;
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
              <div key={a.id} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-border px-3.5 py-2 text-[13px] last:border-b-0 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:py-2.5 max-md:text-sm">
                <span className="font-medium">{a.label}</span>
                <span className="min-w-0 text-muted-foreground max-md:order-3 max-md:col-span-2 md:truncate">
                  {a.name && a.ref ? (
                    <a href={href("people", "people", a.ref)} className="text-foreground hover:underline">
                      {a.name}
                    </a>
                  ) : null}
                  {/* The summary often starts with the same name; say it once. */}
                  {a.name && rest(a) ? ", " : ""}
                  {rest(a)}
                </span>
                <span className="text-xs text-muted-foreground">{ago(a.ts)}</span>
              </div>
            ))}
          </Panel>
        )}
      </Body>
    </>
  );
}
