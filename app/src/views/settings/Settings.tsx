import { type CheckIcon, CircleAlertIcon, CircleCheckIcon, TriangleAlertIcon } from "lucide-react";

import { Body, ErrorNote, LoadingRows, Panel, Row } from "~/components/app/bits";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { api } from "~/lib/api";
import { classic } from "~/lib/router";
import { fail, toast } from "~/lib/toast";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";

const SECTION = sectionOf("settings");

interface Check {
  group: string;
  label: string;
  status: "ok" | "warn" | "bad" | string;
  detail: string;
}

const MARK: Record<string, { icon: typeof CheckIcon; cls: string }> = {
  ok: { icon: CircleCheckIcon, cls: "text-success" },
  warn: { icon: TriangleAlertIcon, cls: "text-warning" },
  bad: { icon: CircleAlertIcon, cls: "text-error" },
};

export function Doctor() {
  const res = useApi<{ checks: Check[]; summary: { ok: number; warn: number; bad: number } }>("/api/doctor");
  const groups = new Map<string, Check[]>();
  for (const c of res.data?.checks ?? []) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  const s = res.data?.summary;
  return (
    <>
      <PageHeader
        section={SECTION}
        page="doctor"
        actions={
          <Button size="sm" variant="outline" onClick={() => void res.reload()} disabled={res.loading}>
            {res.loading && <Spinner />} Check again
          </Button>
        }
      />
      <Body>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!res.data && res.loading && <LoadingRows rows={6} />}
        {s && (
          <p className="text-[15px]">
            {s.bad ? `${s.bad} thing${s.bad === 1 ? "" : "s"} to fix` : "Nothing is broken"}
            {s.warn ? `, ${s.warn} optional.` : "."}
          </p>
        )}
        {[...groups.entries()].map(([group, checks]) => (
          <Panel key={group} title={group}>
            {checks.map((c, i) => {
              const { icon: Icon, cls } = MARK[c.status] ?? MARK.warn;
              return (
                <Row key={i} className="items-start">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", cls)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{c.label}</p>
                    {c.detail && <p className="text-[13px] text-muted-foreground">{c.detail}</p>}
                  </div>
                </Row>
              );
            })}
          </Panel>
        ))}
      </Body>
    </>
  );
}
