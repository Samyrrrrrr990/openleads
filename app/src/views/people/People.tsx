import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Avatar, Body, ErrorNote, LoadingRows, Quiet, ToneBadge } from "~/components/app/bits";
import { Pick } from "~/components/app/Pick";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { ago, num } from "~/lib/format";
import { useMeta } from "~/lib/meta";
import { href, navigate } from "~/lib/router";
import type { Page, Person } from "~/lib/types";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";

import { PersonSheet } from "./PersonSheet";

function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const TIERS = [
  { key: "", label: "Any email" },
  { key: "safe", label: "Deliverable" },
  { key: "risky", label: "Risky" },
];

const SORTS = [
  { key: "updated", label: "Recently updated" },
  { key: "created", label: "Newest" },
  { key: "fit", label: "Best fit" },
  { key: "name", label: "Name" },
];

export function FitDot({ score }: { score: number }) {
  // A score out of 100 is an amount, not a status: one colour, longer for more.
  return (
    <span className="inline-flex items-center gap-2 tabular-nums" title={`Fit ${score} out of 100`}>
      <span className="h-1.5 w-8 rounded-full bg-border" aria-hidden>
        <span className="block h-1.5 rounded-full bg-chart-1" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </span>
      <span className="w-6 text-end">{score}</span>
    </span>
  );
}

export function People({ open, listId, listName }: { open?: string; listId?: number; listName?: string }) {
  const meta = useMeta();
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [tier, setTier] = useState("");
  const [sort, setSort] = useState("updated");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);

  useEffect(() => setPage(1), [dq, stage, tier, sort, listId]);

  const body = useMemo(
    () => ({
      filters: {
        ...(dq.trim() ? { q: dq.trim() } : {}),
        ...(stage ? { stage: [stage] } : {}),
        ...(tier ? { tier: [tier] } : {}),
        ...(listId ? { list_id: listId } : {}),
      },
      sort,
      direction: sort === "name" ? "asc" : "desc",
      page,
      per_page: 50,
    }),
    [dq, stage, tier, sort, page, listId],
  );
  const people = useApi<Page<Person>>("/api/people/search", body);
  const stages = meta?.contact_stages ?? [];
  const stageOf = (key: string) => stages.find((s) => s.key === key);
  const data = people.data;
  // Opening someone keeps you where you are: in the list, or in everyone.
  const show = (email: string) => (listId ? navigate("people", "lists", String(listId), email) : navigate("people", "people", email));

  return (
    <>
      <PageHeader
        section={sectionOf("people")}
        page={listId ? "lists" : "people"}
        actions={
          <Button size="sm" render={<a href={href("people", "find")} />}>
            Find people
          </Button>
        }
      />
      <Body wide className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72 max-w-full max-md:w-full">
            <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, title, email" className="*:ps-8" aria-label="Search people" />
          </div>
          <Pick label="Stage" value={stage} onChange={setStage} options={[{ key: "", label: "Any stage" }, ...stages]} />
          <Pick label="Email" value={tier} onChange={setTier} options={TIERS} />
          <Pick label="Sort" value={sort} onChange={setSort} options={SORTS} />
          {listName && (
            <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs">
              List: {listName}{" "}
              <a href={href("people", "lists")} className="text-muted-foreground hover:text-foreground">
                (all lists)
              </a>
            </span>
          )}
          <span className="ms-auto text-xs text-muted-foreground tabular-nums">{data ? `${num(data.total)} ${data.total === 1 ? "person" : "people"}` : ""}</span>
        </div>

        {people.error && <ErrorNote message={people.error} onRetry={() => void people.reload()} />}
        <div className={cn("overflow-hidden rounded-xl border border-border bg-card transition-opacity", people.loading && data && "opacity-60")}>
          {!data && people.loading ? (
            <LoadingRows rows={8} />
          ) : data && data.rows.length === 0 ? (
            <Quiet>
              {dq || stage || tier ? "No one matches those filters." : "No people yet. Ask for some, or use Find people."}
            </Quiet>
          ) : (
            data && (
              <>
              <ul className="md:hidden">
                {data.rows.map((p) => {
                  const st = stageOf(p.stage);
                  return (
                    <li key={p.email} className="border-b border-border last:border-b-0">
                      <a href={listId ? href("people", "lists", String(listId), p.email) : href("people", "people", p.email)} className="flex items-start gap-3 px-3.5 py-3">
                        <Avatar name={p.name} email={p.email} className="mt-0.5 size-8" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="min-w-0 truncate text-sm font-medium">{p.name || p.email.split("@")[0]}</span>
                            <span className="ms-auto shrink-0">{st ? <ToneBadge tone={st.tone}>{st.label}</ToneBadge> : p.stage}</span>
                          </span>
                          <span className="block truncate text-sm text-muted-foreground">{[p.title, p.organization].filter(Boolean).join(" at ")}</span>
                          <span className="addr block truncate text-sm text-muted-foreground">{p.email}</span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
              <Table className="max-md:hidden">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="max-xl:hidden">Title</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-end">Fit</TableHead>
                    <TableHead className="text-end">Last contacted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((p) => {
                    const st = stageOf(p.stage);
                    return (
                      <TableRow
                        key={p.email}
                        className="cursor-pointer"
                        data-state={open === p.email ? "selected" : undefined}
                        onClick={() => show(p.email)}
                      >
                        <TableCell>
                          <span className="flex items-center gap-2.5">
                            <Avatar name={p.name} email={p.email} className="size-6" />
                            <a href={listId ? href("people", "lists", String(listId), p.email) : href("people", "people", p.email)} onClick={(e) => e.stopPropagation()} className="truncate font-medium hover:underline">
                              {p.name || p.email.split("@")[0]}
                            </a>
                          </span>
                        </TableCell>
                        <TableCell className="max-w-56 truncate text-muted-foreground max-xl:hidden">{p.title}</TableCell>
                        <TableCell className="max-w-48 truncate">{p.organization}</TableCell>
                        <TableCell className="max-w-64 truncate">
                          <span className="addr">{p.email}</span>
                          {p.tier === "risky" && <span className="ms-1.5 text-2xs text-warning-foreground">risky</span>}
                        </TableCell>
                        <TableCell>{st ? <ToneBadge tone={st.tone}>{st.label}</ToneBadge> : p.stage}</TableCell>
                        <TableCell className="text-end">
                          <FitDot score={p.fit_score} />
                        </TableCell>
                        <TableCell className="text-end text-muted-foreground">{p.last_contacted ? ago(p.last_contacted) : "Never"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </>
            )
          )}
        </div>

        {data && data.pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            Page {data.page} of {data.pages}
            <Button size="icon-xs" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <ChevronLeftIcon />
            </Button>
            <Button size="icon-xs" variant="outline" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <ChevronRightIcon />
            </Button>
          </div>
        )}
      </Body>
      <PersonSheet
        email={open}
        onClose={() => (listId ? navigate("people", "lists", String(listId)) : navigate("people"))}
        onChanged={() => void people.reload()}
      />
    </>
  );
}
