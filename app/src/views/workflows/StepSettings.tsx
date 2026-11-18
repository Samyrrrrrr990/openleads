import { PlusIcon, Trash2Icon, XIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import type { Catalog, GNode, NodeRun, NodeType, Param, Problem } from "./model";

/** The right-hand panel for one step: what it does, its settings, its last run. */
export function StepSettings({
  node,
  type,
  catalog,
  run,
  problems,
  onChange,
  onDelete,
  onClose,
}: {
  node: GNode;
  type: NodeType | undefined;
  catalog: Catalog;
  run?: NodeRun;
  problems: Problem[];
  onChange: (n: GNode) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const set = (key: string, value: unknown) => onChange({ ...node, params: { ...node.params, [key]: value } });
  return (
    <aside className="flex w-80 shrink-0 flex-col border-s border-border bg-background max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:bg-card max-lg:shadow-lg max-sm:w-full">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3.5">
        <span className="truncate text-[13px] font-semibold">{type?.label ?? node.type}</span>
        <Badge variant="secondary">{type?.group}</Badge>
        <Button size="icon" variant="ghost" className="ms-auto size-7" aria-label="Close settings" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5">
        {type?.doc && <p className="text-xs leading-5 text-muted-foreground">{type.doc.replace(/`/g, "")}</p>}
        {problems.map((p, i) => (
          <p key={i} className={cn("rounded-lg px-2.5 py-1.5 text-xs", p.level === "error" ? "bg-error-surface text-error-foreground" : "bg-muted text-muted-foreground")}>
            {p.message}
          </p>
        ))}
        {run && (
          <div className="rounded-lg border border-border p-2.5 text-xs leading-5">
            <div className="font-medium">Last run: {run.status}</div>
            <div className="text-muted-foreground tabular-nums">
              {run.in ?? 0} in{run.out ? ` · ${Object.entries(run.out).map(([p, c]) => `${c} ${p === "out" ? "out" : p}`).join(", ")}` : ""}
              {run.ms !== undefined ? ` · ${run.ms} ms` : ""}
            </div>
            {run.error && <div className="text-destructive">{run.error}</div>}
            {run.notes?.map((n, i) => (
              <div key={i} className="text-muted-foreground">
                {n}
              </div>
            ))}
          </div>
        )}
        {type?.params.map((p) => <ParamField key={p.key} param={p} value={node.params[p.key]} catalog={catalog} onChange={(v) => set(p.key, v)} />)}
        {type && type.params.length === 0 && <p className="text-xs text-muted-foreground">Nothing to set for this step.</p>}
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">More</summary>
          <div className="mt-2.5 space-y-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-muted-foreground">Name on the canvas</span>
              <Input value={node.name ?? ""} placeholder={type?.label} onChange={(e) => onChange({ ...node, name: e.target.value })} />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">If this step fails, keep going</span>
              <Switch checked={node.on_error === "continue"} onCheckedChange={(v) => onChange({ ...node, on_error: v ? "continue" : "stop" })} />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Skip this step</span>
              <Switch checked={!!node.disabled} onCheckedChange={(v) => onChange({ ...node, disabled: v })} />
            </label>
          </div>
        </details>
      </div>
      <footer className="border-t border-border p-3">
        <Button size="sm" variant="ghost-destructive" onClick={onDelete}>
          <Trash2Icon /> Delete step
        </Button>
      </footer>
    </aside>
  );
}

function ParamField({ param: p, value, catalog, onChange }: { param: Param; value: unknown; catalog: Catalog; onChange: (v: unknown) => void }) {
  const label = (
    <span className="text-xs font-medium">
      {p.label}
      {p.required && <span className="text-destructive"> *</span>}
    </span>
  );
  const help = p.help && <span className="text-xs leading-4 text-muted-foreground">{p.help.replace(/`/g, "")}</span>;
  const listId = `opts-${p.key}`;
  switch (p.kind) {
    case "bool":
      return (
        <label className="flex items-start justify-between gap-3">
          <span className="flex flex-col gap-0.5">
            {label}
            {help}
          </span>
          <Switch checked={!!value} onCheckedChange={(v) => onChange(v)} />
        </label>
      );
    case "textarea":
      return (
        <label className="flex flex-col gap-1.5">
          {label}
          <Textarea value={String(value ?? "")} placeholder={p.placeholder} onChange={(e) => onChange(e.target.value)} rows={3} />
          {help}
        </label>
      );
    case "number":
      return (
        <label className="flex flex-col gap-1.5">
          {label}
          <Input type="number" value={value === undefined || value === null ? "" : String(value)} min={p.min} max={p.max} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
          {help}
        </label>
      );
    case "select":
    case "stage": {
      const opts = p.kind === "stage" ? catalog.options.stage : p.options ?? [];
      return (
        <label className="flex flex-col gap-1.5">
          {label}
          <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm sm:h-8">
            {p.kind === "stage" && <option value="">Any</option>}
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label || "(none)"}
              </option>
            ))}
          </select>
          {help}
        </label>
      );
    }
    case "list":
    case "sequence":
    case "template": {
      const opts = catalog.options[p.kind as "list" | "sequence" | "template"] ?? [];
      return (
        <label className="flex flex-col gap-1.5">
          {label}
          <Input value={String(value ?? "")} placeholder={p.placeholder || (p.kind === "list" ? "A new or existing list" : "")} onChange={(e) => onChange(e.target.value)} list={listId} />
          <datalist id={listId}>
            {opts.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          {help}
        </label>
      );
    }
    case "conditions":
      return <Conditions value={Array.isArray(value) ? (value as Cond[]) : []} catalog={catalog} onChange={onChange} label={label} />;
    case "schedule":
      return (
        <label className="flex flex-col gap-1.5">
          {label}
          <Input value={String(value ?? "")} placeholder={p.placeholder} onChange={(e) => onChange(e.target.value)} />
          <span className="flex flex-wrap gap-1">
            {["weekdays 09:00", "daily 08:30", "mondays 10:00", "every 2h"].map((s) => (
              <button key={s} type="button" onClick={() => onChange(s)} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
                {s}
              </button>
            ))}
          </span>
          {help}
        </label>
      );
    default:
      return (
        <label className="flex flex-col gap-1.5">
          {label}
          <Input value={String(value ?? "")} placeholder={p.placeholder} onChange={(e) => onChange(e.target.value)} />
          {help}
        </label>
      );
  }
}

interface Cond {
  field: string;
  op: string;
  value: unknown;
}

function Conditions({ value, catalog, onChange, label }: { value: Cond[]; catalog: Catalog; onChange: (v: Cond[]) => void; label: React.ReactNode }) {
  const set = (i: number, c: Partial<Cond>) => onChange(value.map((x, j) => (j === i ? { ...x, ...c } : x)));
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {value.map((c, i) => {
        const f = catalog.fields.find((x) => x.key === c.field);
        return (
          <div key={i} className="flex flex-col gap-1 rounded-lg border border-border p-2">
            <div className="flex gap-1">
              <select value={c.field} onChange={(e) => set(i, { field: e.target.value, value: "" })} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs">
                {catalog.fields.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
              <select value={c.op} onChange={(e) => set(i, { op: e.target.value })} className="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs">
                {catalog.ops.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Button size="icon" variant="ghost" className="size-8" aria-label="Remove condition" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <XIcon />
              </Button>
            </div>
            {f?.options ? (
              <select value={String(c.value ?? "")} onChange={(e) => set(i, { value: e.target.value })} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                <option value="">Choose…</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input value={String(c.value ?? "")} onChange={(e) => set(i, { value: e.target.value })} placeholder="value" className="h-8 text-xs" />
            )}
          </div>
        );
      })}
      <Button size="xs" variant="outline" onClick={() => onChange([...value, { field: catalog.fields[0]?.key ?? "tier", op: "is", value: "" }])}>
        <PlusIcon /> Add condition
      </Button>
    </div>
  );
}
