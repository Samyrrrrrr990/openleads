import { SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Body, ErrorNote, LoadingRows, Quiet } from "~/components/app/bits";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Input } from "~/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { num } from "~/lib/format";
import { classic } from "~/lib/router";
import type { Page } from "~/lib/types";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";

interface Company {
  domain: string;
  name: string;
  industry: string;
  company_size: string;
  city: string;
  state: string;
  country: string;
  technologies: string[];
  people: number;
  safe: number;
  contacted: number;
}

export function Companies() {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDq(q.trim()), 220);
    return () => window.clearTimeout(t);
  }, [q]);
  const body = useMemo(() => ({ filters: dq ? { q: dq } : {}, per_page: 100 }), [dq]);
  const res = useApi<Page<Company>>("/api/companies/search", body);
  const data = res.data;
  return (
    <>
      <PageHeader section={sectionOf("people")} page="companies" />
      <Body wide className="gap-3">
        <div className="flex items-center gap-2">
          <div className="relative w-72 max-w-full">
            <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" className="*:ps-8" aria-label="Search companies" />
          </div>
          <span className="ms-auto text-xs text-muted-foreground tabular-nums">{data ? `${num(data.total)} ${data.total === 1 ? "company" : "companies"}` : ""}</span>
        </div>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        <div className={cn("overflow-hidden rounded-xl border border-border bg-card", res.loading && data && "opacity-60")}>
          {!data && res.loading ? (
            <LoadingRows rows={8} />
          ) : data && data.rows.length === 0 ? (
            <Quiet>{dq ? "No company matches that." : "No companies yet. They appear as you find people."}</Quiet>
          ) : (
            data && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Where</TableHead>
                    <TableHead>Uses</TableHead>
                    <TableHead className="text-end">People</TableHead>
                    <TableHead className="text-end">Contacted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((c) => (
                    <TableRow key={c.domain} className="cursor-pointer" onClick={() => (window.location.hash = classic("people", `companies/${encodeURIComponent(c.domain)}`))}>
                      <TableCell>
                        <span className="font-medium">{c.name || c.domain}</span>
                        <span className="ms-2 text-xs text-muted-foreground">{c.domain}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c.industry}</TableCell>
                      <TableCell className="text-muted-foreground">{c.company_size}</TableCell>
                      <TableCell className="text-muted-foreground">{[c.city, c.state || c.country].filter(Boolean).join(", ")}</TableCell>
                      <TableCell className="max-w-56 truncate text-muted-foreground">{(c.technologies || []).slice(0, 3).join(", ")}</TableCell>
                      <TableCell className="text-end tabular-nums">{c.people}</TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">{c.contacted}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          )}
        </div>
      </Body>
    </>
  );
}
