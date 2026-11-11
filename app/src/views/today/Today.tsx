import { useCallback, useEffect, useState } from "react";

import { Body, ErrorNote, LoadingRows } from "~/components/app/bits";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { api } from "~/lib/api";
import { setCounts } from "~/lib/counts";
import { dayLabel, plural } from "~/lib/format";
import type { Briefing as BriefingData } from "~/lib/types";
import { useApi } from "~/lib/use-api";

import { Briefing } from "./Briefing";
import { Composer, Thread } from "./Thread";
import { useAsk } from "./useAsk";

function summary(b: BriefingData): string {
  const n = b.counts;
  const parts = [
    n.replies ? plural(n.replies, "reply", "replies") : "",
    n.drafts ? plural(n.drafts, "email to approve", "emails to approve") : "",
    n.tasks ? plural(n.tasks, "task", "tasks") : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : "Nothing needs you right now.";
}

export function Today() {
  const today = useApi<BriefingData>("/api/today");
  const [line, setLine] = useState("");
  const reload = today.reload;
  const changed = useCallback(() => void reload(), [reload]);
  const { turns, ask, run, dismiss } = useAsk(changed);

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

  const busy = turns.some((t) => t.status === "reading" || t.status === "running");

  return (
    <>
      <PageHeader section={sectionOf("today")} />
      <Body>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{dayLabel()}</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">{today.data ? summary(today.data) : " "}</p>
          {line && <p className="mt-3 max-w-[60ch] text-[15px] leading-6">{line}</p>}
        </div>
        {today.error && <ErrorNote message={today.error} onRetry={changed} />}
        {!today.data && today.loading && <LoadingRows rows={5} />}
        {today.data && <Briefing b={today.data} onChanged={changed} />}
        <Thread turns={turns} onRun={(t, confirmed) => t.planId && run(t.id, t.planId, confirmed)} onDismiss={(t) => dismiss(t.id)} />
      </Body>
      <Composer onAsk={ask} busy={busy} showExamples={turns.length === 0} />
    </>
  );
}
