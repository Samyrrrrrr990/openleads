import { ChevronDownIcon } from "lucide-react";

import { cn } from "~/lib/utils";

export interface Option {
  key: string;
  label: string;
}

/** A compact native select: the system's own menu, keyboard and screen reader behaviour. */
export function Pick({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (key: string) => void;
  options: Option[];
  className?: string;
}) {
  return (
    <label className={cn("relative inline-flex h-8 items-center rounded-lg border border-input bg-card text-[13px] shadow-xs/5 focus-within:border-ring sm:h-7", className)}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full cursor-pointer appearance-none rounded-lg bg-transparent ps-2.5 pe-7 outline-none"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute end-2 size-3.5 text-muted-foreground" />
    </label>
  );
}
