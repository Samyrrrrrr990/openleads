import { PauseIcon, PlayIcon } from "lucide-react";

import { Body, ErrorNote, Figure, LoadingRows, Panel, Quiet } from "~/components/app/bits";
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
        <p className="text-[13px] text-muted-foreground max-md:text-sm">
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
            <Panel title="Emails to approve" count={res.data.count}>
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
  return steps
    .map((s, i) => {
      const what = STEP_WORDS[s.type] ?? s.type;
      if (i === 0) return what.charAt(0).toUpperCase() + what.slice(1);
      return `${what} ${s.delay_days === 0 ? "the same day" : s.delay_days === 1 ? "a day later" : `${s.delay_days} days later`}`;
    })
    .join(", then ");
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
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 pt-3.5">
              <a href={classic("outreach", `sequences/${s.id}`)} className="text-[13px] font-semibold hover:underline max-md:text-sm">
                {s.name}
              </a>
              <Badge variant={s.status === "active" ? "success" : "secondary"}>{s.status === "active" ? "Running" : s.status === "paused" ? "Paused" : s.status}</Badge>
              <span className="ms-auto text-xs text-muted-foreground max-sm:hidden">Updated {ago(s.updated)}</span>
              <Button size="sm" variant="outline" className="max-md:h-10 max-sm:ms-auto" onClick={() => toggle(s)}>
                {s.status === "active" ? <PauseIcon /> : <PlayIcon />}
                {s.status === "active" ? "Pause" : "Start"}
              </Button>
            </div>
            <p className="px-3.5 pt-1.5 text-[13px] leading-5 text-muted-foreground max-md:text-sm">{stepLine(s.steps)}</p>
            <div className="mt-3 grid grid-cols-4 border-t border-border max-sm:grid-cols-2 [&>*]:border-border sm:[&>*:not(:last-child)]:border-e max-sm:[&>*:nth-child(-n+2)]:border-b max-sm:[&>*:nth-child(odd)]:border-e">
              <Figure label="Enrolled" value={s.stats.enrolled.toLocaleString()} note={s.stats.enrolled === 1 ? "person" : "people"} />
              <Figure label="Active now" value={s.stats.active.toLocaleString()} note="still getting steps" />
              <Figure label="Emails sent" value={s.stats.sent.toLocaleString()} note="so far" />
              <Figure
                label="Reply rate"
                value={s.stats.enrolled ? pct((s.stats.replied / s.stats.enrolled) * 100) : "—"}
                note={s.stats.enrolled ? `${s.stats.replied} of ${s.stats.enrolled} enrolled replied${s.stats.enrolled < 50 ? ". Too few to judge yet." : ""}` : "Enrol people to start"}
              />
            </div>
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

const SAMPLE: Record<string, string> = {
  first_name: "Jane",
  last_name: "Doe",
  name: "Jane Doe",
  organization: "Acme",
  company: "Acme",
  title: "Head of Operations",
  city: "Austin",
  industry: "software",
  website: "acme.example",
  sender_name: "your name",
  my_name: "your name",
  sender_org: "your company",
  sender_context: "a line about what you offer",
};

function Blank({ children }: { children: React.ReactNode }) {
  return <span className="rounded-sm bg-accent px-0.5 text-foreground">{children}</span>;
}

/** A template with its blanks filled for a sample person, so it reads as an email. */
function filled(text: string): React.ReactNode[] {
  // "{Hi|Hey}" means either wording is used; show the first.
  return text.replace(/\{([^{}|]+)\|[^{}]*\}/g, "$1").split(/(\{\{[^}]+\}\}|\{[\w.]+\})/g).map((part, i) => {
    const m = /^\{\{?\s*([\w.]+)\s*(?:\|([^}]*))?\}?\}$/.exec(part);
    if (!m) return part;
    return <Blank key={i}>{SAMPLE[m[1]] ?? (m[2]?.trim() || m[1].replace(/_/g, " "))}</Blank>;
  });
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
        {res.data && list.length === 0 && <Quiet>No templates yet. Use Edit templates to write your first one.</Quiet>}
        {list.length > 0 && (
          <p className="text-[13px] text-muted-foreground">
            Shown the way one would read for <Blank>Jane</Blank> at <Blank>Acme</Blank>. The marked words are filled in for each person.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((t) => (
            <a key={t.id} href={classic("outreach", "templates")} className="flex flex-col rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-input">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-semibold max-md:text-sm">{t.name}</span>
                {t.category && <Badge variant="secondary">{t.category}</Badge>}
                {t.used > 0 && <span className="ms-auto shrink-0 text-xs text-muted-foreground">Used {plural(t.used, "time", "times")}</span>}
              </div>
              <p className="mt-2 truncate text-[13px] max-md:text-sm">{filled(t.subject)}</p>
              <p className="mt-1 line-clamp-3 whitespace-pre-line text-[13px] leading-5 text-muted-foreground max-md:text-sm">{filled(t.body)}</p>
            </a>
          ))}
        </div>
      </Body>
    </>
  );
}
