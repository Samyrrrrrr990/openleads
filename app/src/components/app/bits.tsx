import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { initials } from "~/lib/format";
import { cn } from "~/lib/utils";

/** A quiet round monogram. The colour is picked from the address so it stays the same. */
export function Avatar({ name, email, className }: { name?: string; email?: string; className?: string }) {
  const seed = (email || name || "?").split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      aria-hidden
      className={cn("grid size-7 shrink-0 place-items-center rounded-full text-2xs font-semibold", className)}
      style={{
        background: `color-mix(in oklab, oklch(0.7 0.11 ${seed}) 22%, var(--card))`,
        color: `color-mix(in oklab, oklch(0.5 0.13 ${seed}) 70%, var(--foreground))`,
      }}
    >
      {initials(name, email)}
    </span>
  );
}

const TONES: Record<string, "secondary" | "info" | "success" | "warning" | "error" | "outline"> = {
  neutral: "secondary",
  info: "info",
  good: "success",
  warn: "warning",
  bad: "error",
  violet: "info",
};

export function ToneBadge({ tone, children }: { tone?: string; children: ReactNode }) {
  return <Badge variant={TONES[tone || "neutral"] ?? "secondary"}>{children}</Badge>;
}

/** A titled block of rows, the unit every screen is built from. */
export function Panel({
  title,
  count,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}>
      {title !== undefined && (
        <header className="flex h-10 items-center gap-2 border-b border-border px-3.5">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
          <div className="ms-auto flex items-center gap-1.5">{action}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Row({ children, className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex items-start gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0", className)} {...props}>
      {children}
    </div>
  );
}

export function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("px-3.5 py-6 text-center text-[13px] text-muted-foreground", className)}>{children}</p>;
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-3.5" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5" style={{ width: `${88 - i * 13}%` }} />
      ))}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-error/25 bg-error-surface px-3.5 py-2.5 text-[13px] text-error-foreground">
      <AlertTriangleIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <Button size="xs" variant="outline" onClick={onRetry}>
          <RefreshCwIcon /> Try again
        </Button>
      )}
    </div>
  );
}

/** The page body: scrolls, centred, with the reading width of the conversation column or wider. */
export function Body({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto flex w-full flex-col gap-5 px-5 py-6 max-md:px-3 max-md:py-4", wide ? "max-w-6xl" : "max-w-[var(--content-max)]", className)}>
        {children}
      </div>
    </div>
  );
}

/** One number with its name above and a line of context below. */
export function Stat({
  label,
  value,
  note,
  href,
  children,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  href?: string;
  children?: ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-end gap-3">
        <div className="text-2xl font-semibold leading-8 tracking-tight tabular-nums">{value}</div>
        {/* A small trend rides beside the number, so every tile keeps the same height. */}
        {children && <div className="mb-1 ms-auto w-24 max-w-[45%] shrink-0">{children}</div>}
      </div>
      <div className="mt-0.5 min-h-4 truncate text-xs text-muted-foreground">{note}</div>
    </>
  );
  const cls = cn("block rounded-xl border border-border bg-card px-4 py-3.5", href && "transition-colors hover:border-input", className);
  return href ? (
    <a href={href} className={cls}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}
