import { Body, ErrorNote, LoadingRows, Quiet } from "~/components/app/bits";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Button } from "~/components/ui/button";
import { ago, plural } from "~/lib/format";
import { classic, href } from "~/lib/router";
import { useApi } from "~/lib/use-api";

import { People } from "./People";

interface List {
  id: number;
  name: string;
  kind: string;
  description: string;
  color: string;
  updated: number;
  count: number;
}

export function Lists({ open, person }: { open?: string; person?: string }) {
  const res = useApi<{ lists: List[] }>("/api/lists");
  const lists = res.data?.lists ?? [];
  const current = open ? lists.find((l) => String(l.id) === open) : undefined;
  if (open && current && current.kind !== "companies") {
    return <People listId={current.id} listName={current.name} open={person} />;
  }
  return (
    <>
      <PageHeader
        section={sectionOf("people")}
        page="lists"
        actions={
          <Button size="sm" variant="outline" render={<a href={classic("lists")} />}>
            Manage lists
          </Button>
        }
      />
      <Body>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!res.data && res.loading && <LoadingRows />}
        {res.data && lists.length === 0 && <Quiet>No lists yet. Save a search or a selection as a list from People.</Quiet>}
        <div className="grid gap-3 sm:grid-cols-2">
          {lists.map((l) => (
            <a
              key={l.id}
              href={l.kind === "companies" ? classic(`lists/${l.id}`) : href("people", "lists", String(l.id))}
              className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-input"
            >
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: l.color || "var(--muted-foreground)" }} />
                <span className="font-medium">{l.name}</span>
                <span className="ms-auto text-xs text-muted-foreground">{l.kind === "companies" ? plural(l.count, "company", "companies") : plural(l.count, "person", "people")}</span>
              </div>
              {l.description && <p className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">{l.description}</p>}
              <p className="mt-2 text-xs text-muted-foreground">Updated {ago(l.updated)}</p>
            </a>
          ))}
        </div>
      </Body>
    </>
  );
}
