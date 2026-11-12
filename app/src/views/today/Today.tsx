import { CheckIcon, ChevronRightIcon, InboxIcon, MailIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Avatar, Body, ErrorNote, Figure, LoadingRows, Panel, Row } from "~/components/app/bits";
import { BarList, Meter, type Point, Spark } from "~/components/app/charts";
import { BrandIcon } from "~/components/app/Mark";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Spinner } from "~/components/ui/spinner";
import { api } from "~/lib/api";
import { setCounts } from "~/lib/counts";
import { dayLabel, money, pct, plural } from "~/lib/format";
import { href } from "~/lib/router";
import { PROVIDER_BRAND, PROVIDER_NAME, switchModel, useSetup } from "~/lib/setup";
import { fail, toast } from "~/lib/toast";
import type { Briefing as BriefingData } from "~/lib/types";
import { useApi } from "~/lib/use-api";

import { HeadsUpList, Queue } from "./Briefing";
import { onRan } from "./useAsk";

interface Home {
  contacts: { total: number; new_7d: number };
  emails: { sent_30d: number; contacted: number; replied: number; reply_rate: number; warmup: { day: number; allowance: number; sent_today: number } };
  deals: { open_count: number; open_value: number; weighted: number };
  series: { sent: Point[]; added: Point[] };
}

interface Board {
  columns: { key: string; label: string; total: number }[];
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

function IconTile({ children }: { children: React.ReactNode }) {
  return <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground">{children}</span>;
}

function StatusRow({ icon, title, note, done, to, action }: { icon: React.ReactNode; title: string; note: string; done: boolean; to: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0">
      {icon}
      <a href={to} className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">{note}</span>
      </a>
      {done ? (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success-foreground">
          <CheckIcon className="size-3.5" /> On
        </span>
      ) : (
        (action ?? (
          <a href={to} className="group flex shrink-0 items-center text-xs font-medium text-primary-ink">
            Connect <ChevronRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </a>
        ))
      )}
    </div>
  );
}

export function Today() {
  const today = useApi<BriefingData>("/api/today");
  const home = useApi<Home>("/api/home");
  const deals = useApi<Board>("/api/deals");
  const setup = useSetup();
  const [line, setLine] = useState("");
  const [switching, setSwitching] = useState(false);
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
  const found = setup.ai.detected[0];
  const stages = (deals.data?.columns ?? []).filter((c) => c.key !== "won" && c.key !== "lost").map((c) => ({ key: c.key, label: c.label, value: c.total }));
  // Setup problems are shown as connections; anything else is a real heads-up.
  const notes = (b?.heads_up ?? []).filter((x) => !x.message.includes("openleads setup"));
  const mailTo = href("settings", "connections", "mailbox");
  const modelTo = href("settings", "connections", "model");

  const useFound = async () => {
    if (!found) return;
    setSwitching(true);
    try {
      const said = await switchModel(found.provider);
      if (said) fail(said);
      else toast(`${PROVIDER_NAME[found.provider] ?? "Model"} connected`);
    } catch (e) {
      fail(e);
    }
    setSwitching(false);
  };

  return (
    <>
      <PageHeader
        section={sectionOf("today")}
        actions={
          <Button size="sm" variant="outline" render={<a href={href("ask")} />}>
            <SparklesIcon /> Ask OpenLeads <Kbd className="ms-0.5 max-md:hidden">/</Kbd>
          </Button>
        }
      />
      <Body>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{dayLabel()}</h2>
          <p className="mt-1 max-w-[62ch] text-[15px] leading-6 text-muted-foreground">{line || (b ? summary(b) : " ")}</p>
        </div>

        {today.error && <ErrorNote message={today.error} onRetry={changed} />}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-5">
            {setup.loaded && !setup.mailbox && (
              <section className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-primary/25 bg-primary-wash px-4 py-3.5">
                <span className="flex shrink-0 -space-x-1.5">
                  <BrandIcon name="gmail" />
                  <BrandIcon name="microsoft" />
                </span>
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium">Connect your mailbox to send</p>
                  <p className="text-[13px] leading-5 text-muted-foreground">
                    {setup.demo
                      ? "The emails in this demo are invented. Connect your own mailbox and approved emails go out from your address."
                      : "Approved emails wait here until you do. They go out from your own address, and replies come back to this page."}
                  </p>
                </div>
                <Button size="sm" render={<a href={mailTo} />}>
                  Connect mailbox
                </Button>
              </section>
            )}
            {!b && today.loading && <LoadingRows rows={6} />}
            {b && <Queue b={b} onChanged={changed} />}
          </div>

          <aside className="flex min-w-0 flex-col gap-5" aria-label="How things are going">
            {h && (
              <Panel
                title="Last 30 days"
                action={
                  <a className="text-xs text-muted-foreground hover:text-foreground" href={href("pipeline", "analytics")}>
                    Analytics
                  </a>
                }
              >
                <div className="grid grid-cols-2 [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(odd)]:border-e [&>*]:border-border">
                  <Figure label="Emails sent" value={h.emails.sent_30d.toLocaleString()} note={plural(h.emails.contacted, "person", "people")} to={href("pipeline", "analytics")}>
                    <Spark points={h.series.sent} label="Emails sent per day" />
                  </Figure>
                  <Figure label="Reply rate" value={pct(h.emails.reply_rate)} note={`${h.emails.replied} of ${h.emails.contacted} replied`} to={href("pipeline", "analytics")} />
                  <Figure label="Open pipeline" value={money(h.deals.open_value)} note={plural(h.deals.open_count, "deal", "deals")} to={href("pipeline", "deals")} />
                  <Figure label="People" value={h.contacts.total.toLocaleString()} note={`${h.contacts.new_7d} new this week`} to={href("people")} />
                </div>
              </Panel>
            )}

            {h && setup.mailbox && (
              <Panel
                title="Sending today"
                action={
                  <a className="text-xs text-muted-foreground hover:text-foreground" href={mailTo}>
                    Mailbox
                  </a>
                }
              >
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
                    Deals
                  </a>
                }
              >
                <div className="px-2 py-2">
                  <BarList rows={stages.filter((x) => x.value > 0).map((x) => ({ key: x.key, label: x.label, value: x.value, shown: money(x.value) }))} />
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
                <StatusRow
                  to={modelTo}
                  done={!!model}
                  icon={
                    model || found ? (
                      <BrandIcon name={PROVIDER_BRAND[(model ?? found).provider] ?? ""} label={(model ?? found).label} />
                    ) : (
                      <IconTile>
                        <SparklesIcon className="size-4" />
                      </IconTile>
                    )
                  }
                  title={model ? (PROVIDER_NAME[model.provider] ?? model.label) : found ? `${PROVIDER_NAME[found.provider] ?? found.label} is on this computer` : "AI model"}
                  note={model ? "Reads requests, writes drafts, sorts replies" : found ? "Use it to read requests and write drafts" : "Optional. The built-in rules work without one"}
                  action={
                    found && (
                      <Button size="xs" variant="outline" disabled={switching} onClick={useFound}>
                        {switching && <Spinner />} Use it
                      </Button>
                    )
                  }
                />
                {setup.mailbox && (
                  <>
                    <StatusRow to={mailTo} done icon={<IconTile><MailIcon className="size-4" /></IconTile>} title="Mailbox" note="Approved emails go out from your address" />
                    <StatusRow
                      to={mailTo}
                      done={setup.inbox}
                      icon={<IconTile><InboxIcon className="size-4" /></IconTile>}
                      title="Replies"
                      note={setup.inbox ? "Read from your inbox and shown here" : "Not being read yet"}
                    />
                  </>
                )}
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
