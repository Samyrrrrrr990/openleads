import { PauseIcon, PlayIcon } from "lucide-react";

import { Body, ErrorNote, LoadingRows, Panel, Quiet } from "~/components/app/bits";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { api } from "~/lib/api";
import { setCounts } from "~/lib/counts";
import { ago, pct, plural } from "~/lib/format";
import { classic } from "~/lib/router";
import { fail, toast } from "~/lib/toast";
import type { Counts, Draft } from "~/lib/types";
import { useApi } from "~/lib/use-api";
import { DraftRow } from "~/views/today/Briefing";

const SECTION = sectionOf("outreach");

export function Approvals() {
  const res = useApi<{ drafts: Draft[]; count: number }>("/api/drafts/waiting");
  const reload = () => {
    void res.reload();
    api
      .get<{ counts: Counts }>("/api/today")
      .then((b) => setCounts(b.counts))
      .catch(() => {});
  };
  return (
    <>
      <PageHeader section={SECTION} page="approvals" />
      <Body>
        <p className="text-[13px] text-muted-foreground">
          First emails wait here until you say yes. Approve sends the email as written; open one to read or change it first.
        </p>
        {res.error && <ErrorNote message={res.error} onRetry={reload} />}
        {!res.data && res.loading && <LoadingRows />}
        {res.data &&
          (res.data.drafts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center">
              <p className="text-[15px] font-medium">Nothing is waiting for approval.</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Emails from sequences, workflows and requests show up here before they send.</p>
            </div>
          ) : (
            <Panel title="Waiting for your yes" count={res.data.count}>
              {res.data.drafts.map((d) => (
                <DraftRow key={d.id} d={d} onChanged={reload} />
              ))}
            </Panel>
          ))}
      </Body>
    </>
  );
}

interface Sequence {
  id: number;
  name: string;
  status: string;
  steps: { type: string; delay_days: number }[];
  updated: number;
  stats: { enrolled: number; active: number; sent: number; replied: number; reply_rate: number; due_now: number };
}

const STEP_WORDS: Record<string, string> = {
  auto_email: "email",
  manual_email: "email by hand",
  call: "call",
  linkedin: "LinkedIn",
  task: "task",
};

function stepLine(steps: Sequence["steps"]): string {
  return steps.map((s, i) => `${i === 0 ? "" : `+${s.delay_days}d `}${STEP_WORDS[s.type] ?? s.type}`).join("  →  ");
}

export function Sequences() {
  const res = useApi<{ sequences: Sequence[] }>("/api/sequences");
  const toggle = async (s: Sequence) => {
    const status = s.status === "active" ? "paused" : "active";
    try {
      await api.post("/api/sequences/status", { id: s.id, status });
      toast(status === "active" ? `${s.name} is running` : `${s.name} is paused`);
      void res.reload();
    } catch (e) {
      fail(e);
    }
  };
  const list = res.data?.sequences ?? [];
  return (
    <>
      <PageHeader
        section={SECTION}
        page="sequences"
        actions={
          <Button size="sm" render={<a href={classic("outreach", "sequences")} />}>
            New sequence
          </Button>
        }
      />
      <Body>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!res.data && res.loading && <LoadingRows />}
        {res.data && list.length === 0 && <Quiet>No sequences yet. A sequence is a few emails and tasks spaced over days.</Quiet>}
        {list.map((s) => (
          <section key={s.id} className="rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2.5 px-4 pt-3.5">
              <a href={classic("outreach", `sequences/${s.id}`)} className="font-medium hover:underline">
                {s.name}
              </a>
              <Badge variant={s.status === "active" ? "success" : "secondary"}>{s.status === "active" ? "Running" : s.status === "paused" ? "Paused" : s.status}</Badge>
              <span className="ms-auto text-xs text-muted-foreground">Updated {ago(s.updated)}</span>
              <Button size="xs" variant="outline" onClick={() => toggle(s)}>
                {s.status === "active" ? <PauseIcon /> : <PlayIcon />}
                {s.status === "active" ? "Pause" : "Start"}
              </Button>
            </div>
            <p className="px-4 pt-1.5 text-[13px] text-muted-foreground">{stepLine(s.steps)}</p>
            <dl className="mt-3 grid grid-cols-4 border-t border-border text-center">
              {[
                ["Enrolled", plural(s.stats.enrolled, "person", "people")],
                ["Active", String(s.stats.active)],
                ["Sent", String(s.stats.sent)],
                ["Replied", `${s.stats.replied} (${pct(s.stats.reply_rate)})`],
              ].map(([k, v]) => (
                <div key={k} className="border-e border-border px-3 py-2.5 last:border-e-0">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 text-[13px] font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </Body>
    </>
  );
}

interface Template {
  id: number;
  name: string;
  subject: string;
  body: string;
  category: string;
  used: number;
}

export function Templates() {
  const res = useApi<{ templates: Template[] }>("/api/templates");
  const list = res.data?.templates ?? [];
  return (
    <>
      <PageHeader
        section={SECTION}
        page="templates"
        actions={
          <Button size="sm" variant="outline" render={<a href={classic("outreach", "templates")} />}>
            Edit templates
          </Button>
        }
      />
      <Body>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!res.data && res.loading && <LoadingRows />}
        {res.data && list.length === 0 && <Quiet>No templates yet.</Quiet>}
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((t) => (
            <a key={t.id} href={classic("outreach", "templates")} className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-input">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{t.name}</span>
                {t.category && <Badge variant="secondary">{t.category}</Badge>}
                <span className="ms-auto shrink-0 text-xs text-muted-foreground">used {t.used}×</span>
              </div>
              <p className="mt-2 truncate text-[13px]">{t.subject}</p>
              <p className="mt-1 line-clamp-3 whitespace-pre-line text-[13px] leading-5 text-muted-foreground">{t.body}</p>
            </a>
          ))}
        </div>
      </Body>
    </>
  );
}
