import React, { useMemo, useState } from 'react';
import type { CalendarEvent, Patient } from '../../../../shared/types';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';

interface SidebarCalendarProps {
  events: CalendarEvent[];
  patients: Patient[];
  loading: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
}

const formatTimeRange = (startIso: string, endIso: string): string => {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleTimeString([], opts)} – ${end.toLocaleTimeString([], opts)}`;
};

const linkEventToPatient = (event: CalendarEvent, patients: Patient[]): string | undefined => {
  const title = event.title.trim().toLowerCase();
  if (!title) return undefined;

  const normalize = (name: string) => name.trim().toLowerCase();

  // Exact match on full name
  const byExact = patients.find(p => normalize(p.name) === title);
  if (byExact) return byExact.id;

  // Handle \"Last, First\" vs \"First Last\"
  if (title.includes(',')) {
    const [last, first] = title.split(',').map(s => s.trim());
    const reordered = `${first} ${last}`.toLowerCase();
    const byReordered = patients.find(p => normalize(p.name) === reordered);
    if (byReordered) return byReordered.id;
  }

  return undefined;
};

interface CalendarListProps {
  events: CalendarEvent[];
  patients: Patient[];
  loading: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
}

const CalendarList: React.FC<CalendarListProps> = ({
  events,
  patients,
  loading,
  onSelectEvent,
}) => {
  const enriched = useMemo(
    () =>
      events.map((ev) => {
        const patientId = ev.patientId || linkEventToPatient(ev, patients);
        return { ...ev, patientId };
      }),
    [events, patients]
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-2">
        <Clock size={18} className="animate-spin text-sky-500" />
        <p className="text-xs font-medium">Loading calendar events…</p>
      </div>
    );
  }

  if (enriched.length === 0) {
    return (
      <div className="text-center py-10 text-slate-500 text-sm opacity-60">
        No bookings found for this day.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {enriched.map((ev) => {
        const patient = ev.patientId ? patients.find((p) => p.id === ev.patientId) : undefined;
        const canOpen = Boolean(ev.patientId);
        return (
          <button
            key={ev.id}
            type="button"
            onClick={() => canOpen && onSelectEvent({ ...ev, patientId: ev.patientId })}
            className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all flex flex-col gap-1 ${
              canOpen
                ? 'bg-slate-900/30 border-slate-800 hover:bg-sky-900/40 hover:border-sky-700/60'
                : 'bg-slate-900/10 border-slate-800/60 cursor-default'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-sky-400">
                {formatTimeRange(ev.start, ev.end)}
              </span>
              {patient && (
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-800/60 px-2 py-0.5 rounded-full">
                  {patient.name}
                </span>
              )}
            </div>
            <div className="text-sm font-medium text-slate-100 truncate">{ev.title}</div>
            {ev.location && (
              <div className="text-[11px] text-slate-500 truncate">{ev.location}</div>
            )}
            {!patient && (
              <div className="text-[11px] text-amber-500 mt-1">No matching patient found.</div>
            )}
          </button>
        );
      })}
    </div>
  );
};

interface MiniMonthCalendarProps {
  events: CalendarEvent[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

const buildMonthMatrix = (anchor: Date): Date[][] => {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startDay = firstOfMonth.getDay(); // 0 (Sun) - 6 (Sat)
  const startOffset = (startDay + 6) % 7; // convert to Monday-start (0=Mon)
  const startDate = new Date(year, month, 1 - startOffset);

  const weeks: Date[][] = [];
  let current = new Date(startDate);

  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const MiniMonthCalendar: React.FC<MiniMonthCalendarProps> = ({
  events,
  selectedDate,
  onSelectDate,
}) => {
  const monthMatrix = useMemo(() => buildMonthMatrix(selectedDate), [selectedDate]);
  const today = useMemo(() => new Date(), []);

  const eventDays = useMemo(() => {
    const set = new Set<string>();
    for (const ev of events) {
      const d = new Date(ev.start);
      set.add(d.toISOString().slice(0, 10));
    }
    return set;
  }, [events]);

  const monthLabel = selectedDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const weekdayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <div className="mb-3 rounded-xl border border-slate-800/70 bg-slate-900/60 px-3 pt-3 pb-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-slate-200 uppercase tracking-wider">
          {monthLabel}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="text-[10px] text-slate-500 text-center font-semibold tracking-wide"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {monthMatrix.flat().map((date) => {
          const inMonth = date.getMonth() === selectedDate.getMonth();
          const key = date.toISOString().slice(0, 10);
          const hasEvent = eventDays.has(key);
          const isToday = isSameDay(date, today);
          const isSelected = isSameDay(date, selectedDate);

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(date)}
              className={[
                'h-7 rounded-lg flex flex-col items-center justify-center text-[11px] font-medium transition-colors border',
                inMonth ? 'border-transparent' : 'border-slate-800/60',
                isSelected
                  ? 'bg-sky-600 text-white border-sky-400'
                  : isToday
                  ? 'bg-slate-800 text-slate-100 border-slate-700'
                  : 'bg-slate-900/40 text-slate-400 hover:bg-slate-800 hover:text-slate-100',
              ].join(' ')}
            >
              <span>{date.getDate()}</span>
              {hasEvent && (
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const SidebarCalendar: React.FC<SidebarCalendarProps> = ({
  events,
  patients,
  loading,
  onSelectEvent,
}) => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const todayLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    [selectedDate]
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 custom-scrollbar">
      <div className="flex items-center gap-2 px-2 mb-3">
        <CalendarIcon size={14} className="text-sky-500" />
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Bookings
        </h3>
        <span className="ml-auto text-[11px] text-slate-500">{todayLabel}</span>
      </div>

      <MiniMonthCalendar
        events={events}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      <CalendarList
        events={events}
        patients={patients}
        loading={loading}
        onSelectEvent={onSelectEvent}
      />
    </div>
  );
};

