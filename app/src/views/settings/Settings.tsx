import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, type LucideIcon } from "lucide-react";

import { Body, ErrorNote, LoadingRows, Panel, Row } from "~/components/app/bits";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { plural } from "~/lib/format";
import { href } from "~/lib/router";
import { PROVIDER_NAME, refreshSetup, useSetup } from "~/lib/setup";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";

const SECTION = sectionOf("settings");

interface Check {
  group: string;
  label: string;
  status: "ok" | "warn" | "bad" | string;
  detail: string;
}

/** "ok" works, "todo" is optional and not set up, "bad" is broken. */
type State = "ok" | "todo" | "bad";

interface Line {
  key: string;
  state: State;
  title: string;
  detail: string;
  link?: { label: string; to: string };
}

const MARK: Record<State, { icon: LucideIcon; cls: string; word: string }> = {
  ok: { icon: CircleCheckIcon, cls: "text-success-foreground", word: "Working" },
  todo: { icon: CircleDashedIcon, cls: "text-muted-foreground", word: "Optional" },
  bad: { icon: CircleAlertIcon, cls: "text-error-foreground", word: "Needs fixing" },
};

const stateOf = (c: Check | undefined, optional = false): State => (!c || c.status === "ok" ? "ok" : c.status === "bad" ? "bad" : optional ? "todo" : "bad");

/** Checks the server runs, said the way you'd say them to a person. */
function network(checks: Check[]): Line[] {
  const find = (label: string) => checks.find((c) => c.label === label);
  const dns = find("DNS-over-HTTPS");
  const smtp = find("SMTP port 25");
  const lines: Line[] = [];
  if (dns)
    lines.push({
      key: "dns",
      state: stateOf(dns),
      title: "Looking up a company's mail server",
      detail: dns.status === "ok" ? "Working. This is how OpenLeads tells whether a domain can receive email." : "Not reachable. Check your internet connection, then check again.",
    });
  if (smtp)
    lines.push({
      key: "smtp",
      state: stateOf(smtp, true),
      title: "Asking a mail server whether an address exists",
      detail:
        smtp.status === "ok"
          ? "Working. Addresses are confirmed before anything is sent to them."
          : "Your network blocks this, which is common on home and office internet. Addresses are still checked, less thoroughly.",
    });
  return lines;
}

function Lines({ title, lines }: { title: string; lines: Line[] }) {
  if (!lines.length) return null;
  return (
    <Panel title={title}>
      {lines.map((l) => {
        const { icon: Icon, cls, word } = MARK[l.state];
        return (
          <Row key={l.key} className="items-start max-sm:flex-wrap">
            <Icon className={cn("mt-0.5 size-4 shrink-0", cls)} aria-label={word} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium max-md:text-sm">{l.title}</p>
              <p className="text-[13px] leading-5 text-muted-foreground max-md:text-sm">{l.detail}</p>
            </div>
            {l.link && (
              <Button size="sm" variant="outline" className="shrink-0 max-md:h-10 max-sm:ms-7" render={<a href={l.link.to} />}>
                {l.link.label}
              </Button>
            )}
          </Row>
        );
      })}
    </Panel>
  );
}

export function Doctor() {
  const res = useApi<{ checks: Check[] }>("/api/doctor");
  const setup = useSetup();
  const checks = res.data?.checks ?? [];
  const ready = !!res.data && setup.loaded;

  const model = setup.ai.current?.provider;
  const found = setup.ai.detected[0]?.provider;
  const name = (p: string) => PROVIDER_NAME[p] ?? p;
  const login = checks.find((c) => /smtp login/i.test(c.label));
  const connections: Line[] = [
    setup.ai.problem
      ? { key: "ai", state: "bad", title: "AI model: the one you chose stopped working", detail: "It isn't reachable on this computer right now, so the built-in rules are doing the work.", link: { label: "Fix", to: href("settings", "connections", "model") } }
      : model
      ? { key: "ai", state: "ok", title: `AI model: ${name(model)}`, detail: "Reads your requests and writes drafts." }
      : {
          key: "ai",
          state: "todo",
          title: "AI model: none, using the built-in rules",
          detail: found ? `${name(found)} is on this computer and ready to use. Until then, drafts are written from your templates.` : "Drafts are written from your templates. A model writes them from what it found about each person.",
          link: { label: found ? `Use ${name(found)}` : "Connect a model", to: href("settings", "connections", "model") },
        },
    setup.mailbox && login?.status === "bad"
      ? { key: "mail", state: "bad", title: "Mailbox: stopped logging in", detail: "Your mail provider turned down the saved password. Make a new app password and connect again.", link: { label: "Fix", to: href("settings", "connections", "mailbox") } }
      : setup.mailbox
      ? { key: "mail", state: "ok", title: "Mailbox: connected", detail: "Approved emails go out from your address." }
      : { key: "mail", state: "todo", title: "Mailbox: not connected", detail: "You can find people and write drafts. Nothing can be sent until a mailbox is connected.", link: { label: "Connect a mailbox", to: href("settings", "connections", "mailbox") } },
    ...(setup.mailbox
      ? [
          setup.inbox
            ? ({ key: "inbox", state: "ok", title: "Replies: being read", detail: "New replies show on Today." } as Line)
            : ({ key: "inbox", state: "todo", title: "Replies: not being read", detail: "Add the incoming mail server to see replies on Today.", link: { label: "Set up", to: href("settings", "connections", "mailbox") } } as Line),
        ]
      : []),
    setup.settings.github_token?.is_set
      ? { key: "gh", state: "ok", title: "GitHub token: saved", detail: "Developer searches can run longer." }
      : { key: "gh", state: "todo", title: "GitHub token: not added", detail: "Developer searches work without one. A token lets them run longer before GitHub slows them down.", link: { label: "Add", to: href("settings", "connections", "search") } },
  ];
  const net = network(checks);
  const all = [...connections, ...net];
  const bad = all.filter((l) => l.state === "bad").length;
  const todo = all.filter((l) => l.state === "todo").length;

  return (
    <>
      <PageHeader
        section={SECTION}
        page="doctor"
        actions={
          <Button
            size="sm"
            variant="outline"
            className="max-md:h-10"
            onClick={() => {
              void res.reload();
              void refreshSetup();
            }}
            disabled={res.loading}
          >
            {res.loading && <Spinner />} Check again
          </Button>
        }
      />
      <Body>
        {res.error && <ErrorNote message={res.error} onRetry={() => void res.reload()} />}
        {!ready && !res.error && <LoadingRows rows={6} />}
        {ready && (
          <>
            <div>
              <p className="text-[15px] font-medium">{bad ? `${plural(bad, "thing", "things")} to fix.` : setup.mailbox ? "Nothing is broken." : "Nothing is broken, but nothing can send until a mailbox is connected."}</p>
              <p className="text-[13px] text-muted-foreground">
                {todo ? `${plural(todo, "optional thing", "optional things")} you could still set up.` : "Everything optional is set up too."}
                {setup.version ? ` OpenLeads ${setup.version}, running on this computer.` : ""}
              </p>
            </div>
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <Lines title="What OpenLeads is connected to" lines={connections} />
              <Lines title="Checking email addresses" lines={net} />
            </div>
          </>
        )}
      </Body>
    </>
  );
}
