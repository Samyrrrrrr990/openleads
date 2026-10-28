/* =========================================================================
   Lists — named groups of people or companies. Open one to work it in the
   People/Companies table, enroll a whole people list in a sequence, export
   it, or rename, recolor and delete it.
   ========================================================================= */
import { enroll, exportMenu } from "../actions.js";
import { api, confirmDialog, esc, fail, fmt, ico, menu, modal, onAct, router, store, toast, ui } from "../core.js";

let ROOT = null;
let KIND = "people";
let LISTS = [];

const colorPicker = (cur) => `<div class="row row--wrap" style="gap:6px">${(store.meta?.list_colors || ["gray"]).map((c) =>
  `<label style="cursor:pointer"><input type="radio" name="color" value="${c}" ${c === (cur || "gray") ? "checked" : ""} style="display:none"/>
   <i class="color-dot c-${c}" style="width:22px;height:22px;border-radius:7px;display:inline-block;outline-offset:2px" data-swatch></i></label>`).join("")}</div>`;

function listForm(l = {}) {
  return `<div class="field"><label>Name</label><input class="input" name="name" value="${esc(l.name || "")}" placeholder="Q4 dentists in Texas" autofocus/></div>
    ${l.id ? "" : `<div class="field"><label>Holds</label><div class="seg"><label><input type="radio" name="kind" value="people" ${KIND === "people" ? "checked" : ""}/> People</label>
      <label style="margin-left:12px"><input type="radio" name="kind" value="companies" ${KIND === "companies" ? "checked" : ""}/> Companies</label></div></div>`}
    <div class="field"><label>Description</label><input class="input" name="description" value="${esc(l.description || "")}" placeholder="optional"/></div>
    <div class="field"><label>Color</label>${colorPicker(l.color)}</div>`;
}

function syncSwatches(form) {
  form.querySelectorAll("[data-swatch]").forEach((s) => {
    const r = s.closest("label").querySelector("input");
    s.style.outline = r.checked ? "2px solid var(--text)" : "none";
  });
}

async function editList(l) {
  await modal({
    title: l ? "Edit list" : "New list", body: listForm(l || {}),
    actions: [{ label: "Cancel", value: null }, { label: l ? "Save" : "Create list", kind: "primary", submit: true }],
    onMount: (f) => { syncSwatches(f); f.addEventListener("change", () => syncSwatches(f)); },
    onSubmit: async (f) => {
      const body = { name: f.name.value, description: f.description.value, color: f.color.value };
      if (l) body.id = l.id; else body.kind = f.kind?.value || KIND;
      const r = await api.post("/api/lists/save", body);
      toast(l ? "List saved" : `Created '${r.list.name}'`);
      await load(); render(); return true;
    },
  });
}

async function load() { LISTS = (await api.get("/api/lists", { kind: KIND })).lists || []; }

function open(l) {
  if (l.kind === "companies") router.go("companies", "", { list_id: l.id });
  else router.go("people", "", { list: l.id });
}

function render() {
  ROOT.innerHTML = `<section class="page">
    <div class="head"><div><div class="head__title"><h1>Lists</h1></div></div>
      <div class="head__actions"><button class="btn btn--primary" data-act="new">${ico("plus")} New list</button></div></div>
    <div class="seg mb" role="tablist">${[["people", "People lists", "users"], ["companies", "Company lists", "building"]].map(([k, l, i]) =>
      `<button type="button" class="${KIND === k ? "is-on" : ""}" data-act="kind" data-k="${k}">${ico(i, "ico--sm")} ${l}</button>`).join("")}</div>
    ${LISTS.length ? `<div class="grid grid-3">${LISTS.map((l) => `
      <div class="card stat stat--link" data-open="${l.id}" style="gap:8px">
        <div class="row"><i class="color-dot c-${esc(l.color || "gray")}" style="width:12px;height:12px"></i><b class="ellipsis" style="font-size:14.5px">${esc(l.name)}</b>
          <span class="spacer"></span><button class="btn btn--xs btn--ghost btn--icon" data-more="${l.id}" title="More">${ico("more")}</button></div>
        <div class="row"><span class="stat__value" style="font-size:26px">${fmt.num(l.count)}</span><span class="muted">${l.kind === "companies" ? "companies" : "people"}</span></div>
        <div class="hint ellipsis">${esc(l.description || "")}${l.description ? " · " : ""}updated ${esc(fmt.rel(l.updated))}</div>
        ${l.kind === "people" ? `<div class="row mt" style="gap:6px"><button class="btn btn--sm" data-enroll="${l.id}">${ico("sequence")} Add to sequence</button>
          <button class="btn btn--sm" data-export="${l.id}">${ico("download")} Export</button></div>` : ""}
      </div>`).join("")}</div>`
      : ui.empty("list", KIND === "people" ? "No people lists yet" : "No company lists yet",
        "Select rows in People or Companies and choose <b>Add to list</b>, or create an empty list here.",
        `<button class="btn btn--primary" data-act="new">${ico("plus")} New list</button>`)}
  </section>`;
}

router.register("lists", {
  title: "Lists",
  async mount(root) {
    ROOT = root;
    root.innerHTML = `<div class="page">${ui.skeleton(6)}</div>`;
    await load(); render();
    onAct(root, {
      new: () => editList(null),
      kind: async (el) => { KIND = el.dataset.k; await load(); render(); },
    });
    root.addEventListener("click", async (e) => {
      const more = e.target.closest("[data-more]");
      const en = e.target.closest("[data-enroll]");
      const ex = e.target.closest("[data-export]");
      const card = e.target.closest("[data-open]");
      try {
        if (more) {
          const l = LISTS.find((x) => String(x.id) === more.dataset.more);
          menu(more, [{ label: "Open", value: "open", icon: "arrow" }, { label: "Edit", value: "edit", icon: "edit" },
            { sep: true }, { label: "Delete list", value: "delete", icon: "trash", danger: true }], async (v) => {
            if (v === "open") open(l);
            if (v === "edit") editList(l);
            if (v === "delete" && await confirmDialog(`Delete '${l.name}'? The ${l.kind} in it stay in your workspace.`, { ok: "Delete", danger: true })) {
              await api.post("/api/lists/delete", { id: l.id }); toast("List deleted"); await load(); render();
            }
          }, { align: "right" });
        } else if (en) {
          const l = LISTS.find((x) => String(x.id) === en.dataset.enroll);
          await enroll({ all: true, filters: { list_id: [String(l.id)] }, total: l.count });
        } else if (ex) {
          const l = LISTS.find((x) => String(x.id) === ex.dataset.export);
          exportMenu(ex, { all: true, filters: { list_id: [String(l.id)] }, total: l.count });
        } else if (card && !e.target.closest("button")) {
          open(LISTS.find((x) => String(x.id) === card.dataset.open));
        }
      } catch (err) { fail(err); }
    });
  },
});
