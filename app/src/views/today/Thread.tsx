import { ArrowUpIcon, CheckIcon, CircleAlertIcon, CornerDownRightIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { BrandIcon } from "~/components/app/Mark";
import { onAsk } from "~/lib/requests";
import { href } from "~/lib/router";
import { PROVIDER_BRAND, useSetup } from "~/lib/setup";
import { cn } from "~/lib/utils";

import type { Turn } from "./useAsk";

/** The ask box. Enter sends, Shift+Enter breaks the line. */
export function Composer({ onAsk: submit, busy, autoFocus, className }: { onAsk: (text: string) => void; busy: boolean; autoFocus?: boolean; className?: string }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const setup = useSetup();
  const model = setup.ai.current;

  // The sidebar and the palette can hand a request over.
  useEffect(
    () =>
      onAsk((t) => {
        setText(t);
        ref.current?.focus();
      }),
    [],
  );

  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    submit(t);
    setText("");
  };

  return (
    <div
      className={cn(
        "cursor-text rounded-2xl border border-input bg-card shadow-composer transition-shadow focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/15",
        className,
      )}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button,a")) ref.current?.focus();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={text}
        autoFocus={autoFocus}
        data-ask-input
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Who to find, who to email, or a question about your workspace"
        aria-label="Ask OpenLeads"
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 outline-none placeholder:text-placeholder"
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5">
        {/* Which model reads the request, and one click to change it. */}
        <a
          href={href("settings", "connections")}
          className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {model ? <BrandIcon size="sm" name={PROVIDER_BRAND[model.provider] ?? model.provider} label={model.label} /> : <SparklesIcon className="size-3.5" />}
          <span className="truncate">{model ? model.label.split(" (")[0] : "Built-in rules"}</span>
          {!model && setup.loaded && <span className="shrink-0 text-primary-ink">Connect a model</span>}
        </a>
        <span className="ms-auto text-xs text-muted-foreground max-sm:hidden">Nothing runs until you say yes</span>
        <Button size="icon-sm-pill" className="max-sm:ms-auto" disabled={!text.trim() || busy} onClick={send} aria-label="Ask">
          {busy ? <Spinner /> : <ArrowUpIcon />}
        </Button>
      </div>
    </div>
  );
}

function PlanCard({ turn, onRun, onDismiss }: { turn: Turn; onRun: (confirmed: boolean) => void; onDismiss: () => void }) {
  const plan = turn.plan!;
  const waiting = turn.status === "plan";
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2">
        <span className="text-[13px] font-semibold">Plan</span>
        <span className="text-xs text-muted-foreground">
          {plan.by === "rules" ? "read by the built-in rules" : `read by ${plan.by}`}
        </span>
        {plan.schedule && <span className="ms-auto text-xs text-muted-foreground">runs {plan.schedule}</span>}
      </div>
      <ol className="flex flex-col gap-1.5 px-3.5 py-3">
        {plan.steps.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-[13px] leading-5">
            <span className="w-4 shrink-0 text-end text-muted-foreground tabular-nums">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {plan.kind === "unsupported" && (
        <div className="border-t border-border px-3.5 py-2.5 text-[13px] text-muted-foreground">
          OpenLeads can't do that from a sentence yet. In a terminal: <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{plan.suggestion}</code>
        </div>
      )}
      {waiting && turn.runnable && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/60 px-3.5 py-2.5">
          {plan.needs_yes ? (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-warning-foreground">
              <CircleAlertIcon className="size-3.5 shrink-0" />
              The model read this as more than a search. Check the steps before you say yes.
            </span>
          ) : (
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              {plan.schedule ? "Saving it starts the schedule." : plan.kind === "find" ? "A search. Nothing is sent." : "Nothing sends without your approval."}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Not now
          </Button>
          {/* Enter runs an ordinary plan; one the model widened has to be clicked on purpose. */}
          <Button size="sm" onClick={() => onRun(plan.needs_yes)} autoFocus={!plan.needs_yes}>
            {plan.needs_yes ? "Yes, run it" : plan.schedule ? "Save schedule" : "Run it"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Progress({ turn }: { turn: Turn }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <Spinner className="size-3.5" />
        Working on it
        {turn.found > 0 && <span className="font-normal text-muted-foreground tabular-nums">{turn.found} found so far</span>}
      </div>
      {turn.log.map((line, i) => (
        <div key={i} className={cn("flex gap-2 text-xs text-muted-foreground", i === turn.log.length - 1 && "text-foreground")}>
          <CornerDownRightIcon className="mt-0.5 size-3 shrink-0 opacity-60" />
          <span className="min-w-0 break-words">{line}</span>
        </div>
      ))}
    </div>
  );
}

function Outcome({ turn }: { turn: Turn }) {
  const r = turn.result;
  return (
    <div className="flex flex-col gap-2">
      <Said>{turn.answer}</Said>
      {r && r.ok && (
        <div className="flex flex-wrap gap-2 ps-8">
          {r.drafts_waiting > 0 && (
            <Button size="sm" variant="outline" render={<a href={href("outreach", "approvals")} />}>
              Review {r.drafts_waiting} {r.drafts_waiting === 1 ? "draft" : "drafts"}
            </Button>
          )}
          {r.leads > 0 && (
            <Button size="sm" variant="outline" render={<a href={href("people")} />}>
              See the people
            </Button>
          )}
          {r.scheduled && (
            <Button size="sm" variant="outline" render={<a href={href("workflows")} />}>
              See the workflow
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Said({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div className="flex gap-2.5">
      <span className={cn("mt-0.5 grid size-5.5 shrink-0 place-items-center rounded-full bg-primary-wash text-primary-ink", tone === "error" && "bg-error-surface text-error-foreground")}>
        {tone === "error" ? <CircleAlertIcon className="size-3" /> : <SparklesIcon className="size-3" />}
      </span>
      <p className={cn("min-w-0 text-[15px] leading-6", tone === "error" && "text-error-foreground")}>{children}</p>
    </div>
  );
}

/** Everything you asked this session, oldest first: your words, then what OpenLeads made of them. */
export function Thread({
  turns,
  onRun,
  onDismiss,
}: {
  turns: Turn[];
  onRun: (turn: Turn, confirmed: boolean) => void;
  onDismiss: (turn: Turn) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const last = turns[turns.length - 1];
  const signature = last ? `${turns.length}:${last.status}:${last.log.length}` : "";
  useEffect(() => {
    // Not smooth: a smooth scroll is dropped when the next line arrives mid-animation.
    if (signature) end.current?.scrollIntoView({ block: "end" });
  }, [signature]);

  if (!turns.length) return null;
  return (
    <div className="flex flex-col gap-6">
      {turns.map((t) => (
        <article key={t.id} className="flex flex-col gap-3" aria-label={`Request: ${t.text}`}>
          <div className="ms-auto max-w-[85%] rounded-2xl rounded-br-md bg-message px-3.5 py-2 text-[15px] leading-6">{t.text}</div>
          {t.status === "reading" && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Spinner className="size-3.5" /> Reading your request
            </div>
          )}
          {t.plan && t.status !== "dismissed" && <PlanCard turn={t} onRun={(c) => onRun(t, c)} onDismiss={() => onDismiss(t)} />}
          {t.status === "dismissed" && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <CheckIcon className="size-3.5" /> Nothing ran.
            </div>
          )}
          {t.status === "running" && <Progress turn={t} />}
          {t.status === "answer" && <Said>{t.answer}</Said>}
          {t.status === "done" && <Outcome turn={t} />}
          {t.status === "error" && <Said tone="error">{t.error}</Said>}
        </article>
      ))}
      <div ref={end} />
    </div>
  );
}
