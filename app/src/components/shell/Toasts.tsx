import { useToasts } from "~/lib/toast";
import { cn } from "~/lib/utils";

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] max-md:bottom-[4.5rem] flex flex-col items-center gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "dropdown-glass pointer-events-auto max-w-[min(92vw,32rem)] rounded-xl px-3.5 py-2 text-[13px] shadow-lg",
            "pop-in",
            t.tone === "error" && "text-error-foreground",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
