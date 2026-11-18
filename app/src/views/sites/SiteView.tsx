import {
  ArrowUpIcon,
  CheckIcon,
  CircleAlertIcon,
  CornerDownRightIcon,
  ExternalLinkIcon,
  InfoIcon,
  LayoutTemplateIcon,
  ListIcon,
  MonitorIcon,
  PencilIcon,
  RotateCwIcon,
  SendIcon,
  SmartphoneIcon,
  SparklesIcon,
  Undo2Icon,
  UploadCloudIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { ErrorNote } from "~/components/app/bits";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { api } from "~/lib/api";
import { href, navigate } from "~/lib/router";
import { fail, toast } from "~/lib/toast";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";

import { type Engine, type LeadBrief, type Project, NoModel, ask, buildForLead, clearJob, loadEngine, logLines, rewriteCopy, useCopyJob } from "./engine";
import { type Site, UseModel, short, sitesChanged, studio, useModel } from "./Sites";

interface LogLine {
  text: string;
  kind: string;
  ts: number;
}

interface SiteDetail extends Omit<Site, "sent"> {
  log: LogLine[];
  sent: { to: string; ts: number; url: string } | null;
}

interface Turn {
  id: number;
  text: string;
  status: "working" | "done" | "error";
  changes?: string[];
  skipped?: { what: string; reason: string }[];
  by?: "rules" | "model";
  error?: string;
  noModel?: boolean;
  undone?: boolean;
}

const KIND_ICON: Record<string, typeof InfoIcon> = {
  build: LayoutTemplateIcon,
  model: SparklesIcon,
  edit: PencilIcon,
  sent: SendIcon,
  publish: UploadCloudIcon,
  undo: Undo2Icon,
  info: InfoIcon,
};

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function SiteView({ id, netlify, baseUrl }: { id: string; netlify: boolean; baseUrl: string }) {
  const model = useModel();
  const meta = useApi<SiteDetail>(`/api/sites/get?id=${encodeURIComponent(id)}`);
  const site = meta.data;
  const [engine, setEngine] = useState<Engine | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState("");
  const [past, setPast] = useState<{ label: string; project: Project }[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [pane, setPane] = useState<"preview" | "thread">("preview");
  const [sending, setSending] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const job = useCopyJob(id);
  const endRef = useRef<HTMLDivElement>(null);
  const turnSeq = useRef(0);
  const jobBefore = useRef<Project | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const e = await loadEngine(model.version);
        const p = await e.load(id);
        if (!live) return;
        setEngine(e);
        if (!p) setLoadError("This site's project couldn't be read.");
        setProject(p);
      } catch (err) {
        if (live) setLoadError((err as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [id, model.version]);

  // Claude's pass over the copy, started by the build (or by the button below).
  useEffect(() => {
    if (job?.status === "running" && !jobBefore.current) jobBefore.current = project;
    if (job?.status === "done" && job.project) {
      const before = jobBefore.current;
      if (before) setPast((p) => [...p, { label: "Claude's copy", project: before }]);
      jobBefore.current = null;
      setProject(job.project);
      setVersion((v) => v + 1);
      clearJob(id);
      void meta.reload();
      sitesChanged();
    } else if (job && (job.status === "error" || job.status === "no_model")) {
      jobBefore.current = null;
    }
  }, [job, id, meta, project]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, site?.log.length, job?.status]);

  const brief = useCallback(async () => {
    if (!site?.lead_email) throw new Error("This site isn't for a lead.");
    return api.get<LeadBrief>(`/api/sites/lead?email=${encodeURIComponent(site.lead_email)}`);
  }, [site?.lead_email]);

  const saved = useCallback(
    async (next: Project, label: string, before: Project) => {
      if (!engine) return;
      await engine.save(next, null);
      setPast((p) => [...p.slice(-29), { label, project: before }]);
      setProject(next);
      setVersion((v) => v + 1);
      sitesChanged();
    },
    [engine],
  );

  const send = async (text: string) => {
    if (!engine || !project || busy) return;
    const tid = ++turnSeq.current;
    setTurns((t) => [...t, { id: tid, text, status: "working" }]);
    setBusy(true);
    const update = (patch: Partial<Turn>) => setTurns((t) => t.map((x) => (x.id === tid ? { ...x, ...patch } : x)));
    try {
      const out = await engine.proposeChange(project, text, model.ready ? ask : null);
      if (out.changes.length === 0) {
        update({ status: "error", error: "That didn't change anything. Try naming the section or the words." });
      } else {
        await saved(out.project, text, project);
        update({ status: "done", changes: out.changes, skipped: out.skipped, by: out.by });
        await logLines(id, [{ text: `${out.by === "model" ? "Claude" : "Studio"}: ${text} (${out.changes.length} ${out.changes.length === 1 ? "change" : "changes"})`, kind: "edit" }]);
        void meta.reload();
      }
    } catch (e) {
      const noModel = e instanceof NoModel || (!model.ready && !(e instanceof NoModel));
      update({
        status: "error",
        noModel,
        error: noModel ? "Studio's built-in rules didn't understand that one. A model can make any change you describe." : (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    const last = past[past.length - 1];
    if (!engine || !last || busy) return;
    await engine.save(last.project, null);
    setPast((p) => p.slice(0, -1));
    setProject(last.project);
    setVersion((v) => v + 1);
    setTurns((t) => {
      const i = [...t].reverse().findIndex((x) => x.status === "done" && !x.undone && x.text === last.label);
      if (i < 0) return t;
      const at = t.length - 1 - i;
      return t.map((x, j) => (j === at ? { ...x, undone: true } : x));
    });
    await logLines(id, [{ text: `Undid ${last.label}`, kind: "undo" }]);
    void meta.reload();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input,textarea,[contenteditable=true]");
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const rewrite = async () => {
    if (!engine || !project) return;
    try {
      const b = await brief();
      jobBefore.current = project;
      void rewriteCopy(engine, id, project, b);
    } catch (e) {
      fail(e);
    }
  };

  const switchTemplate = async (starterId: string) => {
    if (!engine || !project || busy) return;
    setBusy(true);
    try {
      const b = await brief();
      const before = project;
      const { project: next } = await buildForLead(engine, b, starterId, id);
      setPast((p) => [...p, { label: "the template switch", project: before }]);
      setProject(next);
      setVersion((v) => v + 1);
      void meta.reload();
      sitesChanged();
      if (model.ready) {
        jobBefore.current = null;
        void rewriteCopy(engine, id, next, b);
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const out = await api.post<{ folder: string; url: string; deployed: boolean }>("/api/sites/publish", { id });
      toast(out.deployed ? `Live at ${out.url}` : out.url ? `Exported. Link: ${out.url}` : `Exported to ${out.folder}`);
      void meta.reload();
      sitesChanged();
    } catch (e) {
      fail(e);
    } finally {
      setPublishing(false);
    }
  };

  if (meta.error) {
    return (
      <div className="flex-1 p-6">
        <ErrorNote message={meta.error} onRetry={() => void meta.reload()} />
      </div>
    );
  }

  const running = job?.status === "running";
  const modelLog = (site?.log ?? []).some((l) => l.kind === "model");
  const templates = engine?.templates() ?? [];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4 max-md:px-3">
        <Button size="icon-sm" variant="ghost" className="md:hidden" aria-label="All sites" onClick={() => navigate("sites")}>
          <ListIcon />
        </Button>
        <h1 className="min-w-0 truncate text-sm font-semibold">{site ? site.company || site.name : "Site"}</h1>
        {site?.lead_email && (
          <a className="shrink-0 truncate text-xs text-muted-foreground hover:underline max-lg:hidden" href={href("people", "people", site.lead_email)}>
            {site.lead_email}
          </a>
        )}
        {site && (site.sent ? <Badge variant="success">Sent</Badge> : site.url ? <Badge variant="info">Live</Badge> : <Badge variant="secondary">Draft</Badge>)}

        <div className="ms-auto flex shrink-0 items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={past.length ? `Undo ${past[past.length - 1]!.label}` : "Nothing to undo"}
            title={past.length ? `Undo ${past[past.length - 1]!.label} (${MOD}Z)` : "Nothing to undo"}
            disabled={!past.length || busy}
            onClick={() => void undo()}
            className="max-sm:hidden"
          >
            <Undo2Icon />
          </Button>
          {templates.length > 0 && site?.lead_email && (
            <label className="relative max-lg:hidden">
              <span className="sr-only">Template</span>
              <select
                value={site.starter_id ?? ""}
                disabled={busy || running}
                onChange={(e) => void switchTemplate(e.target.value)}
                className="h-7 max-w-44 cursor-pointer truncate rounded-lg border border-border bg-transparent px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus:border-ring/60"
                title="Start again from another template, with the same details"
              >
                {!site.starter_id && <option value="">Template</option>}
                {(["local", "other", "portfolio", "product"] as const).map((cat) => (
                  <optgroup key={cat} label={{ local: "Local businesses", other: "Everything else", portfolio: "Portfolios", product: "Products" }[cat]}>
                    {templates
                      .filter((t) => t.category === cat)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.kind}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          <div className="flex h-7 items-center rounded-lg border border-border p-0.5 lg:hidden" role="group" aria-label="Show">
            {(["preview", "thread"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={pane === v}
                onClick={() => setPane(v)}
                className={cn("h-full rounded-md px-2 text-xs text-muted-foreground transition-colors", pane === v && "bg-accent font-medium text-foreground")}
              >
                {v === "preview" ? "Preview" : "Changes"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="max-md:hidden" render={<a href={studio.edit(id)} />} title="Open in Studio, the full editor">
            <PencilIcon /> Studio
          </Button>
          <Button size="sm" variant="outline" className="max-sm:hidden" disabled={publishing} onClick={() => void publish()}>
            {publishing ? <Spinner /> : <UploadCloudIcon />} Publish
          </Button>
          <Button size="sm" disabled={!site?.lead_email || running} onClick={() => setSending(true)} title={site?.lead_email ? `Email ${site.lead_email} the link` : "This site isn't for a lead"}>
            <SendIcon /> Send
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* The thread: what was built, what Claude changed, what you asked for. */}
        <section className={cn("flex min-h-0 w-[min(440px,40%)] shrink-0 flex-col border-e border-border max-lg:w-full max-lg:border-e-0", pane !== "thread" && "max-lg:hidden")} aria-label="Changes">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-4 px-4 py-4">
              {loadError && <ErrorNote message={loadError} />}
              {site && <WorkLog lines={site.log} />}
              {running && <CopyWorking started={job.started} business={site?.company || site?.name || ""} />}
              {job?.status === "error" && (
                <Note tone="error">
                  Claude couldn't rewrite the copy: {job.error}{" "}
                  <button type="button" className="underline" onClick={() => void rewrite()}>
                    Try again
                  </button>
                </Note>
              )}
              {job?.status === "no_model" && <UseModel compact />}
              {site && !running && !modelLog && site.lead_email && model.ready && job?.status !== "error" && (
                <button
                  type="button"
                  onClick={() => void rewrite()}
                  className="flex cursor-pointer items-center gap-2 self-start rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] text-muted-foreground transition-colors hover:border-input hover:text-foreground"
                >
                  <SparklesIcon className="size-3.5" /> Have Claude write the words for {site.company || "them"}
                </button>
              )}
              {turns.map((t) => (
                <TurnView key={t.id} turn={t} onUndo={past.length && past[past.length - 1]!.label === t.text && !t.undone ? () => void undo() : undefined} />
              ))}
              <div ref={endRef} />
            </div>
          </div>
          <div className="shrink-0 px-4 pb-4">
            {!model.ready && model.loaded && <UseModel compact className="mb-2" />}
            <Composer onSend={(t) => void send(t)} busy={busy || running || !engine || !project} working={busy} modelLabel={model.ready ? "Claude" : ""} />
          </div>
        </section>

        {/* The site itself, live from /s/<slug>/. */}
        <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-muted/40", pane !== "preview" && "max-lg:hidden")} aria-label="Preview">
          {site && <Preview src={site.preview} version={version + (site.updated || 0)} />}
        </section>
      </div>

      {site && <SendDialog open={sending} onClose={() => setSending(false)} site={site} netlify={netlify} baseUrl={baseUrl} onSent={() => { void meta.reload(); sitesChanged(); }} />}
    </div>
  );
}

function WorkLog({ lines }: { lines: LogLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ol className="flex flex-col gap-1.5" aria-label="What happened">
      {lines.map((l, i) => {
        const Icon = KIND_ICON[l.kind] ?? CornerDownRightIcon;
        return (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-5 text-muted-foreground max-md:text-sm">
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", l.kind === "sent" && "text-success", l.kind === "model" && "text-foreground")} />
            <span className="min-w-0 flex-1 break-words">{l.text}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{short(l.ts)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function CopyWorking({ started, business }: { started: number; business: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - started) / 1000));
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-[13px]" aria-live="polite">
      <Spinner className="size-3.5" />
      <span className="font-medium">Claude is writing the words{business ? ` for ${business}` : ""}</span>
      <span className="ms-auto tabular-nums text-muted-foreground">{secs}s</span>
    </div>
  );
}

function Note({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className={cn("mt-0.5 grid size-5.5 shrink-0 place-items-center rounded-full", tone === "error" ? "bg-error-surface text-error-foreground" : "bg-muted text-muted-foreground")}>
        {tone === "error" ? <CircleAlertIcon className="size-3" /> : <InfoIcon className="size-3" />}
      </span>
      <p className={cn("text-[13px] leading-5", tone === "error" ? "text-error-foreground" : "text-muted-foreground")}>{children}</p>
    </div>
  );
}

function TurnView({ turn, onUndo }: { turn: Turn; onUndo?: () => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? (turn.changes ?? []) : (turn.changes ?? []).slice(0, 5);
  return (
    <article className="flex flex-col gap-3" aria-label={`You asked: ${turn.text}`}>
      <div className="ms-auto max-w-[85%] rounded-2xl rounded-br-md bg-message px-3.5 py-2 text-[15px] leading-6">{turn.text}</div>
      {turn.status === "working" && (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner className="size-3.5" /> Working on it
        </div>
      )}
      {turn.status === "error" && <Note tone="error">{turn.error}</Note>}
      {turn.status === "error" && turn.noModel && <UseModel compact />}
      {turn.status === "done" && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex min-h-10 items-center gap-2 border-b border-border px-3.5 py-1.5">
            <SparklesIcon className="size-3.5 text-muted-foreground" />
            <span className="text-[13px] font-semibold">
              {turn.changes!.length} {turn.changes!.length === 1 ? "change" : "changes"}
            </span>
            <span className="text-xs text-muted-foreground">{turn.by === "model" ? "by Claude" : "by Studio's rules"}</span>
          </div>
          <ul className="flex flex-col gap-1 px-3.5 py-2.5">
            {shown.map((c, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-5 text-muted-foreground max-md:text-sm">
                <CornerDownRightIcon className="mt-0.5 size-3.5 shrink-0" /> <span className="min-w-0 break-words">{c}</span>
              </li>
            ))}
            {!all && (turn.changes?.length ?? 0) > 5 && (
              <li>
                <button type="button" className="text-[13px] text-muted-foreground underline" onClick={() => setAll(true)}>
                  and {turn.changes!.length - 5} more
                </button>
              </li>
            )}
          </ul>
          {!!turn.skipped?.length && (
            <p className="px-3.5 pb-2.5 text-xs text-muted-foreground">
              Left out {turn.skipped.length}: {turn.skipped[0]!.reason}
            </p>
          )}
          <div className="flex items-center gap-2 border-t border-border bg-muted/60 px-3.5 py-2">
            <span className="flex flex-1 items-center gap-1.5 text-[13px] text-muted-foreground">
              {turn.undone ? (
                "Undone"
              ) : (
                <>
                  <CheckIcon className="size-3.5" /> On the site
                </>
              )}
            </span>
            {onUndo && (
              <Button size="xs" variant="ghost" onClick={onUndo}>
                <Undo2Icon /> Undo
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** With a model anything goes; Studio's rules alone understand page-wide moods. */
const EXAMPLES = {
  model: ["Make the headline shorter and punchier", "Add a section about opening hours", "Warmer colours", "Use a serif typeface"],
  rules: ["Make it calmer", "Make it more premium"],
};

function Composer({ onSend, busy, working, modelLabel }: { onSend: (text: string) => void; busy: boolean; working: boolean; modelLabel: string }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);
  const go = (t: string) => {
    const v = t.trim();
    if (!v || busy) return;
    onSend(v);
    setText("");
  };
  return (
    <div className="flex flex-col gap-2">
      {!text && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES[modelLabel ? "model" : "rules"].map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={busy}
              onClick={() => go(ex)}
              className="cursor-pointer rounded-lg border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground disabled:opacity-60"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
      <div
        className="cursor-text rounded-2xl border border-input bg-card shadow-composer transition-shadow focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/15"
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("button,a")) ref.current?.focus();
        }}
      >
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              go(text);
            }
          }}
          maxLength={1000}
          placeholder="Ask for a change to the site"
          aria-label="Ask for a change to the site"
          className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 outline-none placeholder:text-placeholder"
        />
        <div className="flex items-center gap-2 px-2.5 pb-2.5">
          <span className="flex items-center gap-1.5 px-1.5 text-xs text-muted-foreground">
            <SparklesIcon className="size-3.5" /> {modelLabel ? `${modelLabel} makes the change. ${MOD}Z undoes it` : "Studio's rules make simple changes"}
          </span>
          <Button size="icon-sm-pill" className="ms-auto" disabled={!text.trim() || busy} onClick={() => go(text)} aria-label="Make the change">
            {working ? <Spinner /> : <ArrowUpIcon />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Preview({ src, version }: { src: string; version: number }) {
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [nonce, setNonce] = useState(0);
  const url = `${src}?v=${version}-${nonce}`;
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-background px-3">
        <div className="flex h-7 items-center rounded-lg border border-border p-0.5" role="group" aria-label="Preview size">
          {(
            [
              ["desktop", MonitorIcon, "Desktop"],
              ["phone", SmartphoneIcon, "Phone"],
            ] as const
          ).map(([d, Icon, label]) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              aria-label={label}
              title={label}
              onClick={() => setDevice(d)}
              className={cn("grid h-full w-7 place-items-center rounded-md text-muted-foreground transition-colors", device === d && "bg-accent text-foreground")}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{src}</span>
        <Button size="icon-xs" variant="ghost" aria-label="Reload the preview" title="Reload" onClick={() => setNonce((n) => n + 1)}>
          <RotateCwIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Open in a new tab" title="Open in a new tab" render={<a href={src} target="_blank" rel="noopener noreferrer" />}>
          <ExternalLinkIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto p-3 max-md:p-0">
        <iframe
          key={url}
          src={url}
          title="Site preview"
          sandbox="allow-same-origin"
          className={cn("h-full min-h-[480px] rounded-lg border border-border bg-white shadow-sm max-md:rounded-none max-md:border-0", device === "desktop" ? "w-full" : "w-[390px] max-w-full")}
        />
      </div>
    </>
  );
}

interface EmailDraft {
  to: string;
  name: string;
  business: string;
  subject: string;
  body: string;
  url: string;
  can_publish: boolean;
  sent: { to: string; ts: number } | null;
}

function SendDialog({ open, onClose, site, netlify, baseUrl, onSent }: { open: boolean; onClose: () => void; site: SiteDetail; netlify: boolean; baseUrl: string; onSent: () => void }) {
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setDraft(null);
    api
      .get<EmailDraft>(`/api/sites/email?id=${encodeURIComponent(site.id)}`)
      .then((d) => {
        setDraft(d);
        setSubject(d.subject);
        setBody(d.body);
      })
      .catch((e) => setResult({ ok: false, text: (e as Error).message }));
  }, [open, site.id]);

  const noLink = !!draft && !draft.can_publish && (body.includes("{{site_url}}") || subject.includes("{{site_url}}"));

  const go = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.post<{ status: string; detail?: string; url: string }>("/api/sites/send", { id: site.id, subject, body });
      if (r.status === "sent") {
        toast(`Sent to ${draft?.to ?? site.lead_email}`);
        onSent();
        onClose();
      } else {
        setResult({ ok: false, text: r.detail || `Not sent (${r.status}).` });
        onSent();
      }
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Send {site.company || site.name} their site</DialogTitle>
          <DialogDescription>
            From your mailbox, inside today's warm-up limit. <code className="rounded bg-muted px-1 text-xs">{"{{site_url}}"}</code> becomes the link{netlify ? ", published to Netlify first if it isn't live yet" : baseUrl ? `, under ${baseUrl}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {!draft && !result && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Spinner className="size-3.5" /> Writing it
            </p>
          )}
          {draft && (
            <div className="flex flex-col gap-3">
              {draft.sent && <Note tone="info">You sent this site to {draft.sent.to} {short(draft.sent.ts)} ago. This one goes as a follow-up.</Note>}
              <label className="flex flex-col gap-1 text-[13px]">
                <span className="text-muted-foreground">To</span>
                <Input value={draft.name ? `${draft.name} <${draft.to}>` : draft.to} readOnly aria-label="To" />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                <span className="text-muted-foreground">Subject</span>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                <span className="text-muted-foreground">Message</span>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} aria-label="Message" />
              </label>
              {noLink && (
                <Note tone="error">
                  This site has no public link yet, so {"{{site_url}}"} has nothing to point to. Add a free Netlify token, or the address where you host sites, in{" "}
                  <a className="underline" href={href("settings", "all")}>
                    Settings
                  </a>
                  .
                </Note>
              )}
            </div>
          )}
          {result && <Note tone={result.ok ? "info" : "error"}>{result.text}</Note>}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!draft || busy || noLink || !subject.trim() || !body.trim()} onClick={() => void go()}>
            {busy ? <Spinner /> : <SendIcon />} Send
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
