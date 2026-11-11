import { ArrowUpIcon, CheckIcon, ChevronRightIcon, InboxIcon, MailIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Avatar, Body, ErrorNote, LoadingRows, Panel, Row, Stat } from "~/components/app/bits";
import { Meter, type Point, Segments, Spark } from "~/components/app/charts";
import { BrandIcon } from "~/components/app/Mark";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Kbd } from "~/components/ui/kbd";
import { api } from "~/lib/api";
import { setCounts } from "~/lib/counts";
import { dayLabel, money, pct, plural } from "~/lib/format";
import { href, navigate } from "~/lib/router";
import { PROVIDER_BRAND, useSetup } from "~/lib/setup";
import type { Briefing as BriefingData } from "~/lib/types";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";

import { HeadsUpList, Queue } from "./Briefing";
import { ask, onRan } from "./useAsk";

interface Home {
  contacts: { total: number; new_7d: number };
  emails: { sent_30d: number; contacted: number; replied: number; reply_rate: number; warmup: { day: number; allowance: number; sent_today: number; remaining: number } };
  deals: { open_count: number; open_value: number; weighted: number };
  series: { sent: Point[]; replied: Point[]; added: Point[] };
}

interface Board {
  columns: { key: string; label: string; total: number; count: number }[];
}

function summary(b: BriefingData): string {
  const n = b.counts;
  const parts = [
    n.replies ? plural(n.replies, "reply to answer", "replies to answer") : "",
    n.drafts ? plural(n.drafts, "email to approve", "emails to approve") : "",
    n.tasks ? plural(n.tasks, "task due", "tasks due") : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : "Nothing needs you right now.";
}

/** Type a request here and it opens in Ask, where you see the plan before anything runs. */
function AskBar() {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    navigate("ask");
    void ask(t);
    setText("");
  };
  return (
    <form
      className="flex h-10 w-full items-center gap-2 rounded-xl border border-input bg-card ps-3 pe-1.5 shadow-composer transition-shadow focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/15 lg:w-[26rem]"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <SparklesIcon className="size-4 shrink-0 text-primary-ink" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask for leads, emails, or an answer"
        aria-label="Ask OpenLeads"
        data-ask-input
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder"
      />
      {text.trim() ? (
        <button type="submit" aria-label="Ask" className="grid size-7 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground">
          <ArrowUpIcon className="size-4" />
        </button>
      ) : (
        <Kbd className="me-1">/</Kbd>
      )}
    </form>
  );
}

function SetupRow({ icon, title, note, done, to }: { icon: React.ReactNode; title: string; note: string; done: boolean; to: string }) {
  return (
    <a href={to} className="group flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0 hover:bg-accent/60">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{note}</span>
      </span>
      {done ? (
        <span className="grid size-5 place-items-center rounded-full bg-success-surface text-success-foreground" aria-label="Connected">
          <CheckIcon className="size-3" />
        </span>
      ) : (
        <span className="flex items-center text-xs font-medium text-primary-ink">
          Connect <ChevronRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      )}
    </a>
  );
}

function IconTile({ children, on }: { children: React.ReactNode; on: boolean }) {
  return <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-card", on ? "text-foreground" : "text-muted-foreground")}>{children}</span>;
}

export function Today() {
  const today = useApi<BriefingData>("/api/today");
  const home = useApi<Home>("/api/home");
  const deals = useApi<Board>("/api/deals");
  const setup = useSetup();
  const [line, setLine] = useState("");
  const reloadToday = today.reload;
  const reloadHome = home.reload;
  const changed = useCallback(() => {
    void reloadToday();
    void reloadHome();
  }, [reloadToday, reloadHome]);

  useEffect(() => onRan(changed), [changed]);
  useEffect(() => {
    if (today.data) setCounts(today.data.counts);
  }, [today.data]);

  // The model's read of the morning can take a few seconds, so it arrives on its own.
  useEffect(() => {
    let live = true;
    api
      .get<{ line: string }>("/api/today/line")
      .then((r) => live && setLine(r.line || ""))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const b = today.data;
  const h = home.data;
  const model = setup.ai.current;
  const stages = (deals.data?.columns ?? []).filter((c) => c.key !== "won" && c.key !== "lost").map((c) => ({ key: c.key, label: c.label, value: c.total }));
  // Setup problems are shown as connections below; anything else is a real heads-up.
  const notes = (b?.heads_up ?? []).filter((x) => !x.message.includes("openleads setup"));
  const waiting = b ? b.counts.replies + b.counts.drafts : 0;

  return (
    <>
      <PageHeader section={sectionOf("today")} />
      <Body wide>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold tracking-tight">{dayLabel()}</h2>
            <p className="mt-1 max-w-[62ch] text-[15px] leading-6 text-muted-foreground">{line || (b ? summary(b) : " ")}</p>
          </div>
          <AskBar />
        </div>

        {today.error && <ErrorNote message={today.error} onRetry={changed} />}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Waiting on you"
            value={b ? waiting : "–"}
            note={b ? (waiting ? `${plural(b.counts.replies, "reply", "replies")}, ${plural(b.counts.drafts, "approval", "approvals")}` : "All caught up") : ""}
          />
          <Stat label="Emails sent, 30 days" value={h ? h.emails.sent_30d : "–"} note={h ? `${pct(h.emails.reply_rate)} of people replied` : ""} href={href("pipeline", "analytics")}>
            {h && <Spark points={h.series.sent} />}
          </Stat>
          <Stat
            label="Open pipeline"
            value={h ? money(h.deals.open_value) : "–"}
            note={h ? `${plural(h.deals.open_count, "deal", "deals")}, ${money(h.deals.weighted)} weighted` : ""}
            href={href("pipeline", "deals")}
          />
          <Stat label="People" value={h ? h.contacts.total.toLocaleString() : "–"} note={h ? `${h.contacts.new_7d} added this week` : ""} href={href("people")}>
            {h && <Spark points={h.series.added} />}
          </Stat>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-5">
            {!b && today.loading && <LoadingRows rows={6} />}
            {b && <Queue b={b} onChanged={changed} />}
          </div>

          <aside className="flex min-w-0 flex-col gap-5" aria-label="Status">
            {h && (
              <Panel title="Sending today">
                <div className="px-3.5 py-3">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-semibold tabular-nums">{h.emails.warmup.sent_today}</span>
                    <span className="text-[13px] text-muted-foreground">of {h.emails.warmup.allowance} allowed</span>
                  </div>
                  <div className="mt-2">
                    <Meter value={h.emails.warmup.sent_today} max={h.emails.warmup.allowance} label="Emails sent today against the daily allowance" />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Day {h.emails.warmup.day} of warming up this mailbox. The allowance grows a little each day so your emails keep landing.
                  </p>
                </div>
              </Panel>
            )}

            {stages.some((s) => s.value > 0) && (
              <Panel
                title="Pipeline by stage"
                action={
                  <a className="text-xs text-muted-foreground hover:text-foreground" href={href("pipeline", "deals")}>
                    Open deals
                  </a>
                }
              >
                <div className="px-3.5 py-3">
                  <Segments parts={stages} format={(n) => money(n)} />
                </div>
              </Panel>
            )}

            {setup.loaded && (
              <Panel
                title="Connections"
                action={
                  <a className="text-xs text-muted-foreground hover:text-foreground" href={href("settings", "connections")}>
                    Manage
                  </a>
                }
              >
                <SetupRow
                  to={href("settings", "connections")}
                  done={!!model}
                  icon={model ? <BrandIcon name={PROVIDER_BRAND[model.provider] ?? model.provider} label={model.label} /> : <IconTile on={false}><SparklesIcon className="size-4" /></IconTile>}
                  title={model ? model.label : "AI model"}
                  note={model ? "Reads requests, writes drafts, sorts replies" : setup.ai.detected.length ? `${setup.ai.detected[0].label.split(" (")[0]} is on this computer` : "Optional. Built-in rules work without one"}
                />
                <SetupRow
                  to={href("settings", "connections")}
                  done={setup.mailbox}
                  icon={<IconTile on={setup.mailbox}><MailIcon className="size-4" /></IconTile>}
                  title="Mailbox for sending"
                  note={setup.mailbox ? "Approved emails go out from your address" : "Nothing can send until you connect one"}
                />
                <SetupRow
                  to={href("settings", "connections")}
                  done={setup.inbox}
                  icon={<IconTile on={setup.inbox}><InboxIcon className="size-4" /></IconTile>}
                  title="Inbox for replies"
                  note={setup.inbox ? "Replies show up on Today" : "Replies aren't being read yet"}
                />
              </Panel>
            )}

            {b && b.new_leads.count > 0 && (
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
                    <a href={href("people", "people", p.email)} className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium hover:underline">{p.name || p.email}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[p.title, p.organization].filter(Boolean).join(", ")}</span>
                    </a>
                  </Row>
                ))}
              </Panel>
            )}

            {notes.length > 0 && <HeadsUpList items={notes} />}
          </aside>
        </div>
      </Body>
    </>
  );
}
