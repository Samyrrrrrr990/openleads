const DAY = 86400;

/** "3h ago", "2d ago", "in 4d". Seconds since the epoch in, plain words out. */
export function ago(ts: number | null | undefined, now: number = Date.now() / 1000): string {
  if (!ts) return "";
  const d = now - ts;
  const a = Math.abs(d);
  const unit = a < 3600 ? `${Math.max(1, Math.round(a / 60))}m` : a < DAY ? `${Math.round(a / 3600)}h` : `${Math.round(a / DAY)}d`;
  return d >= 0 ? `${unit} ago` : `in ${unit}`;
}

export function due(ts: number | null | undefined, now: number = Date.now() / 1000): { label: string; late: boolean } {
  if (!ts) return { label: "No date", late: false };
  const startOfToday = new Date(now * 1000);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((ts - startOfToday.getTime() / 1000) / DAY);
  if (days < 0) return { label: days === -1 ? "Yesterday" : `${-days}d overdue`, late: true };
  if (days === 0) return { label: "Today", late: false };
  if (days === 1) return { label: "Tomorrow", late: false };
  return { label: `In ${days}d`, late: false };
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}

export function money(n: number | null | undefined, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n ?? 0);
  } catch {
    return `$${num(Math.round(n ?? 0))}`;
  }
}

/** The server sends rates as percentages already (13.6 means 13.6%). */
export function pct(percent: number | null | undefined): string {
  const r = percent ?? 0;
  return `${r >= 10 || r === 0 ? Math.round(r) : Math.round(r * 10) / 10}%`;
}

export function initials(name: string | null | undefined, email = ""): string {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email.slice(0, 2) || "?").toUpperCase();
}

export function dayLabel(d: Date = new Date()): string {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
