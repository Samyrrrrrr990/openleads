import { CopyIcon, ExternalLinkIcon, PencilIcon, PlusIcon, SearchIcon, UploadCloudIcon, UserRoundIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Body, ErrorNote, LoadingRows, Panel, Quiet, Row } from "~/components/app/bits";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { api } from "~/lib/api";
import { ago } from "~/lib/format";
import { href } from "~/lib/router";
import { fail, toast } from "~/lib/toast";
import type { Page, Person } from "~/lib/types";
import { useApi } from "~/lib/use-api";

export interface Site {
  id: string;
  slug: string;
  name: string;
  lead_email: string | null;
  company: string;
  page_count: number;
  updated: number;
  preview: string;
  url: string;
}

/** Studio, the site builder, is its own page at /studio/ (hash-routed). */
export const studio = {
  home: "/studio/#/app/projects",
  forLead: (email: string) => `/studio/#/app/projects?lead=${encodeURIComponent(email)}`,
  edit: (id: string) => `/studio/#/app/project/${encodeURIComponent(id)}`,
};

/** A live, scaled-down picture of the site's home page. */
function Thumb({ src, title }: { src: string; title: string }) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden border-b border-border bg-muted">
      <iframe
        src={src}
        title={title}
        loading="lazy"
        tabIndex={-1}
        aria-hidden
        sandbox=""
        className="pointer-events-none absolute left-0 top-0 h-[400%] w-[400%] origin-top-left scale-25 border-0"
      />
    </div>
  );
}

function LeadPicker({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const body = useMemo(() => ({ filters: dq.trim() ? { q: dq.trim() } : {}, sort: "updated", direction: "desc", page: 1, per_page: 8 }), [dq]);
  const people = useApi<Page<Person>>("/api/people/search", body);
  return (
    <Panel title="Build a site for…" action={<Button size="xs" variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="relative border-b border-border p-2.5">
        <SearchIcon className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a business or person" aria-label="Search leads" className="*:ps-8" />
      </div>
      {people.data?.rows.map((p) => (
        <a key={p.email} href={studio.forLead(p.email)} className="block hover:bg-accent/60">
          <Row className="items-center">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{p.organization || p.name || p.email}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[p.name !== p.organization ? p.name : "", p.city, p.website].filter(Boolean).join(" · ") || p.email}
              </div>
            </div>
            <span className="text-xs text-muted-foreground">Open Studio →</span>
          </Row>
        </a>
      ))}
      {people.data && people.data.rows.length === 0 && <Quiet>No one matches. Find businesses first under People.</Quiet>}
    </Panel>
  );
}

export function Sites() {
  const res = useApi<{ sites: Site[]; base_url: string; netlify: boolean }>("/api/sites");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState("");
  const list = res.data?.sites ?? [];

  const copy = async (s: Site) => {
    if (!s.url) {
      toast("Publish it first, or set your site address in Settings → All settings → sites.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(s.url);
      toast("Link copied");
    } catch {
      toast(s.url);
    }
  };
  const publish = async (s: Site) => {
    setBusy(s.id);
    try {
      const out = await api.post<{ folder: string; url: string; deployed: boolean }>("/api/sites/publish", { id: s.id });
      toast(out.deployed ? `Live at ${out.url}` : out.url ? `Exported. Link: ${out.url}` : `Exported to ${out.folder}`);
      void res.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <PageHeader
        section={sectionOf("sites")}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setPicking((v) => !v)}>
              <UserRoundIcon /> Build for a lead
            </Button>
            <Button size="sm" render={<a href={studio.home} />}>
              <PlusIcon /> New site
            </Button>
          </>
        }
      />
      <Body>
        <p className="max-w-3xl text-[13px] leading-5 text-muted-foreground">
          Build a business a better website before you ever talk to them. Pick a lead, pick a template (it starts with their name), change what you like on the canvas, then send it. In any email or sequence, <code className="rounded bg-muted px-1 text-xs">{"{{site_url}}"}</code> is the link to the site you built for that person.
        </p>
        {picking && <LeadPicker onClose={() => setPicking(false)} />}
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!res.data && res.loading && <LoadingRows />}
        {res.data && list.length === 0 && (
          <Panel>
            <Quiet>
              No sites yet. Use <strong>Build for a lead</strong> to make one for a business you found, or <a className="underline" href={studio.home}>open Studio</a> and start from a template.
            </Quiet>
          </Panel>
        )}
        {list.length > 0 && (
          <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
            {list.map((s) => (
              <section key={s.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <a href={studio.edit(s.id)} aria-label={`Edit ${s.name}`}>
                  <Thumb src={s.preview} title={s.name} />
                </a>
                <div className="flex flex-col gap-1.5 p-3.5">
                  <div className="flex items-center gap-2">
                    <a href={studio.edit(s.id)} className="min-w-0 flex-1 truncate text-[13px] font-semibold hover:underline">
                      {s.name}
                    </a>
                    {s.url ? <Badge variant="success">Live</Badge> : <Badge variant="secondary">Draft</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.lead_email ? (
                      <a className="hover:underline" href={href("people", "people", s.lead_email)}>
                        For {s.company || s.lead_email}
                      </a>
                    ) : (
                      "Not linked to a lead"
                    )}
                    {" · "}
                    {s.page_count} {s.page_count === 1 ? "page" : "pages"} · edited {ago(s.updated)}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Button size="xs" render={<a href={studio.edit(s.id)} />}>
                      <PencilIcon /> Edit
                    </Button>
                    <Button size="xs" variant="outline" render={<a href={s.preview} target="_blank" rel="noopener noreferrer" />}>
                      <ExternalLinkIcon /> Open
                    </Button>
                    <Button size="xs" variant="outline" disabled={busy === s.id} onClick={() => void publish(s)}>
                      <UploadCloudIcon /> {busy === s.id ? "Publishing…" : "Publish"}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => void copy(s)}>
                      <CopyIcon /> Copy link
                    </Button>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
        {res.data && !res.data.netlify && !res.data.base_url && list.length > 0 && (
          <p className="text-xs leading-5 text-muted-foreground">
            Publish saves each site as a folder of plain HTML. For a link you can email, add a Netlify token (free) or the address where you host the folders, under{" "}
            <a className="underline" href={href("settings", "all")}>Settings → All settings</a>.
          </p>
        )}
      </Body>
    </>
  );
}
