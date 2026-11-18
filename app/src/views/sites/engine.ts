/**
 * Studio's engines, loaded into the app from `/studio/auto.js` (see
 * studio/src/auto). Templates, the command validator and the renderer run here;
 * the model runs on the server, on whatever you picked in Settings.
 */
import { useSyncExternalStore } from "react";

import { api } from "~/lib/api";

export type Project = { id: string; name: string; pages: { id: string; name: string }[] } & Record<string, unknown>;

export interface LeadBrief {
  email: string;
  business: string;
  contact: string;
  city: string;
  phone: string;
  website: string;
  industry: string;
  address: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  kind: string;
  category: string;
  swatches: [string, string, string];
}

export interface Change {
  project: Project;
  changes: string[];
  skipped: { what: string; reason: string }[];
  by?: "rules" | "model";
}

export interface SavedSite {
  id: string;
  slug: string;
  name: string;
  lead_email: string | null;
  company: string;
  starter_id: string | null;
  preview: string;
  url: string;
  updated: number;
}

type Ask = (system: string, user: string) => Promise<string>;

export interface Engine {
  ENGINE_VERSION: number;
  templates(): TemplateInfo[];
  pickTemplate(lead: Pick<LeadBrief, "industry" | "business">): { id: string; name: string; kind: string; why: string };
  build(lead: LeadBrief, starterId: string): { project: Project; notes: string[] };
  copyRequest(project: Project, lead: LeadBrief, extra?: string): { system: string; user: string };
  applyCopyReply(project: Project, reply: string): Change;
  proposeChange(project: Project, prompt: string, ask: Ask | null): Promise<Change>;
  save(project: Project, starterId: string | null, lead?: string): Promise<SavedSite>;
  load(id: string): Promise<Project | null>;
}

let loading: Promise<Engine> | null = null;

export function loadEngine(version = ""): Promise<Engine> {
  loading ??= (import(/* @vite-ignore */ `/studio/auto.js${version ? `?v=${encodeURIComponent(version)}` : ""}`) as Promise<Engine>).catch((e) => {
    loading = null;
    throw new Error(`Couldn't load the site builder: ${(e as Error).message}`);
  });
  return loading;
}

/** Thrown when no model is picked, so the screen can offer one instead of failing. */
export class NoModel extends Error {}

/** One answer from the model you picked in Settings (your Claude subscription, a key…). */
export const ask: Ask = async (system, user) => {
  const r = await api.post<{ ok: boolean; text?: string; code?: string; detail?: string }>("/api/sites/ai", { system, user });
  if (!r.ok) {
    if (r.code === "no_model") throw new NoModel(r.detail || "Pick a model first");
    throw new Error(r.detail || "The model didn't answer");
  }
  return r.text ?? "";
};

export async function logLines(id: string, lines: { text: string; kind: string }[]): Promise<void> {
  try {
    await api.post("/api/sites/log", { id, lines });
  } catch {
    /* the log is a record, not the work: never fail a build over it */
  }
}

// --- Claude's pass over the copy: it outlives the screen that started it ------------ //

export interface CopyJob {
  siteId: string;
  status: "running" | "done" | "error" | "no_model";
  started: number;
  /** The project after the pass, for the screen to pick up. */
  project?: Project;
  changes?: string[];
  skipped?: { what: string; reason: string }[];
  error?: string;
}

const jobs = new Map<string, CopyJob>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function setJob(job: CopyJob) {
  jobs.set(job.siteId, job);
  emit();
}

export function useCopyJob(siteId: string): CopyJob | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => jobs.get(siteId),
  );
}

export function clearJob(siteId: string) {
  jobs.delete(siteId);
  emit();
}

/** Has the model rewrite the template's words for this business, then saves. */
export async function rewriteCopy(engine: Engine, siteId: string, project: Project, lead: LeadBrief, extra = ""): Promise<void> {
  if (jobs.get(siteId)?.status === "running") return;
  const started = Date.now();
  setJob({ siteId, status: "running", started });
  try {
    const { system, user } = engine.copyRequest(project, lead, extra);
    const reply = await ask(system, user);
    const out = engine.applyCopyReply(project, reply);
    if (out.changes.length > 0) await engine.save(out.project, null);
    const secs = Math.round((Date.now() - started) / 1000);
    await logLines(siteId, [
      { text: out.changes.length ? `Rewrote ${out.changes.length} ${out.changes.length === 1 ? "line" : "lines"} of copy for ${lead.business || "them"} (${secs}s)` : `Read the copy and found nothing to change (${secs}s)`, kind: "model" },
      ...(out.skipped.length ? [{ text: `Left out ${out.skipped.length} ${out.skipped.length === 1 ? "change" : "changes"} the site wouldn't take`, kind: "info" }] : []),
    ]);
    setJob({ siteId, status: "done", started, project: out.project, changes: out.changes, skipped: out.skipped });
  } catch (e) {
    if (e instanceof NoModel) setJob({ siteId, status: "no_model", started, error: e.message });
    else setJob({ siteId, status: "error", started, error: (e as Error).message });
  }
}

/** Builds a site for a lead: picks the template, fills in their details, saves it. */
export async function buildForLead(engine: Engine, lead: LeadBrief, starterId?: string, keepId?: string): Promise<{ site: SavedSite; project: Project }> {
  const pick = starterId ? { ...engine.templates().find((t) => t.id === starterId)!, why: "" } : engine.pickTemplate(lead);
  const { project, notes } = engine.build(lead, pick.id);
  if (keepId) project.id = keepId;
  const site = await engine.save(project, pick.id, lead.email);
  await logLines(site.id, [
    { text: starterId ? `Switched to the ${pick.name} template` : `Picked the ${pick.name} template (${pick.kind.toLowerCase()})${"why" in pick && pick.why ? `: ${pick.why}` : ""}`, kind: "build" },
    ...notes.slice(1).map((text) => ({ text, kind: "build" })),
  ]);
  return { site, project };
}
