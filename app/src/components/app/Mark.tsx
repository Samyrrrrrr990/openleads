import { cn } from "~/lib/utils";

import { BRANDS } from "./brand-marks";

/** The OpenLeads mark, the same shape as the favicon: a square with its corner folded. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-6 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M8 8h16L8 24z" fill="#fff" />
    </svg>
  );
}

/**
 * The mark of a service OpenLeads connects to, on a small tile so every mark sits on
 * the same footing whatever its own shape. Unknown names get a monogram.
 */
export function BrandIcon({ name, label, size = "md", className }: { name: string; label?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const mark = BRANDS[name];
  const box = size === "lg" ? "size-10 rounded-xl" : size === "sm" ? "size-5 rounded-md" : "size-8 rounded-lg";
  const glyph = size === "lg" ? "size-5" : size === "sm" ? "size-3" : "size-4";
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center border border-border bg-card text-foreground", box, className)}>
      {name === "microsoft" ? (
        <svg viewBox="0 0 24 24" className={glyph}>
          <rect x="1" y="1" width="10" height="10" fill="#f25022" />
          <rect x="13" y="1" width="10" height="10" fill="#7fba00" />
          <rect x="1" y="13" width="10" height="10" fill="#00a4ef" />
          <rect x="13" y="13" width="10" height="10" fill="#ffb900" />
        </svg>
      ) : mark ? (
        <svg viewBox="0 0 24 24" className={glyph} fill={mark.color || "currentColor"}>
          <path d={mark.path} />
        </svg>
      ) : (
        <span className={cn("font-semibold text-muted-foreground", size === "sm" ? "text-3xs" : "text-xs")}>{(label || name).slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}
