import { CheckCircle2Icon, CircleAlertIcon, InfoIcon, PauseIcon, PlayIcon, Trash2Icon, XCircleIcon } from "lucide-react";
import { useState } from "react";

import { Body, ErrorNote, LoadingRows, Panel, Quiet, Row, Stat } from "~/components/app/bits";
import { Meter, TrendChart } from "~/components/app/charts";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { api } from "~/lib/api";
import { fail, toast } from "~/lib/toast";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";

interface Slot {
  at: string;
  kind: string;
  status: "sent" | "due" | "planned";
}
interface Seed {
  email: string;
  name: string;
  provider: string;
  automatic: boolean;
}
interface Signal {
  level: "good" | "warn" | "bad" | "info";
  text: string;
}
export interface WarmupStatus {
  plan: string;
  plans: { key: string; label: string; note: string; days: number }[];
  phase: "ramping" | "maintaining" | "paused" | "off";
  day: number;
  days: number;
  target: number;
  weekend: boolean;
  weekends: string;
  window: string;
  allowance: number;
  sent_today: number;
  remaining: number;
  warmup: { planned: number; sent: number; replies: number; rescued: number; paused: boolean; next: string };
  schedule: Slot[];
  health: { score: number; grade: string; action: string; signals: Signal[]; counts: Record<string, number> };
  override: boolean;
  seeds: Seed[];
  ramp: { day: number; cold: number; warmup: number }[];
  history: { date: string; cold: number; warmup: number }[];
  mailbox: string;
}

const PHASE: Record<string, { label: string; tone: "success" | "info" | "warning" | "secondary" }> = {
  ramping: { label: "Ramping up", tone: "info" },
  maintaining: { label: "Warmed up", tone: "success" },
  paused: { label: "Cold sending paused", tone: "warning" },
  off: { label: "Warm-up off", tone: "secondary" },
};

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The sentence at the top: what happens today, in words. */
function headline(s: WarmupStatus): string {
  if (!s.mailbox) return "Connect a mailbox first. Warm-up sends from it.";
  if (s.phase === "off") return `Warm-up is off. You can send up to ${s.allowance} cold emails a day.`;
  const cold =
    s.phase === "paused"
      ? "Cold sending is paused today while health recovers."
      : `You can send ${s.remaining} more cold ${s.remaining === 1 ? "email" : "emails"} today (${s.sent_today} of ${s.allowance} sent).`;
  if (!s.seeds.length) return `${cold} Add a seed inbox below so warm-up emails can start.`;
  if (s.warmup.paused) return `${cold} Warm-up emails are paused.`;
  const left = s.warmup.planned - s.warmup.sent;
  const warm =
    left > 0
      ? `${left} warm-up ${left === 1 ? "email goes" : "emails go"} out between ${s.window.replace("-", " and ")}${s.warmup.next ? `, the next at ${clock(s.warmup.next)}` : ""}.`
      : `All ${s.warmup.planned} warm-up emails for today are out.`;
  return `${cold} ${warm}`;
}

export function Warmup() {
  const res = useApi<WarmupStatus>("/api/warmup");
  const s = res.data;
  const [busy, setBusy] = useState("");

  const post = async (path: string, body: unknown, done?: string) => {
    setBusy(path);
    try {
      const next = await api.post<WarmupStatus | { status: WarmupStatus }>(path, body);
      res.set("status" in next ? next.status : next);
      if (done) toast(done);
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <PageHeader
        section={sectionOf("outreach")}
        page="warmup"
        actions={
          s &&
          s.seeds.length > 0 &&
          s.phase !== "off" && (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void post("/api/warmup/pause", { paused: !s.warmup.paused }, s.warmup.paused ? "Warm-up resumed" : "Warm-up paused")}>
              {s.warmup.paused ? <PlayIcon /> : <PauseIcon />}
              {s.warmup.paused ? "Resume" : "Pause"}
            </Button>
          )
        }
      />
      <Body>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!s && res.loading && <LoadingRows rows={6} />}
        {s && (
          <>
            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={PHASE[s.phase]?.tone ?? "secondary"}>{PHASE[s.phase]?.label ?? s.phase}</Badge>
                {s.phase !== "off" && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Day {s.day}
                    {s.phase === "ramping" ? ` of ${s.days}` : ""}
                    {s.weekend ? " · weekend, quieter" : ""}
                  </span>
                )}
              </div>
              <p className="max-w-3xl text-[15px] leading-6 text-foreground">{headline(s)}</p>
              {s.phase === "paused" && !s.override && (
                <div>
                  <Button size="xs" variant="outline" disabled={!!busy} onClick={() => void post("/api/warmup/override", {}, "Cold sending is on for today")}>
                    Send cold email today anyway
                  </Button>
                </div>
              )}
            </section>

            <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
              <Stat label="Cold emails today" value={`${s.sent_today}/${s.allowance}`} note={s.phase === "ramping" ? `Rises to ${s.target} a day by day ${s.days}` : `Daily cap ${s.target}`}>
                <Meter value={s.sent_today} max={Math.max(1, s.allowance)} label="Cold emails sent today" />
              </Stat>
              <Stat label="Warm-up today" value={`${s.warmup.sent}/${s.warmup.planned}`} note={s.warmup.replies || s.warmup.rescued ? `${s.warmup.replies} answered, ${s.warmup.rescued} rescued from spam` : `${s.seeds.length} seed ${s.seeds.length === 1 ? "inbox" : "inboxes"}`}>
                <Meter value={s.warmup.sent} max={Math.max(1, s.warmup.planned)} label="Warm-up emails sent today" />
              </Stat>
              <Stat label="Health" value={s.health.score} note={`${{ good: "Good", fair: "Fair", poor: "Poor" }[s.health.grade] ?? "Health"}. ${s.health.action === "pause" ? "Cold sending is paused." : s.health.action === "hold" ? "The ramp holds today." : "The ramp keeps climbing."}`} />
              <Stat
                label="Inbox placement"
                value={s.health.counts.inbox + s.health.counts.spam > 0 ? `${Math.round((100 * s.health.counts.inbox) / (s.health.counts.inbox + s.health.counts.spam))}%` : "–"}
                note={s.health.counts.inbox + s.health.counts.spam > 0 ? `${s.health.counts.inbox} inbox, ${s.health.counts.spam} spam, last 14 days` : "Needs a seed with a password"}
              />
            </div>

            <Panel title="Today" action={<span className="text-xs text-muted-foreground">{s.window.replace("-", " to ")}</span>}>
              <Timeline status={s} />
            </Panel>

            <Panel title="Ramp" action={<span className="text-xs text-muted-foreground">Planned cold emails per weekday, and what went out</span>}>
              <div className="p-3.5">
                <TrendChart
                  height={190}
                  series={[
                    {
                      key: "plan",
                      label: "Planned",
                      unit: ["email allowed", "emails allowed"],
                      color: "var(--chart-2)",
                      points: s.ramp.filter((r) => r.day >= s.day - 20).map((r) => ({ date: isoDay(r.day - s.day), count: r.cold })),
                    },
                    {
                      key: "sent",
                      label: "Sent",
                      unit: ["email sent", "emails sent"],
                      color: "var(--chart-1)",
                      points: s.history.map((h) => ({ date: h.date, count: h.cold + h.warmup })),
                    },
                  ]}
                />
              </div>
            </Panel>

            <div className="grid grid-cols-2 gap-5 max-lg:grid-cols-1">
              <HealthPanel status={s} busy={busy} onDns={() => void post("/api/warmup/dns", {}, "DNS checked")} />
              <PlanPanel status={s} busy={busy} onSave={(body, msg) => void post("/api/warmup/plan", body, msg)} onRestart={() => void post("/api/warmup/restart", {}, "Ramp restarted from day 1")} />
            </div>

            <SeedsPanel status={s} busy={busy} post={post} />
          </>
        )}
      </Body>
    </>
  );
}

/** Today's warm-up sends on a line from the window's start to its end. */
function Timeline({ status: s }: { status: WarmupStatus }) {
  const [a, b] = s.window.split("-").map((t) => {
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  });
  const start = a ?? 540;
  const end = b ?? 1020;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const at = (iso: string) => {
    const d = new Date(iso);
    return Math.min(100, Math.max(0, ((d.getHours() * 60 + d.getMinutes() - start) / (end - start)) * 100));
  };
  if (!s.schedule.length) {
    return <Quiet>{s.seeds.length ? (s.warmup.paused ? "Warm-up is paused." : s.phase === "off" ? "Warm-up is off." : "Nothing planned today.") : "No warm-up emails until you add a seed inbox."}</Quiet>;
  }
  const hours: number[] = [];
  for (let h = Math.ceil(start / 60); h <= Math.floor(end / 60); h++) hours.push(h);
  return (
    <div className="px-5 pb-4 pt-7">
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-3.5 h-px bg-border" />
        {mins >= start && mins <= end && (
          <div className="absolute top-0 h-8 w-px bg-foreground/50" style={{ left: `${((mins - start) / (end - start)) * 100}%` }} title="Now">
            <span className="absolute -top-5 -translate-x-1/2 text-[11px] text-muted-foreground">now</span>
          </div>
        )}
        {s.schedule.map((slot, i) => (
          <span
            key={i}
            title={`${clock(slot.at)}: ${slot.status === "sent" ? "sent" : slot.status === "due" ? "going out on the next check" : "planned"}`}
            className={cn(
              "absolute top-2 size-3 -translate-x-1/2 rounded-full border-2",
              slot.status === "sent" ? "border-chart-1 bg-chart-1" : slot.status === "due" ? "border-chart-1 bg-background" : "border-muted-foreground/50 bg-background",
            )}
            style={{ left: `${at(slot.at)}%` }}
          />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted-foreground tabular-nums">
        {hours.map((h) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h * 60 - start) / (end - start)) * 100}%` }}>
            {h}:00
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-chart-1" /> sent</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-chart-1" /> due now</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-muted-foreground/50" /> planned</span>
        <span>Times shift a little every day so they never look automated.</span>
      </div>
    </div>
  );
}

const SIGNAL_ICON = {
  good: <CheckCircle2Icon className="size-4 text-success" />,
  warn: <CircleAlertIcon className="size-4 text-warning" />,
  bad: <XCircleIcon className="size-4 text-destructive" />,
  info: <InfoIcon className="size-4 text-muted-foreground" />,
};

function HealthPanel({ status: s, busy, onDns }: { status: WarmupStatus; busy: string; onDns: () => void }) {
  return (
    <Panel
      title="Health"
      action={
        <Button size="xs" variant="outline" disabled={!!busy} onClick={onDns}>
          {busy === "/api/warmup/dns" ? "Checking…" : "Check DNS"}
        </Button>
      }
    >
      {s.health.signals.map((sig, i) => (
        <Row key={i} className="items-center">
          {SIGNAL_ICON[sig.level]}
          <span className="text-[13px] leading-5">{sig.text}</span>
        </Row>
      ))}
      <p className="px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
        Last 14 days: {s.health.counts.sent} sent, {s.health.counts.bounced} bounced, {s.health.counts.replied} replied. Healthy days move the ramp forward; a warning holds it where it is.
      </p>
    </Panel>
  );
}

function Segmented({ value, options, onChange, label }: { value: string; options: { key: string; label: string }[]; onChange: (v: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn("h-7 rounded-md px-2.5 text-[13px] transition-colors max-md:h-9", value === o.key ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PlanPanel({ status: s, busy, onSave, onRestart }: { status: WarmupStatus; busy: string; onSave: (body: object, msg: string) => void; onRestart: () => void }) {
  const [from, to] = s.window.split("-");
  const [win, setWin] = useState({ from: from ?? "09:00", to: to ?? "17:00" });
  const [cap, setCap] = useState(String(s.target));
  const plans = [...s.plans.map((p) => ({ key: p.key, label: p.label })), { key: "off", label: "Off" }];
  const note = s.plans.find((p) => p.key === s.plan)?.note ?? (s.plan === "linear" ? "A straight line from warmup_start, warmup_step more each day." : "Only the daily cap applies.");
  return (
    <Panel title="Plan">
      <div className="flex flex-col gap-4 p-3.5">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">How fast to ramp</span>
          <Segmented label="Warm-up plan" value={s.plan} options={plans} onChange={(plan) => onSave({ plan }, `Plan: ${plans.find((p) => p.key === plan)?.label}`)} />
          <span className="text-xs text-muted-foreground">{note}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Weekends</span>
          <Segmented
            label="Weekends"
            value={s.weekends}
            options={[
              { key: "quiet", label: "Quieter" },
              { key: "off", label: "Off" },
              { key: "normal", label: "Like weekdays" },
            ]}
            onChange={(weekends) => onSave({ weekends }, "Weekends updated")}
          />
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ window: `${win.from}-${win.to}`, cap: Number(cap) || s.target }, "Saved");
          }}
        >
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Send between
            <span className="flex items-center gap-1.5">
              <Input type="time" value={win.from} onChange={(e) => setWin({ ...win, from: e.target.value })} className="w-28" aria-label="Window start" />
              <span>and</span>
              <Input type="time" value={win.to} onChange={(e) => setWin({ ...win, to: e.target.value })} className="w-28" aria-label="Window end" />
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Daily cap when warm
            <Input type="number" min={1} max={2000} value={cap} onChange={(e) => setCap(e.target.value)} className="w-24" aria-label="Daily cap" />
          </label>
          <Button size="sm" type="submit" disabled={!!busy}>
            Save
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          New domain or moved mailbox?{" "}
          <button type="button" className="underline underline-offset-2" onClick={onRestart}>
            Start the ramp again from day 1
          </button>
          .
        </p>
      </div>
    </Panel>
  );
}

function SeedsPanel({ status: s, busy, post }: { status: WarmupStatus; busy: string; post: (path: string, body: unknown, done?: string) => Promise<void> }) {
  const [form, setForm] = useState({ email: "", name: "", password: "" });
  const [more, setMore] = useState(false);
  const test = async (email: string) => {
    try {
      const r = await api.post<{ ok: boolean; message: string }>("/api/warmup/seeds/test", { email });
      toast(r.message, r.ok ? "default" : "error");
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Panel title="Seed inboxes" count={s.seeds.length}>
      <p className="border-b border-border px-3.5 py-2.5 text-[13px] leading-5 text-muted-foreground">
        Warm-up emails go to these: your other inboxes, a teammate, a friend. Give an inbox its app password and OpenLeads does the rest by itself: checks whether each email reached the inbox or spam, moves it out of spam, marks it important and answers some. Without one, a person reads and replies.
      </p>
      {s.seeds.map((seed) => (
        <Row key={seed.email} className="items-center">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{seed.name || seed.email}</div>
            {seed.name && <div className="truncate text-xs text-muted-foreground">{seed.email}</div>}
          </div>
          {seed.automatic ? <Badge variant="success">Automatic</Badge> : <Badge variant="secondary">A person replies</Badge>}
          {seed.automatic && (
            <Button size="xs" variant="ghost" onClick={() => void test(seed.email)}>
              Test
            </Button>
          )}
          <Button size="icon" variant="ghost" aria-label={`Remove ${seed.email}`} disabled={!!busy} onClick={() => void post("/api/warmup/seeds/remove", { email: seed.email }, "Seed removed")}>
            <Trash2Icon />
          </Button>
        </Row>
      ))}
      <form
        className="flex flex-wrap items-end gap-2 p-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void post("/api/warmup/seeds/add", form, "Seed added").then(() => setForm({ email: "", name: "", password: "" }));
        }}
      >
        <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="seed@gmail.com" aria-label="Seed email" className="w-56 max-md:w-full" required type="email" />
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (optional)" aria-label="Seed name" className="w-40 max-md:w-full" />
        {more ? (
          <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="App password" aria-label="Seed app password" className="w-44 max-md:w-full" type="password" autoComplete="off" />
        ) : (
          <button type="button" className="h-8 text-xs text-muted-foreground underline underline-offset-2" onClick={() => setMore(true)}>
            Make it automatic
          </button>
        )}
        <Button size="sm" type="submit" disabled={!!busy || !form.email}>
          Add seed
        </Button>
      </form>
      {more && (
        <p className="px-3.5 pb-3 text-xs leading-5 text-muted-foreground">
          Gmail and Outlook: use an app password (Google Account → Security → App passwords). Stored only on this machine, in a private file.
        </p>
      )}
    </Panel>
  );
}
