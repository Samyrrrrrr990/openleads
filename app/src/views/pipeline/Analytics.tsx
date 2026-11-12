import { useState } from "react";

import { Body, ErrorNote, LoadingRows, Panel, Stat } from "~/components/app/bits";
import { BarList, type BarRow, Legend, type Point, TrendChart } from "~/components/app/charts";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Button } from "~/components/ui/button";
import { pct, plural } from "~/lib/format";
import { href } from "~/lib/router";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";

interface Totals {
  total_leads: number;
  deliverable: number;
  by_source: Record<string, number>;
}

interface Home {
  emails: { sent_30d: number; sent_7d: number; contacted: number; replied: number; bounced: number; reply_rate: number; bounce_rate: number };
  series: { sent: Point[]; replied: Point[] };
  funnel: { key: string; label: string; count: number }[];
  grades: Record<string, number>;
}

interface Breakdown {
  value: string;
  contacted: number;
  replied: number;
  rate: number;
}

const SOURCES: Record<string, string> = {
  yc: "Y Combinator",
  local: "Local businesses",
  github: "GitHub",
  companies: "Company search",
  import: "Imported",
  hn: "Hacker News",
  npi: "Healthcare registry",
  openalex: "Researchers",
  producthunt: "Product Hunt",
  pypi: "Python packages",
  huggingface: "Hugging Face",
  edgar: "Public companies",
  domains: "Domain search",
};

const DIMENSIONS = [
  { key: "seniority", label: "Seniority" },
  { key: "department", label: "Department" },
  { key: "industry", label: "Industry" },
  { key: "company_size", label: "Company size" },
  { key: "source", label: "Source" },
] as const;

function words(value: string): string {
  if (!value) return "Unknown";
  if (value === "c_suite") return "C-suite";
  if (value === "vp") return "VP";
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function Analytics() {
  const totals = useApi<Totals>("/api/analytics");
  const home = useApi<Home>("/api/home");
  const replies = useApi<Record<string, Breakdown[]>>("/api/analytics/replies");
  const [dim, setDim] = useState<(typeof DIMENSIONS)[number]["key"]>("seniority");
  const t = totals.data;
  const h = home.data;
  const error = totals.error || home.error;

  const rows = (replies.data?.[dim] ?? [])
    .filter((r) => r.contacted > 0)
    // Most-contacted first: a rate from two people shouldn't outrank one from twenty.
    .sort((a, b) => b.contacted - a.contacted || b.rate - a.rate)
    .slice(0, 8)
    .map<BarRow>((r) => ({
      key: r.value || "unknown",
      label: dim === "source" ? (SOURCES[r.value] ?? words(r.value)) : words(r.value),
      value: r.rate,
      shown: pct(r.rate),
      note: `${r.replied} of ${r.contacted}`,
    }));
  const sample = (replies.data?.[dim] ?? []).reduce((a, r) => a + r.contacted, 0);
  const sources = Object.entries(t?.by_source ?? {})
    .sort((a, b) => b[1] - a[1])
    .map<BarRow>(([k, v]) => ({ key: k, label: SOURCES[k] ?? words(k), value: v }));
  const funnel = (h?.funnel ?? []).filter((f) => f.count > 0).map<BarRow>((f) => ({ key: f.key, label: f.label, value: f.count }));
  const grades = ["A", "B", "C", "D"].map<BarRow>((g) => ({ key: g, label: `Grade ${g}`, value: h?.grades?.[g] ?? 0 }));
  const nothingSent = !!h && h.emails.sent_30d === 0;
  // Under this many people, a percentage is a hint, not a result.
  const few = !!h && h.emails.contacted < 50;

  return (
    <>
      <PageHeader section={sectionOf("pipeline")} page="analytics" />
      <Body>
        {error && (
          <ErrorNote
            message={error}
            onRetry={() => {
              void totals.reload();
              void home.reload();
            }}
          />
        )}
        {(!t || !h) && !error && <LoadingRows rows={6} />}
        {t && h && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="People" value={t.total_leads.toLocaleString()} note={`${t.deliverable.toLocaleString()} with an email that will deliver`} />
              <Stat label="Emails sent, 30 days" value={h.emails.sent_30d.toLocaleString()} note={`${h.emails.sent_7d} in the last 7 days`} />
              <Stat
                label="Reply rate"
                value={pct(h.emails.reply_rate)}
                note={`${h.emails.replied} of ${plural(h.emails.contacted, "person", "people")} contacted${few ? ". Too few to judge yet" : ""}`}
              />
              <Stat
                label="Bounce rate"
                value={pct(h.emails.bounce_rate)}
                note={`${h.emails.bounced} of ${h.emails.contacted} bounced. ${few ? "Too few to judge yet" : h.emails.bounce_rate > 5 ? "High: check Data health" : "Under 5% is healthy"}`}
              />
            </div>

            <Panel title="Emails and replies per day" action={<Legend series={[{ label: "Sent", color: "var(--chart-1)" }, { label: "Replies", color: "var(--chart-2)" }]} />}>
              {nothingSent ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[15px] font-medium">No emails sent yet.</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">Once you send, each day's emails and replies are drawn here.</p>
                  <Button size="sm" className="mt-4" render={<a href={href("ask")} />}>
                    Ask for a first batch
                  </Button>
                </div>
              ) : (
                <div className="px-3.5 pt-4 pb-3">
                  <TrendChart
                    series={[
                      { key: "sent", label: "Sent", unit: ["email sent", "emails sent"], color: "var(--chart-1)", points: h.series.sent },
                      { key: "replied", label: "Replies", unit: ["reply", "replies"], color: "var(--chart-2)", points: h.series.replied },
                    ]}
                  />
                </div>
              )}
            </Panel>

            <div className="grid items-start gap-5 lg:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-5">
              <Panel title="Who replies">
                <div className="max-md:tabs-fade flex items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5" role="tablist" aria-label="Group replies by">
                  {DIMENSIONS.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      role="tab"
                      aria-selected={dim === d.key}
                      onClick={() => setDim(d.key)}
                      className={cn(
                        "h-7 shrink-0 cursor-pointer rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground max-md:h-10 max-md:px-3 max-md:text-sm",
                        dim === d.key && "bg-accent font-medium text-foreground",
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <div className="px-2 py-2">
                  <BarList rows={rows} max={100} empty="Reply rates show up after your first emails get answers." />
                  {rows.length > 0 && (
                    <p className="px-1.5 pt-2 text-xs leading-5 text-muted-foreground">
                      Share of the people contacted in each group who replied, with the count beside it.
                      {sample < 50 ? ` Only ${plural(sample, "person", "people")} contacted so far, so treat this as a hint.` : ""}
                    </p>
                  )}
                </div>
              </Panel>
              <Panel title="Where they came from">
                <div className="px-2 py-2">
                  <BarList rows={sources} empty="No people yet." />
                </div>
              </Panel>
              </div>
              <div className="flex min-w-0 flex-col gap-5">
              <Panel title="Where people stand">
                <div className="px-2 py-2">
                  <BarList rows={funnel} empty="No people yet." />
                </div>
              </Panel>
              <Panel title="How well they fit your ideal customer">
                <div className="px-2 py-2">
                  <BarList rows={grades} />
                </div>
              </Panel>
              </div>
            </div>
          </>
        )}
      </Body>
    </>
  );
}
