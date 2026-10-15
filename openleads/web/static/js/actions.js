/* =========================================================================
   Shared actions on a selection of contacts — the same menus and dialogs from
   People, Find people, Companies and Lists, so they behave identically.

   A selection is {emails: [...]} or {all: true, filters: {...}} ("all 3,412
   matching"). Every action resolves to a result object and toasts its outcome.
   ========================================================================= */
import { api, confirmDialog, download, esc, fmt, ico, menu, modal, promptDialog, router, store, toast } from "./core.js";

const count = (sel) => sel.all ? sel.total : (sel.emails || []).length;
const who = (sel) => fmt.plural(count(sel), "contact");

/** "Add to list" menu: existing people lists + create new. */
export async function addToList(anchor, sel, { kind = "people" } = {}) {
  const lists = (await api.get("/api/lists", { kind })).lists || [];
  return new Promise((resolve) => {
    const items = [{ header: `Add ${who(sel)} to…` },
      ...lists.slice(0, 12).map((l) => ({ label: l.name, value: l.id, icon: "list",
        html: `<i class="color-dot c-${esc(l.color || "gray")}"></i><span class="ellipsis">${esc(l.name)}</span><span class="faint" style="margin-left:auto">${fmt.num(l.count)}</span>` })),
      ...(lists.length ? [{ sep: true }] : []),
      { input: true, placeholder: "New list name, then Enter", onEnter: (name) => go({ name }) },
    ];
    const go = async (target) => {
      try {
        const res = kind === "companies"
          ? await api.post("/api/lists/add", { ...target, kind, refs: sel.domains || [] })
          : await api.post("/api/lists/add", { ...target, kind, ...selPayload(sel) });
        toast(`Added ${fmt.num(res.added)} to ${res.list.name}`, "ok",
          { label: "View", run: () => router.go(kind === "companies" ? "companies" : "people", "", { list: res.list.id }) });
        resolve(res);
      } catch (e) { toast(e.message, "err"); resolve(null); }
    };
    menu(anchor, items, (id) => go({ id }), { width: 260 });
  });
}

export function selPayload(sel) {
  return sel.all ? { all: true, filters: sel.filters || {} } : { emails: sel.emails || [] };
}

/** Enroll a selection in a sequence (pick one or create from the starter). */
export async function enroll(sel) {
  const seqs = ((await api.get("/api/sequences")).sequences || []).filter((s) => s.status !== "archived");
  const options = seqs.map((s) => `<option value="${s.id}">${esc(s.name)} · ${s.status} · ${s.steps.length} steps</option>`).join("");
  let result = null;
  await modal({
    title: `Add ${who(sel)} to a sequence`,
    body: `${seqs.length ? `<div class="field"><label>Sequence</label><select class="select" name="seq">${options}<option value="new">+ New sequence from the 5-step starter…</option></select></div>`
      : `<div class="banner">${ico("spark")}<div>No sequences yet. We'll create one from the 5-step starter (email, bump, call, LinkedIn, breakup) that you can edit before activating.</div></div><input type="hidden" name="seq" value="new">`}
      <div class="field" data-newname ${seqs.length ? "hidden" : ""}><label>New sequence name</label><input class="input" name="name" placeholder="Q4 outbound"/></div>
      <label class="check"><input type="checkbox" name="force"/> Include contacts whose email isn't verified safe</label>
      <p class="hint">Contacts who are suppressed, do-not-contact, or already in a sequence are skipped and listed after.</p>`,
    actions: [{ label: "Cancel", value: null }, { label: "Add to sequence", kind: "primary", submit: true }],
    onMount: (f) => f.seq?.addEventListener?.("change", () => {
      f.querySelector("[data-newname]").hidden = f.seq.value !== "new";
    }),
    onSubmit: async (f) => {
      let id = f.seq.value;
      if (id === "new") {
        const name = (f.name.value || "").trim() || `Sequence ${new Date().toLocaleDateString()}`;
        id = (await api.post("/api/sequences/save", { name, starter: true })).sequence.id;
      }
      result = await api.post("/api/sequences/enroll", { id, ...selPayload(sel), force: f.force.checked });
      result.sequence_id = id;
      return true;
    },
  });
  if (!result) return null;
  const n = result.enrolled.length, k = result.skipped.length;
  toast(`Enrolled ${fmt.num(n)}${k ? ` · ${fmt.num(k)} skipped` : ""}`, n ? "ok" : "err",
    { label: "Open sequence", run: () => router.go("sequences", result.sequence_id) });
  if (k) showSkipped(result.skipped);
  return result;
}

export function showSkipped(skipped) {
  const rows = skipped.slice(0, 200).map((s) =>
    `<tr><td class="t-mono">${esc(s.email)}</td><td class="muted">${esc(s.reason)}</td></tr>`).join("");
  return modal({ title: `${fmt.num(skipped.length)} not enrolled`, wide: true,
    body: `<div class="table-wrap" style="max-height:360px;border:1px solid var(--line);border-radius:10px"><table class="tbl tbl--compact"><thead><tr><th>Email</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table></div>` });
}

/** Stage menu → bulk stage change. */
export function setStage(anchor, sel, onDone) {
  const stages = store.meta?.contact_stages || [];
  menu(anchor, [{ header: "Set stage" }, ...stages.map((s) => ({ label: s.label, value: s.key }))], async (key) => {
    const res = await api.post("/api/people/bulk", { ...selPayload(sel), action: "stage", value: key });
    toast(`${fmt.num(res.count)} moved to ${store.label("contact_stages", key)}`);
    onDone && onDone(res);
  });
}

export async function tag(sel, onDone) {
  const tagName = await promptDialog({ title: `Tag ${who(sel)}`, label: "Tag", placeholder: "hot, conference-2026",
    ok: "Add tag", hint: "Separate several with commas." });
  if (!tagName) return;
  const res = await api.post("/api/people/bulk", { ...selPayload(sel), action: "tag", value: tagName });
  toast(`Tagged ${fmt.num(res.count)}`);
  onDone && onDone(res);
}

/** Export menu: CSV / Apollo / HubSpot / JSON. */
export function exportMenu(anchor, sel) {
  menu(anchor, [{ header: `Export ${who(sel)}` },
    { label: "CSV (OpenLeads columns)", value: "csv", icon: "table" },
    { label: "Apollo-compatible CSV", value: "apollo", icon: "table" },
    { label: "HubSpot import CSV", value: "hubspot", icon: "table" },
    { label: "JSON", value: "json", icon: "code" }], async (fmtKey) => {
    const res = await api.post("/api/people/export", { ...selPayload(sel), format: fmtKey });
    download(res.filename, res.content, fmtKey === "json" ? "application/json" : "text/csv");
    toast(`Exported ${fmt.num(res.count)}`);
  }, { align: "right" });
}

/** Hand a set of leads (full rows) to Compose & send. */
export function writeEmails(leads) {
  store.compose = { leads: leads.filter((l) => l.email), drafts: [] };
  router.go("compose");
}

export async function moreMenu(anchor, sel, onDone) {
  menu(anchor, [
    { label: "Tag…", value: "tag", icon: "tag" },
    { label: "Assign owner…", value: "owner", icon: "user" },
    { sep: true },
    { label: "Mark do not contact", value: "dnc", icon: "flag", danger: true },
    { label: "Delete contacts", value: "delete", icon: "trash", danger: true },
  ], async (v) => {
    if (v === "tag") return tag(sel, onDone);
    if (v === "owner") {
      const owner = await promptDialog({ title: "Assign owner", label: "Owner", placeholder: "sam" });
      if (owner === null) return;
      const res = await api.post("/api/people/bulk", { ...selPayload(sel), action: "owner", value: owner });
      toast(`${fmt.num(res.count)} assigned to ${owner}`); onDone && onDone(res);
    }
    if (v === "dnc" || v === "delete") {
      const ok = await confirmDialog(v === "dnc"
        ? `${who(sel)} will be suppressed and never emailed again.`
        : `${who(sel)} will be removed from your workspace. Suppression and the send log are kept.`,
      { title: v === "dnc" ? "Mark do not contact?" : "Delete contacts?", ok: v === "dnc" ? "Suppress" : "Delete", danger: true });
      if (!ok) return;
      const res = await api.post("/api/people/bulk", { ...selPayload(sel), action: v === "dnc" ? "do_not_contact" : "delete" });
      toast(`${fmt.num(res.count)} ${v === "dnc" ? "suppressed" : "deleted"}`); onDone && onDone(res);
    }
  }, { align: "right" });
}
