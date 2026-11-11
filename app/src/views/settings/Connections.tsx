import { CheckIcon, ExternalLinkIcon, MailIcon, RefreshCwIcon, WebhookIcon } from "lucide-react";
import { useState } from "react";

import { Body, ErrorNote, LoadingRows } from "~/components/app/bits";
import { BrandIcon } from "~/components/app/Mark";
import { PageHeader } from "~/components/shell/PageHeader";
import { sectionOf } from "~/components/shell/sections";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { api } from "~/lib/api";
import { classic } from "~/lib/router";
import { PROVIDER_BRAND, refreshSetup, saveSettings, type Setup, useSetup } from "~/lib/setup";
import { fail, toast } from "~/lib/toast";
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

type Status = "on" | "ready" | "off";

/**
 * One thing OpenLeads can connect to. Closed, it is a row: the service's own mark, its
 * name, and where it stands. Open, it asks only for what that service needs.
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
  onDisconnect,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
  status: Status;
  statusLabel?: string;
  fields?: Field[];
  help?: { label: string; url: string };
  action?: string;
  /** Returns a sentence when it did not work. */
  onConnect?: (values: Record<string, string>) => Promise<string | void>;
  onDisconnect?: () => Promise<void>;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [sure, setSure] = useState(false);
  const missing = fields.some((f) => !f.optional && !(values[f.key] ?? "").trim());

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
    <li className={cn("border-b border-border last:border-b-0", open && "bg-muted/60")}>
      <div className="flex items-center gap-3 px-3.5 py-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{note}</div>
        </div>
        {status === "on" ? (
          <>
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success-foreground">
              <CheckIcon className="size-3.5" /> {statusLabel ?? "Connected"}
            </span>
            {onDisconnect &&
              (sure ? (
                <Button
                  size="xs"
                  variant="destructive-outline"
                  disabled={busy}
                  onBlur={() => setSure(false)}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onDisconnect();
                    } catch (e) {
                      fail(e);
                    }
                    setBusy(false);
                    setSure(false);
                  }}
                >
                  Yes, disconnect
                </Button>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => setSure(true)}>
                  Disconnect
                </Button>
              ))}
          </>
        ) : fields.length ? (
          <Button size="xs" variant={open ? "ghost" : "outline"} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Cancel" : action}
          </Button>
        ) : onConnect ? (
          <Button size="xs" variant="outline" disabled={busy} onClick={connect}>
            {busy && <Spinner />} {action}
          </Button>
        ) : (
          children
        )}
      </div>
      {!open && problem && <p className="px-3.5 pb-3 ps-[3.75rem] text-xs leading-5 text-error-foreground">{problem}</p>}
      {open && (
        <form
          className="flex flex-col gap-2.5 px-3.5 pb-3.5 ps-[3.75rem] max-sm:ps-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!missing) void connect();
          }}
        >
          {fields.map((f, i) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {f.label}
                {f.optional ? " (optional)" : ""}
              </span>
              <span className="rounded-lg border border-input bg-card shadow-xs/5 focus-within:border-ring">
                <Input
                  nativeInput
                  type={f.secret ? "password" : "text"}
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
          {problem && <p className="text-xs leading-5 text-error-foreground">{problem}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" type="submit" disabled={busy || missing}>
              {busy && <Spinner />} {busy ? "Checking" : action}
            </Button>
            {help && (
              <a href={help.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                {help.label} <ExternalLinkIcon className="size-3" />
              </a>
            )}
            <span className="ms-auto text-xs text-muted-foreground max-sm:hidden">Kept on this computer, in a file only you can read</span>
          </div>
        </form>
      )}
    </li>
  );
}

function Group({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{note}</p>
      <ul className="mt-3 overflow-hidden rounded-xl border border-border bg-card">{children}</ul>
    </section>
  );
}

// --- the model ----------------------------------------------------------------- //

interface Provider {
  key: string;
  title: string;
  note: string;
  kind: "subscription" | "key" | "local";
  /** The setting that holds its API key. */
  setting?: string;
  help?: { label: string; url: string };
  missing?: string;
}

const PROVIDERS: Provider[] = [
  { key: "claude", title: "Claude", note: "Your Claude subscription, through the Claude app on this computer", kind: "subscription", missing: "Install Claude Code and sign in" },
  { key: "codex", title: "ChatGPT", note: "Your ChatGPT subscription, through Codex on this computer", kind: "subscription", missing: "Install Codex and sign in" },
  { key: "anthropic", title: "Anthropic API", note: "Pay as you go with an API key", kind: "key", setting: "anthropic_api_key", help: { label: "Get a key", url: "https://console.anthropic.com/settings/keys" } },
  { key: "openai", title: "OpenAI API", note: "Pay as you go with an API key", kind: "key", setting: "openai_api_key", help: { label: "Get a key", url: "https://platform.openai.com/api-keys" } },
  { key: "gemini", title: "Google Gemini", note: "An API key from Google AI Studio", kind: "key", setting: "gemini_api_key", help: { label: "Get a key", url: "https://aistudio.google.com/apikey" } },
  { key: "openrouter", title: "OpenRouter", note: "One key for many models, some of them free", kind: "key", setting: "openrouter_api_key", help: { label: "Get a key", url: "https://openrouter.ai/keys" } },
  { key: "ollama", title: "Ollama", note: "A model that runs on this computer. Nothing leaves it", kind: "local", missing: "Start Ollama" },
];

async function switchModel(provider: string): Promise<string | void> {
  const r = await api.post<{ ok: boolean; detail?: string }>("/api/ai/use", { provider });
  await refreshSetup();
  if (!r.ok) return r.detail || "It didn't answer a test message.";
  toast(provider === "off" ? "Using the built-in rules" : "Model connected");
}

function Models({ setup }: { setup: Setup }) {
  const current = setup.ai.current?.provider;
  const [checking, setChecking] = useState(false);
  return (
    <Group title="AI model" note="Reads your requests, writes drafts from the facts it found, sorts replies and sums up your morning. Optional: the built-in rules work without one.">
      {setup.ai.problem && (
        <li className="border-b border-border bg-warning-surface px-3.5 py-2.5 text-[13px] leading-5 text-warning-foreground">{setup.ai.problem}</li>
      )}
      {PROVIDERS.map((p) => {
        const detected = setup.ai.detected.some((d) => d.provider === p.key);
        const hasKey = p.setting ? !!setup.settings[p.setting]?.is_set : false;
        const on = current === p.key;
        const icon = <BrandIcon name={PROVIDER_BRAND[p.key]} label={p.title} />;
        if (on) {
          return (
            <Connection key={p.key} icon={icon} title={p.title} note={setup.ai.current?.model ? `Using ${setup.ai.current.model}` : p.note} status="on" statusLabel="In use" onDisconnect={async () => void (await switchModel("off"))} />
          );
        }
        if (p.kind === "key" && !hasKey) {
          return (
            <Connection
              key={p.key}
              icon={icon}
              title={p.title}
              note={p.note}
              status="off"
              help={p.help}
              fields={[{ key: p.setting!, label: "API key", secret: true }]}
              onConnect={async (v) => {
                const errors = await saveSettings({ [p.setting!]: v[p.setting!].trim() });
                if (errors[p.setting!]) return errors[p.setting!];
                return switchModel(p.key);
              }}
            />
          );
        }
        if (detected || hasKey) {
          return <Connection key={p.key} icon={icon} title={p.title} note={detected && p.kind !== "key" ? `${p.note.split(".")[0]}. Found and ready` : "Key saved"} status="ready" action="Use this" onConnect={() => switchModel(p.key)} />;
        }
        return (
          <Connection key={p.key} icon={icon} title={p.title} note={p.note} status="off">
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {p.missing}
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Check again for ${p.title}`}
                disabled={checking}
                onClick={async () => {
                  setChecking(true);
                  await refreshSetup();
                  setChecking(false);
                }}
              >
                <RefreshCwIcon className={cn(checking && "animate-spin")} />
              </Button>
            </span>
          </Connection>
        );
      })}
      <li className="flex items-center gap-3 px-3.5 py-2.5 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1">Another endpoint that speaks the OpenAI format, a specific model name, or the writing tone</span>
        <a className="shrink-0 font-medium text-foreground hover:underline" href={classic("settings", "settings/ai")}>
          Advanced
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
  { key: "gmail", title: "Gmail", brand: "gmail" },
  { key: "workspace", title: "Google Workspace", brand: "google" },
  { key: "outlook", title: "Outlook", brand: "microsoft" },
  { key: "office365", title: "Microsoft 365", brand: "microsoft" },
  { key: "zoho", title: "Zoho Mail", brand: "zoho" },
  { key: "custom", title: "Another provider", brand: "" },
];

function Mailbox({ setup }: { setup: Setup }) {
  const presets = useApi<{ presets: Record<string, Preset> }>("/api/providers").data?.presets ?? {};
  const provider = String(setup.settings.smtp_provider?.value ?? "custom");
  const connected = MAIL.find((m) => m.key === provider) ?? MAIL[MAIL.length - 1];

  const mark = (m: (typeof MAIL)[number]) =>
    m.brand ? (
      <BrandIcon name={m.brand} label={m.title} />
    ) : (
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
        <MailIcon className="size-4" />
      </span>
    );

  const connect = (m: (typeof MAIL)[number]) => async (v: Record<string, string>) => {
    const preset = presets[m.key];
    const host = m.key === "custom" ? v.smtp_host.trim() : (preset?.host ?? "");
    const errors = await saveSettings({
      smtp_provider: m.key,
      smtp_host: host,
      smtp_port: m.key === "custom" ? Number(v.smtp_port) || 465 : (preset?.port ?? 465),
      smtp_user: v.smtp_user.trim(),
      smtp_pass: v.smtp_pass,
      imap_host: m.key === "custom" ? (v.imap_host ?? "").trim() : (preset?.imap ?? ""),
    });
    const first = Object.values(errors)[0];
    if (first) return first;
    const r = await api.post<{ ok: boolean; detail: string }>("/api/mailbox/test", {});
    if (!r.ok) {
      // A login that doesn't work is worse than none: nothing is left half-connected.
      await saveSettings({ smtp_user: "", smtp_pass: "" });
      return `That didn't log in. ${r.detail}`;
    }
    toast(`${m.title} connected`);
  };

  if (setup.mailbox) {
    return (
      <Group title="Mailbox" note="Approved emails go out from your own address, and replies come back to Today.">
        <Connection
          icon={mark(connected)}
          title={connected.title}
          note={setup.inbox ? "Sends your emails and reads replies" : "Sends your emails. Replies aren't being read"}
          status="on"
          onDisconnect={async () => {
            await saveSettings({ smtp_user: "", smtp_pass: "", imap_user: "", imap_pass: "" });
            toast("Mailbox disconnected");
          }}
        />
        <li className="flex items-center gap-3 px-3.5 py-2.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">Daily limit, warm-up pace, and the name people see</span>
          <a className="shrink-0 font-medium text-foreground hover:underline" href={classic("settings", "settings/sending")}>
            Sending settings
          </a>
        </li>
      </Group>
    );
  }
  return (
    <Group title="Mailbox" note="Pick where your email lives. OpenLeads sends from your own address, never from a shared one, and nothing sends without your approval.">
      {MAIL.map((m) => {
        const preset = presets[m.key];
        const url = /https?:\/\/\S+/.exec(preset?.help ?? "")?.[0];
        const custom = m.key === "custom";
        return (
          <Connection
            key={m.key}
            icon={mark(m)}
            title={m.title}
            note={custom ? "Any mailbox with SMTP, and IMAP for replies" : "Your address and an app password"}
            status="off"
            help={url ? { label: "How to make an app password", url } : undefined}
            fields={[
              { key: "smtp_user", label: "Email address", placeholder: "you@yourcompany.com" },
              { key: "smtp_pass", label: custom ? "Password" : "App password, not your normal password", secret: true },
              ...(custom
                ? [
                    { key: "smtp_host", label: "Outgoing server (SMTP)", placeholder: "smtp.yourhost.com" },
                    { key: "smtp_port", label: "Port", placeholder: "465", optional: true },
                    { key: "imap_host", label: "Incoming server (IMAP), to read replies", placeholder: "imap.yourhost.com", optional: true },
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

// --- where leads can go --------------------------------------------------------- //

interface Export {
  brand: string;
  title: string;
  note: string;
  fields: Field[];
  help?: { label: string; url: string };
}

const EXPORTS: Export[] = [
  { brand: "hubspot", title: "HubSpot", note: "Send people to your CRM as contacts", fields: [{ key: "hubspot_token", label: "Private app token", secret: true }] },
  {
    brand: "notion",
    title: "Notion",
    note: "Add people to a Notion database",
    fields: [
      { key: "notion_token", label: "Integration token", secret: true },
      { key: "notion_database_id", label: "Database ID" },
    ],
  },
  {
    brand: "airtable",
    title: "Airtable",
    note: "Add people to a table in a base",
    fields: [
      { key: "airtable_token", label: "Personal access token", secret: true },
      { key: "airtable_base", label: "Base ID", placeholder: "appXXXXXXXXXXXXXX" },
    ],
  },
  { brand: "github", title: "GitHub", note: "A token lets developer searches go further before hitting limits", fields: [{ key: "github_token", label: "Personal access token", secret: true }] },
  { brand: "webhook", title: "Webhook", note: "Post new people and replies to Zapier, Make, n8n or your own URL", fields: [{ key: "webhook_url", label: "URL", placeholder: "https://" }] },
];

function Exports({ setup }: { setup: Setup }) {
  return (
    <Group title="Other tools" note="Optional places for people and replies to go. Each one is used only when you export or a workflow says so.">
      {EXPORTS.map((x) => {
        const on = !!setup.settings[x.fields[0].key]?.is_set;
        return (
          <Connection
            key={x.brand}
            icon={
              x.brand === "webhook" ? (
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
                  <WebhookIcon className="size-4" />
                </span>
              ) : (
                <BrandIcon name={x.brand} label={x.title} />
              )
            }
            title={x.title}
            note={x.note}
            status={on ? "on" : "off"}
            fields={x.fields}
            onConnect={async (v) => {
              const errors = await saveSettings(Object.fromEntries(x.fields.map((f) => [f.key, (v[f.key] ?? "").trim()])));
              const first = Object.values(errors)[0];
              if (first) return first;
              toast(`${x.title} connected`);
            }}
            onDisconnect={async () => {
              await saveSettings(Object.fromEntries(x.fields.map((f) => [f.key, ""])));
              toast(`${x.title} disconnected`);
            }}
          />
        );
      })}
    </Group>
  );
}

export function Connections() {
  const setup = useSetup();
  return (
    <>
      <PageHeader section={SECTION} page="connections" />
      <Body className="gap-8">
        {setup.error && <ErrorNote message={setup.error} onRetry={() => void refreshSetup()} />}
        {!setup.loaded && <LoadingRows rows={6} />}
        {setup.loaded && !setup.error && (
          <>
            <Models setup={setup} />
            <Mailbox setup={setup} />
            <Exports setup={setup} />
          </>
        )}
      </Body>
    </>
  );
}
