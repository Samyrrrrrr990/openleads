/* Activity timeline rendering, shared by Home, record drawers and the Activity page. */
import { esc, fmt, ico } from "./core.js";

const ICONS = new Set(["plus", "find", "upload", "edit", "flag", "note", "tag", "list", "sequence",
  "task", "check", "deal", "send", "x", "reply", "merge", "spark"]);
const TONE = {
  replied: "good", deal_stage: "good", task_done: "good", sequence_done: "good", merged: "info",
  bounced: "bad", email_error: "bad", email_skipped: "", email_sent: "info", stage: "accent",
  enrolled: "info", sequence_step: "info", search: "accent", enriched: "info",
};

export function refHref(a) {
  if (a.ref_type === "contact") return `#/people/${encodeURIComponent(a.ref)}`;
  if (a.ref_type === "company") return `#/companies/${encodeURIComponent(a.ref)}`;
  if (a.ref_type === "deal") return `#/deals/${encodeURIComponent(a.ref)}`;
  if (a.ref_type === "search") return `#/prospect?q=${encodeURIComponent(a.ref)}`;
  return "";
}

export function item(a, { showRef = false } = {}) {
  const icon = ICONS.has(a.icon) ? a.icon : "pulse";
  const tone = TONE[a.kind] || "";
  const who = showRef ? (a.name || a.ref) : "";
  const href = showRef ? refHref(a) : "";
  let title = esc(a.label);
  if (a.kind === "search") title = `Searched <b>“${esc(a.ref)}”</b>`;
  else if (who) title += ` · ${href ? `<a class="link" href="${href}"><b>${esc(who)}</b></a>` : `<b>${esc(who)}</b>`}`;
  const extra = a.kind === "email_error" && a.data?.error ? a.data.error : "";
  return `<div class="tl-item"><span class="tl-icon ${tone ? "tl-icon--" + tone : ""}">${ico(icon)}</span>
    <div class="tl-body"><div class="tl-title">${title}</div>
      ${a.summary ? `<div class="tl-sub">${esc(a.summary)}</div>` : ""}${extra ? `<div class="tl-sub" style="color:var(--bad)">${esc(extra)}</div>` : ""}
      <div class="tl-time" title="${esc(fmt.datetime(a.ts))}">${esc(fmt.rel(a.ts))}</div></div></div>`;
}

export function timeline(items, opts = {}) {
  if (!items || !items.length) return `<p class="muted">Nothing yet.</p>`;
  return `<div class="timeline">${items.map((a) => item(a, opts)).join("")}</div>`;
}
