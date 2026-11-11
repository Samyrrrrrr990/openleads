import { CheckIcon, ClockIcon, CopyIcon, InfoIcon, PencilIcon, SendIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Avatar, Panel, Row } from "~/components/app/bits";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { api } from "~/lib/api";
import { setCounts } from "~/lib/counts";
import { ago, due } from "~/lib/format";
import { href } from "~/lib/router";
import { fail, toast } from "~/lib/toast";
import type { Briefing as BriefingData, Counts, Draft, HeadsUp, Reply, Task } from "~/lib/types";
import { cn } from "~/lib/utils";

type Done = { counts?: Counts };

function IconAction({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="icon-xs" variant="ghost-muted" aria-label={label} onClick={onClick} disabled={disabled} />}>{children}</TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

function ReplyRow({ r, onChanged }: { r: Reply; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (path: string, body: unknown, said: string) => {
    setBusy(true);
    try {
      setCounts((await api.post<Done>(path, body)).counts);
      toast(said);
      onChanged();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };
  return (
    <Row>
      <Avatar name={r.name} email={r.email} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <a href={href("people", "people", r.email)} className="truncate text-[13px] font-medium hover:underline">
            {r.name || r.email}
          </a>
          {r.organization && <span className="truncate text-xs text-muted-foreground">{r.organization}</span>}
          {r.likely_no && <Badge variant="secondary">Looks like a no</Badge>}
          <span className="ms-auto shrink-0 text-xs text-muted-foreground">{ago(r.received)}</span>
        </div>
        <p className="mt-0.5 text-[13px] leading-5 text-foreground/90">{r.snippet || r.subject}</p>
        {r.suggestion && (
          <div className="mt-2 rounded-lg border border-border bg-muted px-3 py-2">
            <div className="mb-0.5 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              Suggested answer
              <button
                type="button"
                className="ms-auto flex cursor-pointer items-center gap-1 normal-case tracking-normal hover:text-foreground"
                onClick={() => navigator.clipboard?.writeText(r.suggestion).then(() => toast("Copied"), () => fail("Couldn't copy"))}
              >
                <CopyIcon className="size-3" /> Copy
              </button>
            </div>
            <p className="text-[13px] leading-5">{r.suggestion}</p>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        <IconAction label="Remind me tomorrow" disabled={busy} onClick={() => act("/api/today/snooze", { kind: "reply", ref: r.email, until: "tomorrow" }, "Back tomorrow")}>
          <ClockIcon />
        </IconAction>
        <IconAction label="Done, I answered or it needs no answer" disabled={busy} onClick={() => act("/api/replies/done", { email: r.email }, "Marked done")}>
          <CheckIcon />
        </IconAction>
      </div>
    </Row>
  );
}

export function DraftRow({ d, onChanged }: { d: Draft; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(d.subject);
  const [body, setBody] = useState(d.body);

  const approve = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ status: string; detail?: string } & Done>("/api/drafts/approve", {
        id: d.id,
        ...(editing ? { subject, body } : {}),
      });
      setCounts(res.counts);
      if (res.status === "sent") toast(`Sent to ${d.email}`);
      else toast(res.detail || `Not sent (${res.status})`, res.status === "error" ? "error" : "default");
      onChanged();
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  };
  const skip = async () => {
    setBusy(true);
    try {
      setCounts((await api.post<Done>("/api/drafts/skip", { id: d.id })).counts);
      toast("Skipped");
      onChanged();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };
  const first = d.body.split("\n").find((l) => l.trim()) ?? "";

  return (
    <Row className="flex-col gap-2">
      <div className="flex w-full items-start gap-3">
        <Avatar email={d.email} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <a href={href("people", "people", d.email)} className="addr truncate text-[13px] font-medium hover:underline">
              {d.email}
            </a>
            <span className={cn("ms-auto shrink-0 text-xs tabular-nums", d.quality >= 80 ? "text-success-foreground" : d.quality >= 60 ? "text-muted-foreground" : "text-warning-foreground")}>
              quality {d.quality}
            </span>
          </div>
          {!editing && (
            <>
              <p className="truncate text-[13px] font-medium">{d.subject}</p>
              <p className="truncate text-[13px] text-muted-foreground">{first}</p>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconAction label={editing ? "Close the editor" : "Read and edit"} onClick={() => setEditing((v) => !v)}>
            <PencilIcon />
          </IconAction>
          <IconAction label="Skip, don't send this one" disabled={busy} onClick={skip}>
            <XIcon />
          </IconAction>
          <Button size="xs" disabled={busy} onClick={approve} className="ms-1">
            <SendIcon /> Approve
          </Button>
        </div>
      </div>
      {editing && (
        <div className="flex w-full flex-col gap-2 ps-10">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} aria-label="Email body" className="font-sans leading-6" />
          <p className="text-xs text-muted-foreground">Approve sends what you see here.</p>
        </div>
      )}
    </Row>
  );
}

export function TaskRow({ t, onChanged }: { t: Task; onChanged: () => void }) {
  const [done, setDone] = useState(false);
  const d = due(t.due);
  const complete = async () => {
    setDone(true);
    try {
      await api.post("/api/tasks/complete", { id: t.id });
      toast("Task done");
      onChanged();
    } catch (e) {
      setDone(false);
      fail(e);
    }
  };
  return (
    <Row className="items-center">
      <button
        type="button"
        onClick={complete}
        aria-label={`Complete: ${t.title}`}
        className={cn(
          "grid size-4.5 shrink-0 cursor-pointer place-items-center rounded-full border border-input text-transparent transition-colors hover:border-success hover:text-success",
          done && "border-success bg-success text-white",
        )}
      >
        <CheckIcon className="size-3" />
      </button>
      <div className="min-w-0 flex-1">
        <span className={cn("text-[13px]", done && "text-muted-foreground line-through")}>{t.title}</span>
        {(t.contact_name || t.contact_org) && (
          <a href={href("people", "people", t.contact)} className="ms-2 text-xs text-muted-foreground hover:underline">
            {[t.contact_name, t.contact_org].filter(Boolean).join(", ")}
          </a>
        )}
      </div>
      {t.priority === "high" && <Badge variant="warning">High</Badge>}
      <span className={cn("shrink-0 text-xs", d.late ? "text-error-foreground" : "text-muted-foreground")}>{d.label}</span>
    </Row>
  );
}

const HEADS: Record<string, { icon: typeof InfoIcon; cls: string }> = {
  bad: { icon: TriangleAlertIcon, cls: "text-error-foreground" },
  warn: { icon: TriangleAlertIcon, cls: "text-warning-foreground" },
  info: { icon: InfoIcon, cls: "text-info-foreground" },
};

/** `code` spans in a heads-up are written with backticks by the server. */
function withCode(message: string) {
  return message.split("`").map((part, i) =>
    i % 2 ? (
      <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

function HeadsUpList({ items }: { items: HeadsUp[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((h, i) => {
        const { icon: Icon, cls } = HEADS[h.level] ?? HEADS.info;
        return (
          <div key={i} className="flex gap-2 text-[13px] leading-5 text-muted-foreground">
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", cls)} />
            <span>
              {withCode(h.message)}{" "}
              {h.message.includes("openleads setup ai") ? (
                <a className="text-foreground underline underline-offset-2" href={href("settings", "model")}>
                  Choose a model
                </a>
              ) : h.message.includes("openleads setup") ? (
                <a className="text-foreground underline underline-offset-2" href="/classic/#/settings">
                  Open settings
                </a>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Briefing({ b, onChanged }: { b: BriefingData; onChanged: () => void }) {
  const tasks = [...b.tasks.overdue, ...b.tasks.today];
  const more = b.counts.drafts - b.drafts.length;
  const calm = !b.replies.length && !b.drafts.length && !tasks.length;
  return (
    <>
      {b.replies.length > 0 && (
        <Panel title="Replies" count={b.replies.length}>
          {b.replies.map((r) => (
            <ReplyRow key={r.email} r={r} onChanged={onChanged} />
          ))}
        </Panel>
      )}
      {b.drafts.length > 0 && (
        <Panel
          title="Emails to approve"
          count={b.counts.drafts}
          action={
            more > 0 ? (
              <a className="text-xs text-muted-foreground hover:text-foreground" href={href("outreach", "approvals")}>
                See all
              </a>
            ) : undefined
          }
        >
          {b.drafts.slice(0, 5).map((d) => (
            <DraftRow key={d.id} d={d} onChanged={onChanged} />
          ))}
        </Panel>
      )}
      {tasks.length > 0 && (
        <Panel
          title="Tasks"
          count={tasks.length}
          action={
            <a className="text-xs text-muted-foreground hover:text-foreground" href={href("pipeline", "tasks")}>
              All tasks
            </a>
          }
        >
          {tasks.map((t) => (
            <TaskRow key={t.id} t={t} onChanged={onChanged} />
          ))}
        </Panel>
      )}
      {b.new_leads.count > 0 && (
        <Panel
          title="New people"
          count={b.new_leads.count}
          action={
            <a className="text-xs text-muted-foreground hover:text-foreground" href={href("people")}>
              See them
            </a>
          }
        >
          {b.new_leads.items.slice(0, 4).map((p) => (
            <Row key={p.email} className="items-center">
              <Avatar name={p.name} email={p.email} />
              <a href={href("people", "people", p.email)} className="truncate text-[13px] font-medium hover:underline">
                {p.name || p.email}
              </a>
              <span className="truncate text-xs text-muted-foreground">{[p.title, p.organization].filter(Boolean).join(", ")}</span>
            </Row>
          ))}
        </Panel>
      )}
      {calm && (
        <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
          <p className="text-[15px] font-medium">Nothing needs you right now.</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Ask for something below, or find people to start with.</p>
        </div>
      )}
      {b.heads_up.length > 0 && <HeadsUpList items={b.heads_up} />}
    </>
  );
}
