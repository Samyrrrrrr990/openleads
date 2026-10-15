/* =========================================================================
   OpenLeads workspace — entry point.
   Boots the shell (navigation, theme, sidebar), loads the vocabularies the
   views share, registers every view, and starts the router.
   ========================================================================= */
import { $, api, esc, ico, router, store, toast } from "./js/core.js";
import "./js/views/home.js";
import "./js/views/prospect.js";
import "./js/views/people.js";
import "./js/views/companies.js";
import "./js/views/compose.js";
import "./js/views/analytics.js";
import "./js/views/workflows.js";
import "./js/views/automations.js";
import "./js/views/enrich.js";
import "./js/views/settings.js";
import "./js/views/doctor.js";

const NAV = [
  ["Workspace", [
    ["home", "Home", "home"],
    ["prospect", "Find people", "radar"],
    ["people", "People", "users"],
    ["companies", "Companies", "building"],
    ["lists", "Lists", "list"],
  ]],
  ["Engage", [
    ["sequences", "Sequences", "sequence"],
    ["tasks", "Tasks", "task"],
    ["templates", "Templates", "template"],
    ["compose", "Compose & send", "send"],
  ]],
  ["Pipeline", [
    ["deals", "Deals", "deal"],
    ["analytics", "Analytics", "chart"],
    ["activity", "Activity", "pulse"],
  ]],
  ["Automate", [
    ["workflows", "Workflows", "flow"],
    ["automations", "Recipes & watchers", "robot"],
    ["enrich", "Import & enrich", "upload"],
  ]],
  ["Settings", [
    ["settings", "Settings", "settings"],
    ["health", "Data health", "heart"],
    ["doctor", "Doctor", "doctor"],
  ]],
];

function renderNav() {
  const host = $("#nav-links");
  host.innerHTML = NAV.map(([group, items]) => {
    const links = items.filter(([name]) => router.views[name]);
    if (!links.length) return "";
    return `<div class="nav__group">${esc(group)}</div>` + links.map(([name, label, icon]) =>
      `<a class="navlink" href="#/${name}" data-nav="${name}" title="${esc(label)}">${ico(icon)}<span>${esc(label)}</span>`
      + (name === "tasks" ? '<span class="navlink__count hidden" id="nav-tasks"></span>' : "") + "</a>").join("");
  }).join("");
}

router.onChange = (ctx) => {
  document.querySelectorAll(".navlink").forEach((a) => a.classList.toggle("is-active", a.dataset.nav === ctx.name));
};

/* ------------------------------------------------------------- theme */
export function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  store.setPref("theme", root.dataset.theme);
  try { localStorage.setItem("ol-theme", root.dataset.theme); } catch (_) { /* */ }
  syncThemeIcon();
}
function syncThemeIcon() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const b = document.querySelector('[data-global="theme"] use');
  if (b) b.setAttribute("href", dark ? "#i-sun" : "#i-moon");
}
function toggleNav() {
  const app = $("#app");
  app.classList.toggle("nav-collapsed");
  try { localStorage.setItem("ol-nav", app.classList.contains("nav-collapsed") ? "collapsed" : ""); } catch (_) { /* */ }
}

document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-global]");
  if (!g) return;
  const act = g.dataset.global;
  if (act === "theme") toggleTheme();
  else if (act === "collapse") toggleNav();
  else if (act === "palette" || act === "shortcuts") {
    document.dispatchEvent(new CustomEvent("ol:" + act));
  }
});

/* ------------------------------------------------------- live badges */
export async function refreshBadges() {
  try {
    const t = await api.get("/api/tasks", { bucket: "today" });
    const n = (t.counts?.today || 0) + (t.counts?.overdue || 0);
    const el = $("#nav-tasks");
    if (el) { el.textContent = n; el.classList.toggle("hidden", !n); el.classList.toggle("is-quiet", !t.counts?.overdue); }
  } catch (_) { /* tasks view not available yet */ }
}
async function loadReadiness() {
  try {
    const d = await api.get("/api/doctor");
    const g = d?.preflight?.grade || "—";
    const el = $("#readiness");
    el.textContent = g;
    el.className = "badge badge--sm " + ({ A: "badge--good", B: "badge--info", C: "badge--warn", F: "badge--bad" }[g] || "");
    store.doctor = d;
  } catch (_) { /* offline */ }
}
document.addEventListener("ol:refresh-badges", refreshBadges);

/* --------------------------------------------------------------- boot */
async function boot() {
  if (document.documentElement.classList.contains("nav-pre-collapsed")) $("#app").classList.add("nav-collapsed");
  syncThemeIcon();
  try {
    const [state, meta] = await Promise.all([api.get("/api/state"), api.get("/api/meta").catch(() => null)]);
    store.state = state; store.meta = meta; store.version = state.version;
    $("#version").textContent = "v" + state.version;
  } catch (e) {
    toast("Could not reach the local OpenLeads server.", "err");
  }
  renderNav();
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    history.replaceState(null, "", "#/" + (router.views.home ? "home" : "prospect"));
  }
  await router.render();
  document.getElementById("boot").classList.add("is-done");
  setTimeout(() => document.getElementById("boot")?.remove(), 400);
  refreshBadges();
  loadReadiness();
}

// Legacy deep links (#find, #crm, …) from 4.x bookmarks.
const LEGACY = { find: "prospect", leads: "people", crm: "people", write: "compose", send: "compose" };
const old = location.hash.replace(/^#/, "");
if (LEGACY[old] || (old && !old.startsWith("/") && router.views[old])) {
  history.replaceState(null, "", "#/" + (LEGACY[old] || old));
}

boot();
