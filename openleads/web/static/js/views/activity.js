/* =========================================================================
   Activity — everything that happened across the workspace, newest first,
   grouped by day: replies, sends, stage changes, notes, tasks, deals, list
   and sequence moves, searches and imports. Filter by what happened or by
   the kind of record; "Load older" pages back.
   ========================================================================= */
import { $, api, esc, fmt, ico, onAct, router, ui } from "../core.js";
import { item } from "../timeline.js";

const GROUPS = [
  ["", "Everything", "pulse", null],
  ["emails", "Emails", "send", ["email_sent", "email_error", "email_skipped", "replied", "bounced"]],
  ["replies", "Replies", "reply", ["replied"]],
  ["pipeline", "Stages & deals", "flag", ["stage", "deal_created", "deal_stage"]],
  ["work", "Notes & tasks", "note", ["note", "task_created", "task_done"]],
  ["sequences", "Sequences", "sequence", ["enrolled", "sequence_step", "sequence_done", "sequence_stopped"]],
  ["data", "Data", "layers", ["found", "imported", "enriched", "merged", "list_add", "list_remove", "tag", "search"]],
];
const TYPES = [["", "All records"], ["contact", "People"], ["company", "Companies"], ["deal", "Deals"]];
const PAGE = 60;
const A = { group: "", type: "", items: [], counts: {}, more: true };
let ROOT = null;

function dayLabel(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function feedHtml() {
  if (!A.items.length) {
    return ui.empty("pulse", "Nothing here yet", A.group || A.type
      ? "No activity matches these filters."
      : "Searches, sends, replies, notes, tasks and deal moves will show up here as you work.");
  }
  const days = [];
  for (const a of A.items) {
    const label = dayLabel(a.ts);
    if (!days.length || days[days.length - 1][0] !== label) days.push([label, []]);
    days[days.length - 1][1].push(a);
  }
  return days.map(([label, items]) => `<div class="feed-day"><div class="feed-day__head">${esc(label)}<span class="faint">${items.length}</span></div>
    <div class="card card--pad"><div class="timeline">${items.map((a) => item(a, { showRef: true })).join("")}</div></div></div>`).join("")
    + (A.more ? `<div class="row mt" style="justify-content:center"><button class="btn" data-act="more">${ico("chevron-down")} Load older</button></div>` : "");
}

function sum(keys) { return (keys || Object.keys(A.counts)).reduce((n, k) => n + (A.counts[k] || 0), 0); }

function render() {
  ROOT.innerHTML = `<section class="page">
    <div class="head"><div><div class="head__title"><h1>Activity</h1></div></div></div>
    <div class="grid grid-4 mb">${[["Emails sent", ["email_sent"], "send", ""], ["Replies", ["replied"], "reply", "good"],
      ["Stage changes", ["stage", "deal_stage"], "flag", ""], ["Tasks done", ["task_done"], "check", ""]].map(([l, k, i, tone]) =>
      `<div class="card stat"><div class="stat__label">${ico(i, "ico--sm")} ${l}</div><div class="stat__value" ${tone && sum(k) ? `style="color:var(--${tone})"` : ""}>${fmt.num(sum(k))}</div><div class="hint">last 30 days</div></div>`).join("")}</div>
    <div class="feed-shell">
      <aside class="feed-filters">
        <div class="hint mb-sm">What happened</div>
        ${GROUPS.map(([k, l, i, kinds]) => `<button type="button" class="feed-filter ${A.group === k ? "is-on" : ""}" data-act="group" data-k="${k}">
          ${ico(i, "ico--sm")}<span>${l}</span><span class="faint">${kinds ? fmt.num(sum(kinds)) : ""}</span></button>`).join("")}
        <div class="hint mb-sm mt-lg">Record</div>
        <div class="seg seg--stack">${TYPES.map(([k, l]) => `<button type="button" class="${A.type === k ? "is-on" : ""}" data-act="type" data-k="${k}">${l}</button>`).join("")}</div>
      </aside>
      <div id="feed">${feedHtml()}</div>
    </div></section>`;
}

async function fetchPage(before = null) {
  const g = GROUPS.find(([k]) => k === A.group);
  const r = await api.get("/api/activity", { limit: PAGE, kinds: g && g[3] ? g[3].join(",") : "", type: A.type,
    before: before ?? "", counts: before ? "" : "1" });
  if (r.counts) A.counts = r.counts;
  return r.activity || [];
}

async function reload() {
  A.items = await fetchPage(); A.more = A.items.length >= PAGE;
  render();
}

router.register("activity", {
  title: "Activity",
  async mount(root, ctx) {
    ROOT = root;
    A.group = GROUPS.some(([k]) => k === ctx.params.show) ? ctx.params.show : "";
    A.type = TYPES.some(([k]) => k === ctx.params.type) ? ctx.params.type : "";
    root.innerHTML = `<div class="page">${ui.skeleton(10)}</div>`;
    await reload();
    const sync = () => router.go("activity", "", { show: A.group, type: A.type }, { replace: true });
    onAct(root, {
      group: async (el) => { A.group = el.dataset.k; sync(); },
      type: async (el) => { A.type = el.dataset.k; sync(); },
      more: async (el) => {
        el.disabled = true;
        const older = await fetchPage(A.items[A.items.length - 1].ts);
        A.items = A.items.concat(older); A.more = older.length >= PAGE;
        const y = $("#main").scrollTop;
        $("#feed", root).innerHTML = feedHtml(); $("#main").scrollTop = y;
      },
    });
  },
  async update(ctx) {
    A.group = GROUPS.some(([k]) => k === ctx.params.show) ? ctx.params.show : "";
    A.type = TYPES.some(([k]) => k === ctx.params.type) ? ctx.params.type : "";
    await reload();
  },
});
