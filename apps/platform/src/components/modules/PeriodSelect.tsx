"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Globe } from "lucide-react";
import { buttonClass } from "@/components/ui/Button";
import {
  PERIOD_RANGES,
  addIsoDays,
  analyticsSearch,
  matchingPreset,
  periodLabel,
  presetWindow,
  todayIso,
  type PeriodRangeId,
} from "@/lib/period-options";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function monthKey(iso: string) {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

function monthGrid(year: number, month: number) {
  const first = `${year}-${pad(month)}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const lead = weekday === 0 ? 6 : weekday - 1;
  const start = addIsoDays(first, -lead);
  return Array.from({ length: 42 }, (_, index) => {
    const iso = addIsoDays(start, index);
    return { iso, inMonth: iso.slice(0, 7) === first.slice(0, 7), day: Number(iso.slice(8, 10)) };
  });
}

function pickerDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function ordered(a: string, b: string) {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

export function PeriodSelect({ clientId, websiteId, range, from, to }: { clientId: string; websiteId?: string | null; range: PeriodRangeId; from?: string; to?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const today = todayIso();
  const applied = range === "custom" && from && to ? { start: from, end: to } : presetWindow(range, today) ?? presetWindow("last30", today)!;
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<PeriodRangeId>(range === "custom" ? "custom" : matchingPreset(applied.start, applied.end, today));
  const [draftStart, setDraftStart] = useState(applied.start);
  const [draftEnd, setDraftEnd] = useState(applied.end);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const initialMonth = monthKey(applied.start);
  const [visible, setVisible] = useState(initialMonth);
  const appliedKey = `${range}|${from ?? ""}|${to ?? ""}`;
  const [seenKey, setSeenKey] = useState(appliedKey);
  if (seenKey !== appliedKey) {
    setSeenKey(appliedKey);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openPanel() {
    const next = range === "custom" && from && to ? { start: from, end: to } : presetWindow(range, today) ?? applied;
    setPreset(range === "custom" ? "custom" : matchingPreset(next.start, next.end, today));
    setDraftStart(next.start);
    setDraftEnd(next.end);
    setAnchor(null);
    setHover(null);
    setVisible(monthKey(next.start));
    setOpen(true);
  }

  function choosePreset(id: PeriodRangeId) {
    const window = presetWindow(id, today);
    if (!window) {
      setPreset("custom");
      setAnchor(null);
      return;
    }
    setPreset(id);
    setDraftStart(window.start);
    setDraftEnd(window.end);
    setAnchor(null);
    setHover(null);
    setVisible(monthKey(window.start));
  }

  function chooseDay(iso: string) {
    if (iso > today) return;
    if (!anchor) {
      setAnchor(iso);
      setDraftStart(iso);
      setDraftEnd(iso);
      setPreset("custom");
      return;
    }
    const next = ordered(anchor, iso);
    setDraftStart(next.start);
    setDraftEnd(next.end);
    setPreset(matchingPreset(next.start, next.end, today));
    setAnchor(null);
    setHover(null);
  }

  function shiftMonth(amount: number) {
    const cursor = new Date(Date.UTC(visible.year, visible.month - 1 + amount, 1));
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const current = monthKey(today);
    if (year > current.year || (year === current.year && month > current.month)) return;
    if (year < current.year - 2) return;
    setVisible({ year, month });
  }

  function apply() {
    const nextPreset = matchingPreset(draftStart, draftEnd, today);
    const query = analyticsSearch(clientId, nextPreset, draftStart, draftEnd, websiteId ?? undefined);
    setOpen(false);
    router.push(`${pathname}?${query}`);
  }

  const preview = anchor && hover ? ordered(anchor, hover) : { start: draftStart, end: draftEnd };
  const days = monthGrid(visible.year, visible.month);
  const currentMonth = monthKey(today);
  const atCurrentMonth = visible.year === currentMonth.year && visible.month === currentMonth.month;
  const atOldestMonth = visible.year === currentMonth.year - 2 && visible.month === 1;
  const years = [currentMonth.year - 2, currentMonth.year - 1, currentMonth.year];
  const buttonText = range === "custom" && from && to ? `${pickerDate(from)} – ${pickerDate(to)}` : periodLabel(range);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`inline-flex min-h-10 items-center gap-2.5 rounded-xl border bg-surface py-2 pl-4 pr-4 text-sm font-medium text-ink ${open ? "border-action shadow-[0_0_0_3px_rgba(19,108,114,0.16)]" : "border-line"}`}
      >
        <Calendar className="size-4 text-ink-soft" aria-hidden="true" />
        {buttonText}
        <ChevronDown className="size-4 text-ink-soft" aria-hidden="true" />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a period" className="absolute left-0 z-40 mt-2 w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_16px_40px_rgba(23,60,64,0.14)]">
          <div className="grid md:grid-cols-[11.5rem_minmax(0,1fr)]">
            <ul role="listbox" aria-label="Period" className="border-b border-line py-2 md:border-r md:border-b-0">
              {PERIOD_RANGES.map((item) => {
                const selected = item.id === preset;
                return (
                  <li key={item.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`mx-2 my-0.5 block w-[calc(100%-1rem)] rounded-lg px-3 py-2 text-left text-sm ${selected ? "bg-action font-medium text-white" : "text-ink hover:bg-brand-pale"}`}
                      onClick={() => choosePreset(item.id)}
                    >
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <button type="button" aria-label="Previous month" disabled={atOldestMonth} onClick={() => shiftMonth(-1)} className="grid size-8 place-items-center rounded-full text-ink-soft hover:bg-brand-pale disabled:opacity-30">
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </button>
                <div className="flex items-center gap-2">
                  <label className="relative">
                    <span className="sr-only">Month</span>
                    <select
                      aria-label="Month"
                      value={visible.month}
                      onChange={(event) => setVisible({ year: visible.year, month: Number(event.target.value) })}
                      className="appearance-none bg-transparent py-1 pr-6 text-sm font-semibold text-ink"
                    >
                      {MONTHS.map((name, index) => (
                        <option key={name} value={index + 1} disabled={visible.year === currentMonth.year && index + 1 > currentMonth.month}>{name}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute top-1/2 right-0 size-3.5 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
                  </label>
                  <label className="relative">
                    <span className="sr-only">Year</span>
                    <select
                      aria-label="Year"
                      value={visible.year}
                      onChange={(event) => {
                        const year = Number(event.target.value);
                        const month = year === currentMonth.year ? Math.min(visible.month, currentMonth.month) : visible.month;
                        setVisible({ year, month });
                      }}
                      className="appearance-none bg-transparent py-1 pr-6 text-sm font-semibold text-ink"
                    >
                      {years.map((year) => <option key={year} value={year}>{year}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute top-1/2 right-0 size-3.5 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
                  </label>
                </div>
                <button type="button" aria-label="Next month" disabled={atCurrentMonth} onClick={() => shiftMonth(1)} className="grid size-8 place-items-center rounded-full text-ink-soft hover:bg-brand-pale disabled:opacity-30">
                  <ChevronRight className="size-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-7 text-center text-xs font-medium text-muted">
                {WEEKDAYS.map((day) => <div key={day} className="py-1">{day}</div>)}
              </div>
              <div className="grid grid-cols-7" role="grid" aria-label={`${MONTHS[visible.month - 1]} ${visible.year}`}>
                {days.map((cell) => {
                  const inRange = cell.iso >= preview.start && cell.iso <= preview.end;
                  const endpoint = cell.iso === preview.start || cell.iso === preview.end;
                  const future = cell.iso > today;
                  const band = inRange && preview.start !== preview.end
                    ? cell.iso === preview.start
                      ? "left-1/2 right-0"
                      : cell.iso === preview.end
                        ? "left-0 right-1/2"
                        : "inset-x-0"
                    : "";
                  return (
                    <div key={cell.iso} className="relative flex h-9 items-center justify-center">
                      {band && <span className={`absolute inset-y-1 ${band} bg-brand-pale`} aria-hidden="true" />}
                      <button
                        type="button"
                        disabled={future}
                        onClick={() => chooseDay(cell.iso)}
                        onMouseEnter={() => setHover(cell.iso)}
                        onMouseLeave={() => setHover(null)}
                        className={`relative grid size-8 place-items-center rounded-full text-sm ${endpoint ? "bg-action font-semibold text-white" : future ? "text-muted/40" : cell.inMonth ? "text-ink hover:bg-brand-pale" : "text-muted"}`}
                      >
                        {cell.day}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink">{pickerDate(preview.start)} - {pickerDate(preview.end)}</p>
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted"><Globe className="size-3.5" aria-hidden="true" />GMT +08:00</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={`${buttonClass("secondary", "sm")} rounded-full px-4`} onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className={`${buttonClass("primary", "sm")} rounded-full px-4`} onClick={apply}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
