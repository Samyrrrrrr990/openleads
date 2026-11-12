import { CheckIcon, ExternalLinkIcon, InboxIcon, ListChecksIcon, MailIcon, WebhookIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Body, ErrorNote, LoadingRows } from "~/components/app/bits";
import { BrandIcon } from "~/components/app/Mark";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { api } from "~/lib/api";
import { classic } from "~/lib/router";
import { PROVIDER_BRAND, PROVIDER_NAME, refreshSetup, saveSettings, type Setup, switchModel, useSetup } from "~/lib/setup";
import { toast } from "~/lib/toast";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";

const SECTION = sectionOf("settings");

interface Field {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  optional?: boolean;
}

interface Link {
  label: string;
  url: string;
}

/** "on" is in use or connected; "ready" needs one click; "off" needs something from you. */
type Status = "on" | "ready" | "off";

function Out({ link, className }: { link: Link; className?: string }) {
  return (
    <a href={link.url} target="_blank" rel="noreferrer noopener" className={cn("inline-flex items-center gap-1 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline max-md:h-10 max-md:px-1 max-md:text-sm", className)}>
      {link.label} <ExternalLinkIcon className="size-3" />
    </a>
  );
}

/**
 * One thing OpenLeads can connect to. Closed, it is a row: the service's own mark, its
 * name, where it stands, and one button. Open, it asks only for what that service
 * needs. The row stays put while it works, so a failure is shown right where you typed.
 */
function Connection({
  icon,
  title,
  note,
  status,
  statusLabel,
  fields = [],
  help,
  action = "Connect",
  onConnect,
  remove,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
  status: Status;
  statusLabel?: string;
  fields?: Field[];
  help?: Link;
  action?: string;
  /** Returns a sentence when it did not work. With fields, gets what was typed. */
  onConnect?: (values: Record<string, string>) => Promise<string | void>;
  /** A second, quieter action: disconnect, turn off, or remove a saved key. */
  remove?: { label: string; confirm: string; run: () => Promise<void> };
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [sure, setSure] = useState(false);
  const missing = fields.some((f) => !f.optional && !(values[f.key] ?? "").trim());
  const form = status === "off" && fields.length > 0;

  const connect = async () => {
    if (!onConnect) return;
    setBusy(true);
    setProblem("");
    try {
      const said = await onConnect(values);
      if (said) setProblem(said);
      else {
        setOpen(false);
        setValues({});
      }
    } catch (e) {
      setProblem((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <li className={cn("border-b border-border last:border-b-0", open && form && "bg-muted/60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
        {icon}
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-medium max-md:text-sm">{title}</span>
            {status === "on" && (
              <span className="flex items-center gap-1 rounded-full bg-success-surface px-1.5 py-px text-xs font-medium text-success-foreground">
                <CheckIcon className="size-3" /> {statusLabel ?? "Connected"}
              </span>
            )}
            {status === "ready" && <span className="rounded-full bg-primary-wash px-1.5 py-px text-xs font-medium text-primary-ink">{statusLabel ?? "Ready"}</span>}
            {status === "off" && <span className="rounded-full border border-border px-1.5 py-px text-xs text-muted-foreground">Not connected</span>}
          </div>
          <div className="text-[13px] leading-5 text-muted-foreground max-md:text-sm">{note}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 max-sm:w-full max-sm:justify-end">
          {children}
          {remove &&
            (sure ? (
              <Button
                size="sm"
                variant="destructive-outline"
                className="max-md:h-10"
                disabled={busy}
                autoFocus
                onBlur={() => setSure(false)}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await remove.run();
                  } catch (e) {
                    setProblem((e as Error).message);
                  }
                  setBusy(false);
                  setSure(false);
                }}
              >
                {remove.confirm}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="text-muted-foreground max-md:h-10" onClick={() => setSure(true)}>
                {remove.label}
              </Button>
            ))}
          {status === "ready" && onConnect && (
            <Button size="sm" className="max-md:h-10" disabled={busy} onClick={connect}>
              {busy && <Spinner />} {action}
            </Button>
          )}
          {form && (
            <Button size="sm" variant={open ? "ghost" : "outline"} className="max-md:h-10" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "Cancel" : action}
            </Button>
          )}
        </div>
      </div>
      {problem && !(open && form) && (
        <p role="alert" className="px-3.5 pb-3 text-[13px] leading-5 text-error-foreground max-md:text-sm sm:ps-[3.75rem]">
          {problem}
        </p>
      )}
      {open && form && (
        <form
          className="flex flex-col gap-2.5 px-3.5 pb-3.5 sm:ps-[3.75rem]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!missing && !busy) void connect();
          }}
        >
          {fields.map((f, i) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-[13px] text-muted-foreground">
                {f.label}
                {f.optional ? " (optional)" : ""}
              </span>
              <span className="rounded-lg border border-input bg-card shadow-xs/5 focus-within:border-ring">
                <Input
                  nativeInput
                  size="lg"
                  type={f.secret ? "password" : f.key === "smtp_user" ? "email" : "text"}
                  inputMode={f.key === "smtp_user" ? "email" : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus={i === 0}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </span>
            </label>
          ))}
          {problem && (
            <p role="alert" className="text-[13px] leading-5 text-error-foreground max-md:text-sm">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button size="sm" type="submit" className="max-md:h-10" disabled={busy || missing}>
              {busy && <Spinner />} {busy ? "Checking" : action}
            </Button>
            {help && <Out link={help} />}
          </div>
        </form>
      )}
    </li>
  );
}

function Group({ id, title, note, focus, children }: { id: string; title: string; note: string; focus?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  // A link from Today or Ask lands on the part it was about.
  useEffect(() => {
    if (focus === id) ref.current?.scrollIntoView({ block: "start" });
  }, [focus, id]);
  return (
    <section ref={ref} className="scroll-mt-6">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-0.5 max-w-[70ch] text-[13px] leading-5 text-muted-foreground">{note}</p>
      <ul className="mt-3 overflow-hidden rounded-xl border border-border bg-card">{children}</ul>
    </section>
  );
}

function PlainTile({ children }: { children: React.ReactNode }) {
  return <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground">{children}</span>;
}

// --- the model ----------------------------------------------------------------- //

interface Provider {
  key: string;
  title: string;
  note: string;
  kind: "subscription" | "key" | "local";
  /** The setting that holds its API key. */
  setting?: string;
  /** Where to get the key, or the app that has to be on this computer. */
  get: Link;
  /** Shown when the app isn't on this computer. */
  missing?: string;
}

const PROVIDERS: Provider[] = [
  { key: "claude", title: "Claude", note: "Uses your Claude subscription, through Claude Code on this computer", kind: "subscription", get: { label: "Get Claude Code", url: "https://claude.com/product/claude-code" }, missing: "Claude Code isn't installed or signed in" },
  { key: "codex", title: "ChatGPT", note: "Uses your ChatGPT subscription, through Codex on this computer", kind: "subscription", get: { label: "Get Codex", url: "https://developers.openai.com/codex/cli" }, missing: "Codex isn't installed or signed in" },
  { key: "anthropic", title: "Anthropic API", note: "Pay for what you use, with an API key", kind: "key", setting: "anthropic_api_key", get: { label: "Get a key", url: "https://console.anthropic.com/settings/keys" } },
  { key: "openai", title: "OpenAI API", note: "Pay for what you use, with an API key", kind: "key", setting: "openai_api_key", get: { label: "Get a key", url: "https://platform.openai.com/api-keys" } },
  { key: "gemini", title: "Google Gemini", note: "An API key from Google AI Studio", kind: "key", setting: "gemini_api_key", get: { label: "Get a key", url: "https://aistudio.google.com/apikey" } },
  { key: "openrouter", title: "OpenRouter", note: "One key for many models, some of them free", kind: "key", setting: "openrouter_api_key", get: { label: "Get a key", url: "https://openrouter.ai/keys" } },
  { key: "ollama", title: "Ollama", note: "A model that runs on this computer. Nothing leaves it", kind: "local", get: { label: "Get Ollama", url: "https://ollama.com/download" }, missing: "Ollama isn't running" },
];

/** A provider that wasn't found: where to get it, and a way to look again. */
function Missing({ p }: { p: Provider }) {
  const [state, setState] = useState<"" | "checking" | "none">("");
  return (
    <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {state === "none" && <span className="text-[13px] text-muted-foreground">Still not found</span>}
      <Out link={p.get} />
      <Button
        size="sm"
        variant="outline"
        className="max-md:h-10"
        disabled={state === "checking"}
        onClick={async () => {
          setState("checking");
          await refreshSetup();
          setState("none");
        }}
      >
        {state === "checking" && <Spinner />} Check again
      </Button>
    </span>
  );
}

function Models({ setup, focus }: { setup: Setup; focus?: string }) {
  const current = setup.ai.current?.provider;
  const use = (p: Provider) => async () => {
    const said = await switchModel(p.key);
    if (said) return `${p.title} didn't answer a test message, so nothing changed. Check that it is installed and signed in, then try again.`;
    toast(`${p.title} connected`);
  };
  return (
    <Group id="model" focus={focus} title="AI model" note="Reads your requests, writes drafts from the facts it found, sorts replies and sums up your morning. Keys stay on this computer, in a file only you can read.">
      <Connection
        icon={
          <PlainTile>
            <ListChecksIcon className="size-4" />
          </PlainTile>
        }
        title="Built-in rules"
        note="No model needed. Reads plain requests and writes from your templates"
        status={current ? "ready" : "on"}
        statusLabel={current ? "Always available" : "In use"}
        action="Use the rules"
        onConnect={
          current
            ? async () => {
                const said = await switchModel("off");
                if (said) return said;
                toast("Using the built-in rules");
              }
            : undefined
        }
      />
      {setup.ai.problem && (
        <li className="border-b border-border bg-warning-surface px-3.5 py-2.5 text-[13px] leading-5 text-warning-foreground max-md:text-sm">
          The model you chose isn't reachable right now, so the built-in rules are doing the work. Pick it again below, or choose another.
        </li>
      )}
      {current && !PROVIDERS.some((p) => p.key === current) && (
        <Connection
          icon={<BrandIcon name="" label={PROVIDER_NAME[current] ?? current} />}
          title={PROVIDER_NAME[current] ?? "Your own server"}
          note={setup.ai.current?.model ? `Using ${setup.ai.current.model}` : "Set up in More model settings"}
          status="on"
          statusLabel="In use"
          remove={{ label: "Stop using", confirm: "Yes, stop using it", run: async () => void (await switchModel("off")) }}
        />
      )}
      {PROVIDERS.map((p) => {
        const detected = setup.ai.detected.some((d) => d.provider === p.key);
        const hasKey = p.setting ? !!setup.settings[p.setting]?.is_set : false;
        const on = current === p.key;
        const ready = !on && (p.kind === "key" ? hasKey : detected);
        const removeKey = p.setting
          ? {
              label: "Remove key",
              confirm: "Yes, remove the key",
              run: async () => {
                if (on) await switchModel("off");
                await saveSettings({ [p.setting!]: "" });
                toast(`${p.title} key removed`);
              },
            }
          : undefined;
        return (
          <Connection
            key={p.key}
            icon={<BrandIcon name={PROVIDER_BRAND[p.key]} label={p.title} />}
            title={p.title}
            note={on && setup.ai.current?.model ? `Using ${setup.ai.current.model}` : p.kind !== "key" && !detected && !on ? (p.missing ?? p.note) : p.note}
            status={on ? "on" : ready ? "ready" : "off"}
            statusLabel={on ? "In use" : p.kind === "key" ? "Key saved" : "Found on this computer"}
            action={ready ? `Use ${p.title}` : "Connect"}
            help={p.get}
            fields={p.kind === "key" ? [{ key: p.setting!, label: `${p.title} key`, secret: true }] : []}
            remove={on || ready ? removeKey : undefined}
            onConnect={
              ready
                ? use(p)
                : p.kind === "key"
                  ? async (v) => {
                      const errors = await saveSettings({ [p.setting!]: v[p.setting!].trim() });
                      if (errors[p.setting!]) return errors[p.setting!];
                      const said = await switchModel(p.key);
                      if (said) {
                        // Only a key the provider turned down is thrown away. If the provider
                        // was busy or unreachable, the key is kept to try again.
                        if (/401|403|unauthor|forbidden|invalid|api key/i.test(said)) {
                          await saveSettings({ [p.setting!]: "" });
                          return `${p.title} didn't accept that key, so it wasn't saved. Check it and paste it again.`;
                        }
                        return `${p.title} didn't answer just now. Your key is saved; press Use ${p.title} in a minute.`;
                      }
                      toast(`${p.title} connected`);
                    }
                  : undefined
            }
          >
            {p.kind !== "key" && !detected && !on && <Missing p={p} />}
          </Connection>
        );
      })}
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-[13px] text-muted-foreground">
        <span className="min-w-0 flex-1 basis-56">Your own server, a specific model, or the tone drafts are written in</span>
        <a className="shrink-0 font-medium text-foreground hover:underline max-md:inline-flex max-md:h-10 max-md:items-center" href={classic("settings", "settings/ai")}>
          More model settings
        </a>
      </li>
    </Group>
  );
}

// --- the mailbox --------------------------------------------------------------- //

interface Preset {
  host: string;
  port: number;
  imap: string;
  help: string;
}

const MAIL = [
  { key: "gmail", also: ["workspace"], title: "Gmail", note: "Gmail and Google Workspace addresses", brand: "gmail" },
  { key: "outlook", also: ["office365"], title: "Outlook", note: "Outlook.com and Microsoft 365 addresses", brand: "microsoft" },
  { key: "zoho", also: [], title: "Zoho Mail", note: "Zoho addresses", brand: "zoho" },
  { key: "custom", also: [], title: "Another provider", note: "Any mailbox you can reach with a server name and a password", brand: "" },
];

function Mailbox({ setup, focus }: { setup: Setup; focus?: string }) {
  const presets = useApi<{ presets: Record<string, Preset> }>("/api/providers").data?.presets ?? {};
  const provider = String(setup.settings.smtp_provider?.value ?? "custom");
  const connected = MAIL.find((m) => m.key === provider || m.also.includes(provider)) ?? MAIL[MAIL.length - 1];

  const mark = (m: (typeof MAIL)[number]) =>
    m.brand ? (
      <BrandIcon name={m.brand} label={m.title} />
    ) : (
      <PlainTile>
        <MailIcon className="size-4" />
      </PlainTile>
    );

  // The login is tried first; an address that doesn't log in is never saved.
  const connect = (m: (typeof MAIL)[number]) => async (v: Record<string, string>) => {
    const preset = presets[m.key];
    const custom = m.key === "custom";
    const host = custom ? (v.smtp_host ?? "").trim() : (preset?.host ?? "");
    const port = custom ? Number(v.smtp_port) || 465 : (preset?.port ?? 465);
    const r = await api.post<{ ok: boolean; detail: string }>("/api/mailbox/test", { provider: m.key, host, port, user: v.smtp_user.trim(), password: v.smtp_pass });
    if (!r.ok) {
      return custom
        ? /auth/i.test(r.detail)
          ? "The server was reached, but that address and password didn't log in. Nothing was saved."
          : `Couldn't reach ${host || "that server"} on port ${port}. Check the server name and port. Nothing was saved.`
        : /auth/i.test(r.detail)
          ? `That password didn't work, so nothing was saved. ${m.title} needs an app password, not the one you sign in with.`
          : `Couldn't reach ${m.title} just now, so nothing was saved. Check your internet connection and try again.`;
    }
    const errors = await saveSettings({
      smtp_provider: m.key,
      smtp_host: host,
      smtp_port: port,
      smtp_user: v.smtp_user.trim(),
      smtp_pass: v.smtp_pass,
      imap_host: custom ? (v.imap_host ?? "").trim() : (preset?.imap ?? ""),
    });
    const first = Object.values(errors)[0];
    if (first) return first;
    toast(`${m.title} connected`);
  };

  if (setup.mailbox) {
    return (
      <Group id="mailbox" focus={focus} title="Mailbox" note="Approved emails go out from your own address, and replies come back to Today.">
        <Connection
          icon={mark(connected)}
          title={connected.title}
          note="Sends the emails you approve, from your address"
          status="on"
          remove={{
            label: "Disconnect",
            confirm: "Yes, disconnect",
            run: async () => {
              await saveSettings({ smtp_user: "", smtp_pass: "", imap_user: "", imap_pass: "", imap_host: "" });
              toast("Mailbox disconnected");
            },
          }}
        />
        <Connection
          icon={
            <PlainTile>
              <InboxIcon className="size-4" />
            </PlainTile>
          }
          title="Replies"
          note={setup.inbox ? "Read from the same mailbox and shown on Today" : "Not being read yet. Add the incoming mail server to see replies on Today"}
          status={setup.inbox ? "on" : "off"}
          statusLabel="Reading"
          action="Read replies"
          fields={[{ key: "imap_host", label: "Incoming mail server", placeholder: "imap.yourhost.com" }]}
          onConnect={async (v) => {
            const errors = await saveSettings({ imap_host: v.imap_host.trim() });
            if (errors.imap_host) return errors.imap_host;
            toast("Replies will show on Today");
          }}
        />
        <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-[13px] text-muted-foreground">
          <span className="min-w-0 flex-1 basis-56">Daily limit, warm-up pace, and the name people see</span>
          <a className="shrink-0 font-medium text-foreground hover:underline max-md:inline-flex max-md:h-10 max-md:items-center" href={classic("settings", "settings/sending")}>
            Sending settings
          </a>
        </li>
      </Group>
    );
  }
  return (
    <Group id="mailbox" focus={focus} title="Mailbox" note="Pick where your email lives. OpenLeads sends from your own address and nothing sends without your approval. Your password stays on this computer, in a file only you can read.">
      {MAIL.map((m) => {
        const url = /https?:\/\/[^\s)]+/.exec(presets[m.key]?.help ?? "")?.[0];
        const custom = m.key === "custom";
        return (
          <Connection
            key={m.key}
            icon={mark(m)}
            title={m.title}
            note={m.note}
            status="off"
            help={url ? { label: "How to make an app password", url } : undefined}
            fields={[
              { key: "smtp_user", label: "Email address", placeholder: "you@yourcompany.com" },
              { key: "smtp_pass", label: custom ? "Password" : "App password (not the one you sign in with)", secret: true },
              ...(custom
                ? [
                    { key: "smtp_host", label: "Outgoing mail server", placeholder: "smtp.yourhost.com" },
                    { key: "smtp_port", label: "Port", placeholder: "465", optional: true },
                    { key: "imap_host", label: "Incoming mail server, to read replies", placeholder: "imap.yourhost.com", optional: true },
                  ]
                : []),
            ]}
            onConnect={connect(m)}
          />
        );
      })}
    </Group>
  );
}

// --- where people can go, and where searches reach ---------------------------------- //

interface Tool {
  brand: string;
  title: string;
  note: string;
  fields: Field[];
  help: Link;
  /** Pull an ID out of a pasted link, so nobody has to find it by hand. */
  tidy?: (values: Record<string, string>) => Record<string, string>;
}

const EXPORTS: Tool[] = [
  {
    brand: "hubspot",
    title: "HubSpot",
    note: "Send people to your CRM as contacts",
    fields: [{ key: "hubspot_token", label: "Access token of a private app", secret: true }],
    help: { label: "Where to find it", url: "https://developers.hubspot.com/docs/guides/apps/private-apps/overview" },
  },
  {
    brand: "notion",
    title: "Notion",
    note: "Add people to a Notion database",
    fields: [
      { key: "notion_token", label: "Integration secret", secret: true },
      { key: "notion_database_id", label: "Link to the database", placeholder: "Paste the page link from Notion" },
    ],
    help: { label: "Create an integration", url: "https://www.notion.so/profile/integrations" },
    tidy: (v) => ({ ...v, notion_database_id: /[0-9a-f]{32}/i.exec((v.notion_database_id ?? "").replace(/-/g, ""))?.[0] ?? (v.notion_database_id ?? "").trim() }),
  },
  {
    brand: "airtable",
    title: "Airtable",
    note: "Add people to a table called Leads in a base",
    fields: [
      { key: "airtable_token", label: "Personal access token", secret: true },
      { key: "airtable_base", label: "Link to the base", placeholder: "Paste the link from your browser" },
    ],
    help: { label: "Create a token", url: "https://airtable.com/create/tokens" },
    tidy: (v) => ({ ...v, airtable_base: /app[A-Za-z0-9]{14}/.exec(v.airtable_base ?? "")?.[0] ?? (v.airtable_base ?? "").trim() }),
  },
  {
    brand: "webhook",
    title: "Webhook",
    note: "Post new people and replies to Zapier, Make, n8n or your own address",
    fields: [{ key: "webhook_url", label: "Web address to post to", placeholder: "https://" }],
    help: { label: "How webhooks work", url: "https://zapier.com/features/webhooks" },
  },
];

const SEARCH: Tool[] = [
  {
    brand: "github",
    title: "GitHub",
    note: "A token lets developer searches run longer",
    fields: [{ key: "github_token", label: "Personal access token (no permissions needed)", secret: true }],
    help: { label: "Create a token", url: "https://github.com/settings/tokens" },
  },
];

function Tools({ id, title, note, tools, setup, focus }: { id: string; title: string; note: string; tools: Tool[]; setup: Setup; focus?: string }) {
  return (
    <Group id={id} focus={focus} title={title} note={note}>
      {tools.map((x) => {
        const on = !!setup.settings[x.fields[0].key]?.is_set;
        return (
          <Connection
            key={x.brand}
            icon={
              x.brand === "webhook" ? (
                <PlainTile>
                  <WebhookIcon className="size-4" />
                </PlainTile>
              ) : (
                <BrandIcon name={x.brand} label={x.title} />
              )
            }
            title={x.title}
            note={x.note}
            status={on ? "on" : "off"}
            statusLabel="Saved"
            action="Add"
            fields={x.fields}
            help={x.help}
            onConnect={async (typed) => {
              const v = x.tidy ? x.tidy(typed) : typed;
              const errors = await saveSettings(Object.fromEntries(x.fields.map((f) => [f.key, (v[f.key] ?? "").trim()])));
              const first = Object.values(errors)[0];
              if (first) return first;
              toast(`${x.title} saved. It's used the next time you export`);
            }}
            remove={
              on
                ? {
                    label: "Remove",
                    confirm: "Yes, remove",
                    run: async () => {
                      await saveSettings(Object.fromEntries(x.fields.map((f) => [f.key, ""])));
                      toast(`${x.title} removed`);
                    },
                  }
                : undefined
            }
          />
        );
      })}
    </Group>
  );
}

export function Connections({ focus }: { focus?: string }) {
  const setup = useSetup();
  return (
    <>
      <PageHeader section={SECTION} page="connections" />
      <Body>
        {setup.error && <ErrorNote message={setup.error} onRetry={() => void refreshSetup()} />}
        {!setup.loaded && <LoadingRows rows={6} />}
        {setup.loaded && !setup.error && (
          <div className="grid items-start gap-x-6 gap-y-8 lg:grid-cols-2">
            <Models setup={setup} focus={focus} />
            <div className="flex flex-col gap-8">
              <Mailbox setup={setup} focus={focus} />
              <Tools id="exports" title="Where people can go" note="Optional. Used only when you export, or when a workflow says so." tools={EXPORTS} setup={setup} />
              <Tools id="search" focus={focus} title="Search" note="Optional. OpenLeads searches free public sources without any keys." tools={SEARCH} setup={setup} />
            </div>
          </div>
        )}
      </Body>
    </>
  );
}
