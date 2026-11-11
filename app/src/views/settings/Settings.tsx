import { CheckIcon, CircleAlertIcon, CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

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

interface AiState {
  current: { provider: string; model: string; label: string } | null;
  problem: string;
  detected: { provider: string; kind: string; label: string }[];
}

const JOBS = [
  ["Reads your requests", "Turns a sentence into a plan you check before it runs."],
  ["Writes drafts", "From the facts OpenLeads found. Anything else is thrown away."],
  ["Sorts replies", "Flags the ones that need you and suggests an answer. It never hides one."],
  ["Reads your morning", "One or two sentences on Today about what matters first."],
];

export function Model() {
  const res = useApi<AiState>("/api/ai");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ai = res.data;

  const use = async (provider: string) => {
    setBusy(provider);
    setNote(null);
    try {
      const r = await api.post<{ ok: boolean; detail?: string }>("/api/ai/use", { provider });
      if (r.ok) toast(provider === "off" ? "Using the built-in rules" : "Model connected");
      else setNote({ ok: false, text: `Not switched: ${r.detail}` });
      await res.reload();
    } catch (e) {
      fail(e);
    }
    setBusy("");
  };
  const test = async () => {
    setBusy("test");
    setNote(null);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>("/api/ai/test", {});
      setNote({ ok: r.ok, text: r.ok ? `It works: ${r.detail}` : r.detail });
    } catch (e) {
      fail(e);
    }
    setBusy("");
  };

  return (
    <>
      <PageHeader section={SECTION} page="model" />
      <Body>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!ai && res.loading && <LoadingRows />}
        {ai && (
          <>
            <section className="rounded-xl border border-border bg-card p-4">
              <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Using now</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-[15px] font-semibold">{ai.current ? ai.current.label : "No model. The built-in rules do the work."}</p>
                {ai.current && (
                  <Button size="xs" variant="outline" className="ms-auto" disabled={!!busy} onClick={test}>
                    {busy === "test" && <Spinner />} Test it
                  </Button>
                )}
              </div>
              {ai.problem && (
                <p className="mt-2 flex gap-1.5 text-[13px] text-warning-foreground">
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {ai.problem}
                </p>
              )}
              {note && <p className={cn("mt-2 text-[13px]", note.ok ? "text-success-foreground" : "text-error-foreground")}>{note.text}</p>}
              <p className="mt-2 text-[13px] text-muted-foreground">A subscription or a paid key is used only after you pick it here.</p>
            </section>

            <Panel title="On this computer" count={ai.detected.length}>
              {ai.detected.length === 0 && (
                <p className="px-3.5 py-4 text-[13px] text-muted-foreground">
                  Nothing found. Install the Claude or Codex CLI, start Ollama, or add an API key under All settings.
                </p>
              )}
              {ai.detected.map((d) => {
                const on = ai.current?.provider === d.provider;
                return (
                  <Row key={d.provider} className="items-center">
                    <div className="min-w-0 flex-1">
                      <span className="text-[13px] font-medium">{d.label}</span>
                      <Badge variant="secondary" className="ms-2">
                        {d.kind}
                      </Badge>
                    </div>
                    {on ? (
                      <span className="flex items-center gap-1 text-xs text-success-foreground">
                        <CheckIcon className="size-3.5" /> In use
                      </span>
                    ) : (
                      <Button size="xs" variant="outline" disabled={!!busy} onClick={() => use(d.provider)}>
                        {busy === d.provider && <Spinner />} Use this
                      </Button>
                    )}
                  </Row>
                );
              })}
              {ai.current && (
                <Row className="items-center">
                  <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">Go back to the built-in rules</span>
                  <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => use("off")}>
                    Turn the model off
                  </Button>
                </Row>
              )}
            </Panel>

            <section>
              <h2 className="mb-2 text-[13px] font-semibold">What a model does here</h2>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {JOBS.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[13px] font-medium">{k}</dt>
                    <dd className="text-[13px] leading-5 text-muted-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[13px] text-muted-foreground">
                API keys, the model name and a custom endpoint are under{" "}
                <a className="text-foreground underline underline-offset-2" href={classic("settings/ai")}>
                  All settings
                </a>
                .
              </p>
            </section>
          </>
        )}
      </Body>
    </>
  );
}

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
