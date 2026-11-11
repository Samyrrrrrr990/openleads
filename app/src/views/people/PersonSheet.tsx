import { BuildingIcon, CopyIcon, GlobeIcon, LinkedinIcon, MapPinIcon, PhoneIcon, PinIcon } from "lucide-react";
import { useState } from "react";

import { Avatar, ErrorNote, LoadingRows, ToneBadge } from "~/components/app/bits";
import { Pick } from "~/components/app/Pick";
import { Button } from "~/components/ui/button";
import { Sheet, SheetPopup, SheetTitle } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { api } from "~/lib/api";
import { ago, due, safeUrl } from "~/lib/format";
import { useMeta } from "~/lib/meta";
import { classic } from "~/lib/router";
import { fail, toast } from "~/lib/toast";
import type { Activity, Person, Task } from "~/lib/types";
import { useApi } from "~/lib/use-api";
import { cn } from "~/lib/utils";

interface Detail {
  contact: Person;
  reasons?: { label: string; points: number }[];
  notes: { id: number; body: string; pinned: number; created: number }[];
  tasks: Task[];
  deals: { id: number; name: string; stage: string; amount: number }[];
  enrollments: { sequence_name?: string; status: string; step?: number }[];
  suppressed: boolean | null | Record<string, unknown>;
  timeline: Activity[];
}

function Fact({ icon: Icon, children }: { icon: typeof PhoneIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-medium text-muted-foreground">{children}</h3>;
}

function Content({ email, onChanged }: { email: string; onChanged: () => void }) {
  const meta = useMeta();
  const detail = useApi<Detail>(`/api/people/get?email=${encodeURIComponent(email)}`);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  if (detail.error) return <div className="p-5"><ErrorNote message={detail.error} onRetry={() => void detail.reload()} /></div>;
  if (!detail.data) return <LoadingRows rows={6} />;
  const { contact: c, notes, tasks, timeline, enrollments, deals } = detail.data;
  const stages = meta?.contact_stages ?? [];
  const stage = stages.find((s) => s.key === c.stage);
  const place = [c.city, c.state, c.country].filter(Boolean).join(", ");

  const setStage = async (key: string) => {
    try {
      await api.post("/api/people/update", { email: c.email, fields: { stage: key } });
      toast("Stage updated");
      await detail.reload();
      onChanged();
    } catch (e) {
      fail(e);
    }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await api.post("/api/notes/add", { ref_type: "contact", ref: c.email, body: note.trim() });
      setNote("");
      await detail.reload();
    } catch (e) {
      fail(e);
    }
    setSaving(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <Avatar name={c.name} email={c.email} className="size-10 text-sm" />
        <div className="min-w-0 flex-1">
          <SheetTitle className="truncate text-base font-semibold">{c.name || c.email}</SheetTitle>
          <p className="truncate text-[13px] text-muted-foreground">{[c.title, c.organization].filter(Boolean).join(" at ")}</p>
          <button
            type="button"
            className="addr mt-1 flex cursor-pointer items-center gap-1.5 text-[13px] hover:text-primary-ink"
            onClick={() => navigator.clipboard?.writeText(c.email).then(() => toast("Address copied"), () => fail("Couldn't copy"))}
          >
            {c.email} <CopyIcon className="size-3 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <Pick label="Stage" value={c.stage} onChange={setStage} options={stages} />
        {stage && <ToneBadge tone={stage.tone}>{stage.label}</ToneBadge>}
        <span className="text-xs text-muted-foreground">Fit {c.fit_score}</span>
        {c.tier === "risky" && <span className="text-xs text-warning-foreground">Risky address</span>}
        {detail.data.suppressed && <span className="text-xs text-error-foreground">Unsubscribed</span>}
        <Button size="xs" variant="outline" className="ms-auto" render={<a href={classic("people", `people/${encodeURIComponent(c.email)}`)} />}>
          Full record
        </Button>
      </div>

      <div className="grid gap-2 border-b border-border px-5 py-4 sm:grid-cols-2">
        {c.organization && <Fact icon={BuildingIcon}>{c.organization}{c.industry ? `, ${c.industry}` : ""}</Fact>}
        {place && <Fact icon={MapPinIcon}>{place}</Fact>}
        {c.phone && <Fact icon={PhoneIcon}>{c.phone}</Fact>}
        {safeUrl(c.website) && (
          <Fact icon={GlobeIcon}>
            <a className="hover:underline" href={safeUrl(c.website)} target="_blank" rel="noreferrer noopener">
              {c.website.replace(/^https?:\/\//, "")}
            </a>
          </Fact>
        )}
        {safeUrl(c.linkedin_url) && (
          <Fact icon={LinkedinIcon}>
            <a className="hover:underline" href={safeUrl(c.linkedin_url)} target="_blank" rel="noreferrer noopener">
              LinkedIn
            </a>
          </Fact>
        )}
      </div>

      {(enrollments.length > 0 || deals.length > 0 || tasks.length > 0) && (
        <div className="border-b border-border px-5 py-4">
          <Heading>In progress</Heading>
          <div className="flex flex-col gap-1.5 text-[13px]">
            {enrollments.map((e, i) => (
              <div key={`e${i}`}>
                Sequence <span className="font-medium">{e.sequence_name || "sequence"}</span> <span className="text-muted-foreground">({e.status})</span>
              </div>
            ))}
            {deals.map((d) => (
              <div key={`d${d.id}`}>
                Deal <span className="font-medium">{d.name}</span> <span className="text-muted-foreground">({d.stage})</span>
              </div>
            ))}
            {tasks
              .filter((t) => t.status === "open")
              .map((t) => {
                const d = due(t.due);
                return (
                  <div key={`t${t.id}`}>
                    Task <span className="font-medium">{t.title}</span>{" "}
                    <span className={cn("text-muted-foreground", d.late && "text-error-foreground")}>({d.label})</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div className="border-b border-border px-5 py-4">
        <Heading>Notes</Heading>
        <div className="flex flex-col gap-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg border border-border bg-muted px-3 py-2 text-[13px] leading-5">
              {n.pinned ? <PinIcon className="me-1.5 inline size-3 text-muted-foreground" /> : null}
              {n.body}
              <div className="mt-1 text-2xs text-muted-foreground">{ago(n.created)}</div>
            </div>
          ))}
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note" aria-label="Add a note" />
          <div>
            <Button size="xs" variant="outline" disabled={!note.trim() || saving} onClick={addNote}>
              Save note
            </Button>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <Heading>Timeline</Heading>
        {timeline.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing has happened with this person yet.</p>}
        <ol className="flex flex-col">
          {timeline.slice(0, 30).map((a) => (
            <li key={a.id} className="relative flex gap-3 pb-3 ps-4 text-[13px] before:absolute before:start-[3px] before:top-2 before:h-full before:w-px before:bg-border last:before:hidden">
              <span className="absolute start-0 top-1.5 size-[7px] rounded-full border border-input bg-card" />
              <div className="min-w-0 flex-1">
                <span className="font-medium">{a.label}</span>
                {a.summary && <span className="text-muted-foreground"> {a.summary}</span>}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{ago(a.ts)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** One person, in a panel on the right, without leaving the table. */
export function PersonSheet({ email, onClose, onChanged }: { email?: string; onClose: () => void; onChanged: () => void }) {
  return (
    <Sheet open={!!email} onOpenChange={(open) => !open && onClose()}>
      <SheetPopup side="right" className="w-[min(34rem,100vw)] max-w-none p-0">
        {email && <Content key={email} email={email} onChanged={onChanged} />}
      </SheetPopup>
    </Sheet>
  );
}
