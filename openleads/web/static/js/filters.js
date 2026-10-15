/* =========================================================================
   Filter sidebar — facet checkboxes with live counts, text filters, selects
   and toggles, collapsible sections, and the active-filter chip row.
   Shared by People and Companies. The view owns the filter object; this module
   renders it and reports changes through ``onChange(filters)``.
   ========================================================================= */
import { debounce, esc, fmt, ico, store } from "./core.js";

const SHOW = 6;

export function isActive(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== "" && v !== false;
}

export function activeCount(filters, cfg) {
  return cfg.filter((c) => isActive(filters[c.key])).length;
}

export function labelFor(c, value) {
  if (c.labels) return c.labels(value);
  if (value === "" || value === null) return "(blank)";
  return String(value);
}

function facetBody(c, filters, facets) {
  const chosen = new Set((filters[c.key] || []).map(String));
  let opts = (facets?.[c.facetKey || c.key] || []).map((f) => ({ value: String(f.value ?? ""), count: f.count, label: f.label }));
  if (c.order) {
    const rank = new Map(c.order.map((k, i) => [k, i]));
    opts.sort((a, b) => (rank.has(a.value) ? rank.get(a.value) : 99) - (rank.has(b.value) ? rank.get(b.value) : 99));
  }
  // Keep chosen values visible even when their count drops to zero.
  for (const v of chosen) if (!opts.find((o) => o.value === v)) opts.push({ value: v, count: 0 });
  if (!opts.length) return `<p class="hint">No values yet.</p>`;
  const expanded = c._expanded;
  const shown = expanded ? opts : opts.slice(0, SHOW);
  return shown.map((o) => {
    const v = o.value === "" ? "(none)" : o.value;
    const lab = o.label || (o.value === "" ? (c.blank || "(none)") : labelFor(c, o.value));
    return `<label class="facet__opt"><input type="checkbox" data-f="${esc(c.key)}" value="${esc(v)}" ${chosen.has(v) ? "checked" : ""}/>
      <span class="lbl" title="${esc(lab)}">${esc(lab)}</span><span class="cnt">${fmt.num(o.count)}</span></label>`;
  }).join("") + (opts.length > SHOW ? `<button type="button" class="facet__more" data-fmore="${esc(c.key)}">${expanded ? "Show fewer" : `Show all ${opts.length}`}</button>` : "");
}

function body(c, filters, facets) {
  if (c.type === "text") {
    return `<input class="input input--sm" data-ft="${esc(c.key)}" value="${esc(filters[c.key] || "")}" placeholder="${esc(c.placeholder || "")}"/>
      ${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ""}`;
  }
  if (c.type === "select") {
    return `<select class="select select--sm" data-fs="${esc(c.key)}">${c.options.map(([v, l]) =>
      `<option value="${esc(v)}" ${String(filters[c.key] ?? "") === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  }
  if (c.type === "bool") {
    return `<label class="facet__opt"><input type="checkbox" data-fb="${esc(c.key)}" ${filters[c.key] ? "checked" : ""}/><span class="lbl">${esc(c.option || c.label)}</span></label>`;
  }
  return facetBody(c, filters, facets);
}

export function render(cfg, filters, facets, open, { title = "Filters", extraTop = "" } = {}) {
  const n = activeCount(filters, cfg);
  return `<div class="filters__head"><h3>${esc(title)}</h3>${n ? `<span class="facet__badge">${n}</span>` : ""}
      <span class="spacer"></span>${n ? `<button type="button" class="btn btn--xs btn--ghost" data-fclear>Clear all</button>` : ""}</div>
    ${extraTop}
    ${cfg.map((c) => {
      const on = isActive(filters[c.key]);
      const isOpen = open.has(c.key) || (on && !open.has("!" + c.key));
      return `<div class="facet ${isOpen ? "is-open" : ""}" data-facet="${esc(c.key)}">
        <button type="button" class="facet__head" data-ftoggle="${esc(c.key)}">${c.icon ? `<span class="faint">${ico(c.icon, "ico--sm")}</span>` : ""}${esc(c.label)}
          ${on ? `<span class="facet__badge">${Array.isArray(filters[c.key]) ? filters[c.key].length : "1"}</span>` : ""}${ico("chevron", "ico--sm chev")}</button>
        <div class="facet__body">${isOpen ? body(c, filters, facets) : ""}</div></div>`;
    }).join("")}`;
}

/** Chips for every active filter (with ×). */
export function chips(cfg, filters) {
  const out = [];
  for (const c of cfg) {
    const v = filters[c.key];
    if (!isActive(v)) continue;
    let text;
    if (Array.isArray(v)) text = v.map((x) => x === "(none)" ? (c.blank || "(none)") : labelFor(c, x)).join(", ");
    else if (c.type === "select") text = (c.options.find(([k]) => String(k) === String(v)) || [v, v])[1];
    else if (c.type === "bool") text = "yes";
    else text = v;
    out.push(`<span class="chip"><b>${esc(c.label)}:</b> ${esc(text)}<button type="button" data-fremove="${esc(c.key)}" title="Remove">${ico("x", "ico--sm")}</button></span>`);
  }
  return out.join("");
}

/** Wire a sidebar element. ``state`` = {filters, open:Set, cfg}; calls onChange(). */
export function bind(el, state, onChange, rerender) {
  const fire = () => onChange(state.filters);
  const typed = debounce(fire, 350);
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.f) {
      const k = t.dataset.f, cur = new Set(state.filters[k] || []);
      t.checked ? cur.add(t.value) : cur.delete(t.value);
      state.filters[k] = Array.from(cur);
      fire();
    } else if (t.dataset.fs) { state.filters[t.dataset.fs] = t.value; fire(); }
    else if (t.dataset.fb) { state.filters[t.dataset.fb] = t.checked; fire(); }
  });
  el.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.ft) { state.filters[t.dataset.ft] = t.value; typed(); }
  });
  el.addEventListener("click", (e) => {
    const tog = e.target.closest("[data-ftoggle]");
    if (tog) {
      const k = tog.dataset.ftoggle, f = tog.closest(".facet");
      const opening = !f.classList.contains("is-open");
      state.open.delete(k); state.open.delete("!" + k);
      state.open.add(opening ? k : "!" + k);
      store.setPref(state.prefKey, Array.from(state.open));
      rerender();
      return;
    }
    const more = e.target.closest("[data-fmore]");
    if (more) { const c = state.cfg.find((x) => x.key === more.dataset.fmore); c._expanded = !c._expanded; rerender(); return; }
    if (e.target.closest("[data-fclear]")) { clearAll(state); fire(); }
  });
}

export function clearAll(state) {
  for (const c of state.cfg) state.filters[c.key] = c.type === "text" || c.type === "select" ? "" : c.type === "bool" ? false : [];
}

/** Filters ↔ URL params (comma lists, 1 for booleans). */
export function toParams(cfg, filters, extra = {}) {
  const p = {};
  for (const c of cfg) {
    const v = filters[c.key];
    if (!isActive(v)) continue;
    p[c.param || c.key] = Array.isArray(v) ? v.join(",") : v === true ? "1" : String(v);
  }
  return { ...p, ...extra };
}
export function fromParams(cfg, params) {
  const f = {};
  for (const c of cfg) {
    const raw = params[c.param || c.key] ?? (c.alias ? params[c.alias] : undefined);
    if (c.type === "text" || c.type === "select") f[c.key] = raw || "";
    else if (c.type === "bool") f[c.key] = raw === "1" || raw === "true";
    else f[c.key] = raw ? String(raw).split(",").filter(Boolean) : [];
  }
  return f;
}

export function openSet(prefKey) { return new Set(store.pref(prefKey, [])); }
