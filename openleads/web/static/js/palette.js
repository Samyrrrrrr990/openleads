/* =========================================================================
   Command palette (⌘K / Ctrl+K / "/") and global keyboard shortcuts.
   The palette jumps to any page, runs common actions and searches People
   and Companies live; Enter opens the highlighted result. "?" lists every
   shortcut. Shortcuts never fire while typing in a field.
   ========================================================================= */
import { api, debounce, esc, ico, modal, router, ui } from "./core.js";
import { editTask } from "./views/tasks.js";

const GO = [["h", "home"], ["f", "prospect"], ["p", "people"], ["c", "companies"], ["l", "lists"], ["s", "sequences"],
  ["t", "tasks"], ["m", "templates"], ["d", "deals"], ["a", "analytics"], ["v", "activity"], ["w", "workflows"],
  ["i", "enrich"], [",", "settings"]];

/** Navigate, then click a control once the page has mounted it. */
function goAndClick(name, selector, id = "") {
  router.go(name, id);
  let tries = 0;
  const t = setInterval(() => {
    const el = document.querySelector(`#main ${selector}`);
    if (el) { clearInterval(t); el.click(); } else if (++tries > 40) clearInterval(t);
  }, 50);
}

const ACTIONS = [
  { label: "Find new people…", icon: "radar", hint: "search the web", run: (q) => router.go("prospect", "", q ? { q } : null) },
  { label: "New task", icon: "task", run: () => editTask().then((t) => { if (t && router.current()?.name === "tasks") router.render(); }) },
  { label: "New deal", icon: "deal", run: () => goAndClick("deals", "[data-act=new]") },
  { label: "New sequence", icon: "sequence", run: () => goAndClick("sequences", "[data-act=new]") },
  { label: "New template", icon: "template", run: () => goAndClick("templates", "[data-act=new]") },
  { label: "New list", icon: "list", run: () => goAndClick("lists", "[data-act=new]") },
  { label: "Import a CSV", icon: "upload", run: () => router.go("enrich", "import") },
  { label: "Start the task queue", icon: "play", run: () => goAndClick("tasks", "[data-act=queue]") },
  { label: "Review duplicates", icon: "merge", run: () => router.go("health") },
  { label: "Tune ICP scoring", icon: "star", run: () => router.go("settings", "scoring") },
  { label: "Toggle dark mode", icon: "moon", hint: "T", run: () => document.querySelector('[data-global="theme"]')?.click() },
  { label: "Keyboard shortcuts", icon: "keyboard", hint: "?", run: () => showShortcuts() },
  { label: "Run Doctor", icon: "doctor", run: () => router.go("doctor") },
];

function pages() {
  return Array.from(document.querySelectorAll(".navlink")).map((a) => ({
    label: a.querySelector("span")?.textContent || a.dataset.nav,
    icon: (a.querySelector("use")?.getAttribute("href") || "#i-arrow").replace("#i-", ""),
    name: a.dataset.nav,
    hint: (GO.find(([, n]) => n === a.dataset.nav) || [])[0] ? `G ${(GO.find(([, n]) => n === a.dataset.nav) || [])[0].toUpperCase()}` : "",
  }));
}

const match = (text, q) => text.toLowerCase().includes(q);

let open = null;

export function openPalette(initial = "") {
  if (open) { open.input.focus(); return; }
  const wrap = document.createElement("div");
  wrap.className = "palette";
  wrap.innerHTML = `<div class="scrim" data-close></div>
    <div class="palette__box" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="palette__input">${ico("find")}<input placeholder="Search people, companies, pages and actions…" aria-label="Search" autocomplete="off" spellcheck="false"/><kbd>Esc</kbd></div>
      <div class="palette__list" role="listbox"></div>
      <div class="palette__foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span><span class="spacer"></span><span><kbd>?</kbd> all shortcuts</span></div>
    </div>`;
  document.getElementById("overlays").appendChild(wrap);
  const input = wrap.querySelector("input");
  const list = wrap.querySelector(".palette__list");
  let items = [], active = 0, remote = { people: [], companies: [] }, seq = 0;

  function build() {
    const q = input.value.trim().toLowerCase();
    const out = [];
    const pg = pages().filter((p) => !q || match(p.label, q));
    // "Find new people: <query>" is the fallback, so it goes after real matches.
    const find = ACTIONS[0];
    const acts = ACTIONS.slice(1).filter((a) => !q || match(a.label, q));
    if (!q || match(find.label, q)) acts.unshift(find); else if (q.length > 1) acts.push(find);
    if (q.length > 1) {
      remote.people.forEach((p) => out.push({ group: "People", label: ui.name(p) || p.email, sub: [p.title, p.organization].filter(Boolean).join(" · ") || p.email,
        html: ui.avatar(ui.name(p) || p.email, p.email, "avatar--sm"), run: () => router.go("people", p.email) }));
      remote.companies.forEach((c) => out.push({ group: "Companies", label: c.name || c.domain, sub: c.domain,
        html: ui.companyAvatar(c.name || c.domain, "avatar--sm"), run: () => router.go("companies", c.domain) }));
    }
    pg.forEach((p) => out.push({ group: "Go to", label: p.label, icon: p.icon, sub: p.hint, run: () => router.go(p.name) }));
    acts.forEach((a) => out.push({ group: "Actions", label: a.label.startsWith("Find new") && q ? `Find new people: “${input.value.trim()}”` : a.label,
      icon: a.icon, sub: a.hint || "", run: () => a.run(input.value.trim()) }));
    items = out; active = Math.min(active, Math.max(0, items.length - 1));
    let last = "";
    list.innerHTML = items.length ? items.map((it, i) => {
      const head = it.group !== last ? `<div class="palette__group">${esc(it.group)}</div>` : "";
      last = it.group;
      return `${head}<div class="palette__item ${i === active ? "is-active" : ""}" role="option" data-i="${i}" aria-selected="${i === active}">
        ${it.html || ico(it.icon || "arrow")}<span class="ellipsis">${esc(it.label)}</span>${it.sub ? `<span class="sub ellipsis">${esc(it.sub)}</span>` : ""}</div>`;
    }).join("") : `<div class="palette__group" style="text-transform:none">Nothing matches “${esc(input.value)}”.</div>`;
    list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }

  const fetchRemote = debounce(async () => {
    const q = input.value.trim(); const my = ++seq;
    if (q.length < 2) { remote = { people: [], companies: [] }; build(); return; }
    try {
      const [p, c] = await Promise.all([
        api.post("/api/people/search", { filters: { q }, per_page: 5, sort: "fit_score" }).catch(() => ({ rows: [] })),
        api.post("/api/companies/search", { filters: { q }, per_page: 4 }).catch(() => ({ rows: [] })),
      ]);
      if (my !== seq || !open) return;
      remote = { people: p.rows || [], companies: c.rows || [] }; active = 0; build();
    } catch (_) { /* offline */ }
  }, 160);

  function close() {
    document.removeEventListener("keydown", keys, true);
    wrap.remove(); open = null;
  }
  function pick(i) { const it = items[i]; if (!it) return; close(); Promise.resolve(it.run()).catch(() => {}); }
  function keys(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % Math.max(1, items.length); build(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % Math.max(1, items.length); build(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(active); }
  }
  document.addEventListener("keydown", keys, true);
  input.addEventListener("input", () => { active = 0; build(); fetchRemote(); });
  list.addEventListener("mousemove", (e) => {
    const el = e.target.closest("[data-i]"); if (!el || +el.dataset.i === active) return;
    active = +el.dataset.i; list.querySelectorAll(".palette__item").forEach((x) => x.classList.toggle("is-active", x === el));
  });
  list.addEventListener("click", (e) => { const el = e.target.closest("[data-i]"); if (el) pick(+el.dataset.i); });
  wrap.querySelector("[data-close]").addEventListener("click", close);
  open = { input, close };
  input.value = initial; build(); if (initial) fetchRemote();
  input.focus();                      // now, so keystrokes right after "/" land here
}

export function showShortcuts() {
  const row = (keys, label) => `<div class="kbd-row"><span>${label}</span><span>${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(" ")}</span></div>`;
  const names = Object.fromEntries(pages().map((p) => [p.name, p.label]));
  modal({ title: "Keyboard shortcuts", wide: true, body: `<div class="grid grid-2" style="gap:24px">
    <div><h3 class="mb">Anywhere</h3>
      ${row(["⌘", "K"], "Command palette")}${row(["/"], "Search")}${row(["?"], "This list")}
      ${row(["T"], "Toggle dark mode")}${row(["N"], "New item on this page")}${row(["Esc"], "Close a panel or dialog")}
      <h3 class="mb mt-lg">On a page</h3>
      ${row(["↵"], "Task queue: complete & next")}${row(["S"], "Task queue: skip")}${row(["Z"], "Task queue: snooze")}
      ${row(["[", "]"], "Deals: move focused deal a stage")}</div>
    <div><h3 class="mb">Go to</h3>${GO.filter(([, n]) => names[n]).map(([k, n]) => row(["G", k.toUpperCase()], esc(names[n]))).join("")}</div></div>` });
}

/* ------------------------------------------------------------ shortcuts */
const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
let gPending = 0;
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); openPalette(); return; }
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || open) return;
  if (document.querySelector(".modal-wrap, .drawer")) return;            // dialogs own the keyboard
  const k = e.key;
  if (gPending && Date.now() - gPending < 1200) {
    gPending = 0;
    const hit = GO.find(([key]) => key === k.toLowerCase());
    if (hit && router.views[hit[1]]) { e.preventDefault(); router.go(hit[1]); }
    return;
  }
  if (k === "g" || k === "G") { gPending = Date.now(); return; }
  if (k === "/") { e.preventDefault(); openPalette(); }
  else if (k === "?") { e.preventDefault(); showShortcuts(); }
  else if (k === "t" || k === "T") document.querySelector('[data-global="theme"]')?.click();
  else if (k === "n" || k === "N") { const b = document.querySelector("#main [data-act=new]"); if (b) { e.preventDefault(); b.click(); } }
});
document.addEventListener("ol:palette", () => openPalette());
document.addEventListener("ol:shortcuts", () => showShortcuts());
