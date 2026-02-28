"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemedSelect } from "@/components/ui/themed-select";

type DateTimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
};

function parseLocalValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const dt = new Date(y, mo, d, h, mi, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toLocalValue(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

function startOfGrid(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  return new Date(first.getFullYear(), first.getMonth(), first.getDate() - first.getDay());
}

export function DateTimePicker({
  value,
  onChange,
  className,
  placeholder = "Pick date & time",
}: DateTimePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => parseLocalValue(value), [value]);
  const fallbackNow = useMemo(() => new Date(), []);
  const base = parsed || fallbackNow;

  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1));

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    const date = parseLocalValue(value);
    if (!date) return;
    setViewMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }, [value]);

  const monthDays = useMemo(() => {
    const start = startOfGrid(viewMonth);
    const out: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      out.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return out;
  }, [viewMonth]);

  const selected = parsed || base;
  const selectedDay = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()).getTime();
  const hour24 = selected.getHours();
  const period: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour12 = ((hour24 + 11) % 12) + 1;

  const setDay = useCallback(
    (day: Date) => {
      const next = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        selected.getHours(),
        selected.getMinutes(),
        0,
        0
      );
      onChange(toLocalValue(next));
    },
    [onChange, selected]
  );

  const setHour12 = useCallback(
    (hourValue: string) => {
      const hour = Number(hourValue);
      if (!Number.isFinite(hour) || hour < 1 || hour > 12) return;
      let nextHour = hour % 12;
      if (period === "PM") nextHour += 12;
      const next = new Date(selected);
      next.setHours(nextHour);
      onChange(toLocalValue(next));
    },
    [onChange, period, selected]
  );

  const setMinute = useCallback(
    (minuteValue: string) => {
      const minute = Number(minuteValue);
      if (!Number.isFinite(minute) || minute < 0 || minute > 59) return;
      const next = new Date(selected);
      next.setMinutes(minute);
      onChange(toLocalValue(next));
    },
    [onChange, selected]
  );

  const setPeriod = useCallback(
    (nextPeriod: string) => {
      const target = nextPeriod === "PM" ? "PM" : "AM";
      let nextHour = selected.getHours();
      if (target === "AM" && nextHour >= 12) nextHour -= 12;
      if (target === "PM" && nextHour < 12) nextHour += 12;
      const next = new Date(selected);
      next.setHours(nextHour);
      onChange(toLocalValue(next));
    },
    [onChange, selected]
  );

  const display = parsed
    ? parsed.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-foreground/15 bg-muted/70 px-3 py-2 text-left text-sm text-foreground/90 shadow-inner transition-colors hover:bg-background/85"
      >
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <span className={cn("flex-1 truncate", !display && "text-muted-foreground/70")}>{display || placeholder}</span>
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-[19rem] rounded-xl border border-foreground/10 bg-card p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="rounded-md p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-semibold text-foreground">
              {viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              className="rounded-md p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {["S", "M", "T", "W", "T", "F", "S"].map((d) => (
              <div key={d} className="py-1">{d}</div>
            ))}
            {monthDays.map((day) => {
              const inMonth = day.getMonth() === viewMonth.getMonth();
              const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
              const isSelected = dayStart === selectedDay;
              return (
                <button
                  key={`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`}
                  type="button"
                  onClick={() => setDay(day)}
                  className={cn(
                    "h-8 rounded-md text-xs transition-colors",
                    isSelected
                      ? "bg-sky-300/20 text-sky-100"
                      : "text-foreground/85 hover:bg-sky-300/15",
                    !inMonth && "text-muted-foreground/45"
                  )}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-muted-foreground" />
            <ThemedSelect
              value={String(hour12).padStart(2, "0")}
              onChange={setHour12}
              options={Array.from({ length: 12 }, (_, idx) => {
                const hour = String(idx + 1).padStart(2, "0");
                return { value: hour, label: hour };
              })}
              className="flex-1"
              size="compact"
            />
            <span className="text-xs text-muted-foreground">:</span>
            <ThemedSelect
              value={String(selected.getMinutes()).padStart(2, "0")}
              onChange={setMinute}
              options={Array.from({ length: 12 }, (_, i) => i * 5).map((m) => {
                const minute = String(m).padStart(2, "0");
                return { value: minute, label: minute };
              })}
              className="flex-1"
              size="compact"
            />
            <ThemedSelect
              value={period}
              onChange={setPeriod}
              options={[{ value: "AM", label: "AM" }, { value: "PM", label: "PM" }]}
              className="w-[4.5rem]"
              size="compact"
            />
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                onChange(toLocalValue(now));
                setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              }}
              className="rounded-md border border-foreground/10 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Now
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-sky-300"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
