import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { initials } from "~/lib/format";
import { cn } from "~/lib/utils";

/** A quiet round monogram in the app's own greys, so a list of people stays calm. */
export function Avatar({ name, email, className }: { name?: string; email?: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-full bg-accent text-2xs font-semibold text-muted-foreground", className)}>
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
        <header className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3.5 py-1.5">
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
    <div className={cn("flex items-start gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0 max-md:py-3", className)} {...props}>
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

/** The page body. Every screen shares one width and one left edge, the same as the header's. */
export function Body({ children, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto flex w-full max-w-[var(--page-max)] flex-col gap-5 px-6 py-6 max-md:px-4 max-md:py-4", className)}>
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
      <div className="mt-1 flex h-8 items-center gap-3">
        <div className="text-2xl font-semibold leading-8 tracking-tight tabular-nums">{value}</div>
        {/* A small trend rides beside the number, so every tile keeps the same height. */}
        {children && <div className="ms-auto w-24 max-w-[45%] shrink-0">{children}</div>}
      </div>
      <div className="mt-0.5 line-clamp-2 min-h-4 text-xs leading-4 text-muted-foreground">{note}</div>
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

/** A smaller number inside a panel: what it is, the number, and what it is out of. */
export function Figure({ label, value, note, to, children }: { label: string; value: ReactNode; note?: ReactNode; to?: string; children?: ReactNode }) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex h-7 items-center gap-2">
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        {children && <span className="ms-auto w-16 shrink-0">{children}</span>}
      </div>
      {note !== undefined && <div className="line-clamp-2 text-xs leading-4 text-muted-foreground">{note}</div>}
    </>
  );
  return to ? (
    <a href={to} className="block px-3.5 py-3 transition-colors hover:bg-accent/60">
      {body}
    </a>
  ) : (
    <div className="px-3.5 py-3">{body}</div>
  );
}
