import { MailIcon, MessageCircleQuestionIcon, PlusIcon, SearchIcon } from "lucide-react";

import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Button } from "~/components/ui/button";
import { askFor, useRequests } from "~/lib/requests";
import { Composer, Thread } from "~/views/today/Thread";
import { ask, clearTurns, dismiss, run, useTurns } from "~/views/today/useAsk";

const STARTERS = [
  {
    icon: SearchIcon,
    title: "Search for people",
    note: "A search. Nothing is sent.",
    examples: ["Find 20 dentists in Austin", "Find founders of YC fintech startups"],
  },
  {
    icon: MailIcon,
    title: "Write to them",
    note: "Drafts wait for your approval.",
    examples: ["Email 15 agencies in Miami about our SEO audit", "Every weekday at 9, email 10 new gyms in Denver"],
  },
  {
    icon: MessageCircleQuestionIcon,
    title: "Ask about your workspace",
    note: "Answered from your own data.",
    examples: ["Who replied this week and what do they want?", "Which deals have gone quiet?"],
  },
];

export function Ask() {
  const turns = useTurns();
  const recent = useRequests();
  const busy = turns.some((t) => t.status === "reading" || t.status === "running");
  const empty = turns.length === 0;
  // A request that is already one of the examples isn't worth showing twice.
  const again = recent.filter((r) => !STARTERS.some((s) => s.examples.includes(r)));

  return (
    <>
      <PageHeader
        section={sectionOf("ask")}
        actions={
          !empty && (
            <Button size="sm" variant="outline" onClick={clearTurns} disabled={busy}>
              <PlusIcon /> New chat
            </Button>
          )
        }
      />
      {empty ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[var(--content-max)] flex-col justify-center gap-6 px-5 py-8 max-md:px-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">What do you want to do?</h2>
              <p className="mt-1 text-[15px] text-muted-foreground">Say it in a sentence. You see the plan first, and emails wait for your yes.</p>
            </div>
            <Composer onAsk={ask} busy={busy} autoFocus />
            <div className="grid gap-x-4 gap-y-5 sm:grid-cols-3">
              {STARTERS.map((s) => (
                <section key={s.title}>
                  <h3 className="flex items-center gap-1.5 text-[13px] font-medium">
                    <s.icon className="size-3.5 text-muted-foreground" /> {s.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.note}</p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {s.examples.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => askFor(e)}
                        className="cursor-pointer rounded-lg border border-border bg-card px-2.5 py-2 text-start text-[13px] leading-5 text-muted-foreground transition-colors hover:border-input hover:text-foreground max-md:py-2.5 max-md:text-sm"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            {again.length > 0 && (
              <section>
                <h3 className="text-[13px] font-medium">Ask again</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {again.slice(0, 6).map((r) => (
                    <button
                      key={r}
                      type="button"
                      title={r}
                      onClick={() => askFor(r)}
                      className="h-7 max-w-full cursor-pointer truncate rounded-full border border-border bg-card px-3 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground max-md:h-10 max-md:text-sm"
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[var(--content-max)] px-5 py-6 max-md:px-4 max-md:py-4">
              <Thread turns={turns} onRun={(t, confirmed) => t.planId && run(t.id, t.planId, confirmed)} onDismiss={(t) => dismiss(t.id)} />
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-[var(--content-max)] px-5 pb-5 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-background before:to-transparent max-md:px-4 max-md:pb-3">
            <Composer onAsk={ask} busy={busy} autoFocus />
          </div>
        </>
      )}
    </>
  );
}
