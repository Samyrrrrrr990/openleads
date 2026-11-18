import { ArrowRightIcon, CircleAlertIcon, GlobeIcon, PlusIcon, SearchIcon, SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ErrorNote } from "~/components/app/bits";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { api } from "~/lib/api";
import { href } from "~/lib/router";
import { switchModel, useSetup } from "~/lib/setup";
import { fail } from "~/lib/toast";
import type { Page, Person } from "~/lib/types";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";

import { type LeadBrief, buildForLead, loadEngine, rewriteCopy } from "./engine";
import { SiteView } from "./SiteView";

export interface Site {
  id: string;
  slug: string;
  name: string;
  lead_email: string | null;
  company: string;
  starter_id: string | null;
  page_count: number;
  updated: number;
  preview: string;
  url: string;
  sent: boolean;
}

/** Studio, the full editor, for anything the Sites screen doesn't do. */
export const studio = {
  home: "/studio/#/app/projects",
  edit: (id: string) => `/studio/#/app/project/${encodeURIComponent(id)}`,
};

/** "3h", "2d": T3's thread-list time, from epoch seconds. */
export function short(secs: number): string {
  if (!secs) return "";
  const s = Math.max(0, Date.now() / 1000 - secs);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(secs * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function sitesChanged() {
  window.dispatchEvent(new Event("openleads:sites-changed"));
}

function useSiteList() {
  const res = useApi<{ sites: Site[]; base_url: string; netlify: boolean }>("/api/sites");
  useEffect(() => {
    const reload = () => void res.reload();
    window.addEventListener("openleads:sites-changed", reload);
    return () => window.removeEventListener("openleads:sites-changed", reload);
  }, [res]);
  return res;
}

/** Whether a model is picked for jobs that read your leads, and what to offer if not. */
export function useModel() {
  const setup = useSetup();
  const choice = String(setup.settings.ai_provider?.value ?? "auto");
  const ready = !!setup.ai.current && choice !== "auto" && choice !== "";
  const claude = setup.ai.detected.some((d) => d.provider === "claude");
  return { ready, label: setup.ai.current?.label ?? "", claude, loaded: setup.loaded, version: setup.version };
}

/** "Use Claude": one click, then every site gets its copy written. */
export function UseModel({ className, compact }: { className?: string; compact?: boolean }) {
  const m = useModel();
  const [busy, setBusy] = useState(false);
  if (!m.loaded) return null;
  if (m.ready) {
    return compact ? null : (
      <p className={cn("flex items-center gap-2 text-[13px] text-muted-foreground", className)}>
        <SparklesIcon className="size-3.5" /> {m.label.replace(/ \(.*\)$/, "")} writes the words for each business.{" "}
        <a className="underline" href={href("settings", "model")}>
          Change
        </a>
      </p>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3.5 py-2.5", className)}>
      <SparklesIcon className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-48 flex-1 text-[13px] leading-5 text-muted-foreground">
        {m.claude
          ? compact
            ? "Claude can write the words for this business."
            : "Use your Claude subscription and it writes each site's words for that business. Without a model, the template's words stay with their details swapped in."
          : "Connect a model and it writes each site's words for that business. Without one, the template's words stay with their details swapped in."}
      </p>
      {m.claude ? (
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const problem = await switchModel("claude");
            setBusy(false);
            if (problem) fail(new Error(problem));
          }}
        >
          {busy && <Spinner />} Use Claude
        </Button>
      ) : (
        <Button size="sm" variant="outline" render={<a href={href("settings", "model")} />}>
          Pick a model
        </Button>
      )}
    </div>
  );
}

/** "#/sites": start; "#/sites/new/<email>": build one for a lead; "#/sites/<id>": one site. */
export function Sites({ open, lead }: { open?: string; lead?: string }) {
  const list = useSiteList();
  const sites = list.data?.sites ?? null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <SiteList list={sites} error={list.error} onRetry={() => void list.reload()} active={open} building={open === "new" ? lead : undefined} className="max-md:hidden" />
      {open === "new" && lead ? (
        <Building email={lead} />
      ) : open ? (
        <SiteView key={open} id={open} netlify={!!list.data?.netlify} baseUrl={list.data?.base_url ?? ""} />
      ) : (
        <Start sites={sites ?? []} />
      )}
    </div>
  );
}

function SiteList({ list, error, onRetry, active, building, className }: { list: Site[] | null; error: string; onRetry: () => void; active?: string; building?: string; className?: string }) {
  const [q, setQ] = useState("");
  const hits = (list ?? []).filter((s) => !q || `${s.company} ${s.name} ${s.lead_email ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <aside className={cn("flex w-64 shrink-0 flex-col border-e border-border", className)} aria-label="Sites">
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-3.5">
        <h1 className="text-sm font-semibold">Sites</h1>
        <Button size="icon-sm" variant="ghost" className="ms-auto" aria-label="Build a site for a lead" render={<a href={href("sites")} />}>
          <PlusIcon />
        </Button>
      </div>
      {list && list.length > 6 && (
        <div className="relative px-2 pb-2">
          <SearchIcon className="pointer-events-none absolute left-4.5 top-1/2 size-3.5 -translate-y-1/2 -mt-1 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sites"
            aria-label="Search sites"
            className="h-8 w-full rounded-lg border border-border bg-transparent ps-7.5 pe-2.5 text-[13px] outline-none placeholder:text-placeholder focus:border-ring/60"
          />
        </div>
      )}
      <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-2">
        <a
          href={href("sites")}
          aria-current={!active ? "page" : undefined}
          className={cn("flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground", !active && "bg-accent font-medium text-foreground")}
        >
          <PlusIcon className="size-3.5" /> Build for a lead
        </a>
        {building && (
          <span className="flex h-8 shrink-0 items-center gap-2 rounded-lg bg-accent px-2.5 text-[13px] font-medium">
            <Spinner className="size-3" /> <span className="truncate">Building</span>
          </span>
        )}
        {error && <ErrorNote message={error} onRetry={onRetry} />}
        {list === null && !error && <span className="px-2.5 py-2 text-xs text-muted-foreground">Loading</span>}
        {hits.map((s) => {
          const on = active === s.id;
          return (
            <a
              key={s.id}
              href={href("sites", s.id)}
              aria-current={on ? "page" : undefined}
              title={s.lead_email ? `For ${s.company || s.lead_email}` : s.name}
              className={cn("group flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground", on && "bg-accent text-foreground")}
            >
              <span
                className={cn("size-1.5 shrink-0 rounded-full", s.sent ? "bg-success" : s.url ? "bg-info" : "bg-muted-foreground/40")}
                aria-label={s.sent ? "Sent" : s.url ? "Live" : "Draft"}
              />
              <span className={cn("min-w-0 flex-1 truncate", on && "font-medium")}>{s.company || s.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground/80">{short(s.updated)}</span>
            </a>
          );
        })}
        {list && list.length === 0 && <p className="px-2.5 py-2 text-xs leading-5 text-muted-foreground">No sites yet. Pick a lead and one gets built.</p>}
      </nav>
    </aside>
  );
}

/** No site open: find a lead, and a site gets built for them. */
function Start({ sites }: { sites: Site[] }) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const body = useMemo(() => ({ filters: dq.trim() ? { q: dq.trim() } : {}, sort: "updated", direction: "desc", page: 1, per_page: 8 }), [dq]);
  const people = useApi<Page<Person>>("/api/people/search", body);
  const hasSite = useMemo(() => new Map(sites.filter((s) => s.lead_email).map((s) => [s.lead_email!.toLowerCase(), s.id])), [sites]);

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[var(--content-max)] flex-col justify-center gap-5 px-5 py-8 max-md:px-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Build a lead a better website</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Pick a business. The right template gets their name, phone and city, the words get written for them, and you see it before you send the link.
          </p>
        </div>

        <div className="rounded-2xl border border-input bg-card shadow-composer transition-shadow focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/15">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a lead: a business name, a city, a trade"
              aria-label="Find a lead"
              className="block h-12 w-full bg-transparent ps-11 pe-4 text-[15px] outline-none placeholder:text-placeholder"
            />
          </div>
          <div className="border-t border-border">
            {people.error && <p className="px-4 py-3 text-[13px] text-destructive">{people.error}</p>}
            {!people.data && people.loading && <p className="px-4 py-3 text-[13px] text-muted-foreground">Looking</p>}
            {people.data?.rows.map((p) => {
              const existing = hasSite.get(p.email.toLowerCase());
              return (
                <div key={p.email} className="flex min-h-12 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium max-md:text-sm">{p.organization || p.name || p.email}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[p.organization && p.name !== p.organization ? p.name : "", p.industry, p.city].filter(Boolean).join(" · ") || p.email}
                    </div>
                  </div>
                  {existing ? (
                    <Button size="xs" variant="ghost" render={<a href={href("sites", existing)} />}>
                      Open its site
                    </Button>
                  ) : (
                    <Button size="xs" render={<a href={href("sites", "new", p.email)} />}>
                      Build site <ArrowRightIcon />
                    </Button>
                  )}
                </div>
              );
            })}
            {people.data && people.data.rows.length === 0 && (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">
                No one matches. Find businesses first under <a className="underline" href={href("people")}>People</a>.
              </p>
            )}
          </div>
        </div>

        <UseModel />

        {sites.length > 0 && (
          <section className="md:hidden">
            <h3 className="mb-1.5 text-[13px] font-medium">Your sites</h3>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {sites.map((s) => (
                <a key={s.id} href={href("sites", s.id)} className="flex min-h-12 items-center gap-2.5 border-b border-border px-3.5 py-2 text-sm last:border-b-0">
                  <span className={cn("size-1.5 shrink-0 rounded-full", s.sent ? "bg-success" : s.url ? "bg-info" : "bg-muted-foreground/40")} />
                  <span className="min-w-0 flex-1 truncate font-medium">{s.company || s.name}</span>
                  <span className="text-xs text-muted-foreground">{short(s.updated)}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        <p className="text-xs leading-5 text-muted-foreground">
          Want to start from scratch or lay out a page by hand? <a className="underline" href={studio.home}>Open Studio</a>, the full editor.
        </p>
      </div>
    </div>
  );
}

const inflight = new Map<string, Promise<string>>();

/** Builds the site, then opens it. Claude's pass over the words carries on in the site. */
function Building({ email }: { email: string }) {
  const m = useModel();
  const [lines, setLines] = useState<string[]>(["Reading what we know about them"]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!m.loaded) return;
    let live = true;
    const say = (t: string) => live && setLines((l) => [...l, t]);
    const run =
      inflight.get(email) ??
      (async () => {
        const mine = await api.get<{ sites: Site[] }>(`/api/sites?lead=${encodeURIComponent(email)}`);
        if (mine.sites[0]) return mine.sites[0].id;
        const [engine, brief] = await Promise.all([loadEngine(m.version), api.get<LeadBrief>(`/api/sites/lead?email=${encodeURIComponent(email)}`)]);
        const pick = engine.pickTemplate(brief);
        say(`Picked the ${pick.name} template for ${brief.business || brief.email}`);
        const { site, project } = await buildForLead(engine, brief);
        if (m.ready) void rewriteCopy(engine, site.id, project, brief);
        return site.id;
      })();
    inflight.set(email, run);
    run
      .then((id) => {
        sitesChanged();
        if (live) window.location.replace(href("sites", id));
      })
      .catch((e) => live && setError((e as Error).message))
      .finally(() => inflight.delete(email));
    return () => {
      live = false;
    };
  }, [email, m.loaded, m.ready, m.version]);

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-col gap-2 px-5 py-10 max-md:px-4">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold tracking-tight">
          <GlobeIcon className="size-4.5 text-muted-foreground" /> Building a site
        </h2>
        {lines.map((t, i) => (
          <p key={i} className="flex items-center gap-2 text-[13px] text-muted-foreground">
            {i === lines.length - 1 && !error ? <Spinner className="size-3.5" /> : <span className="size-3.5" />} {t}
          </p>
        ))}
        {error && (
          <p className="flex items-start gap-2 text-[13px] text-error-foreground">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
