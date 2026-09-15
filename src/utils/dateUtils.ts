export function isUtcWeekend(date: Date = new Date()): boolean {
  const day = date.getUTCDay();
  return day === 6 || day === 0;
}

export function toIsoDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(isoDate: string): Date {
  const parts = isoDate.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

export function getCurrentOrNextWeekendSaturday(now: Date = new Date()): string {
  const day = now.getUTCDay();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (day === 6) {
    return toIsoDateString(d);
  } else if (day === 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    return toIsoDateString(d);
  } else {
    d.setUTCDate(d.getUTCDate() + (6 - day));
    return toIsoDateString(d);
  }
}

export function getNextSaturdayAfter(saturdayIso: string): string {
  const d = parseIsoDate(saturdayIso);
  d.setUTCDate(d.getUTCDate() + 7);
  return toIsoDateString(d);
}

export function formatWeekendDate(saturdayIso: string): string {
  const d = parseIsoDate(saturdayIso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
