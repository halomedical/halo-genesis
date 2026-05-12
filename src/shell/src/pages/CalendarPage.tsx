import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent, DriveFile, Patient } from '../../../../shared/types';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Plus,
  X,
} from 'lucide-react';
import {
  fetchEventsInRange,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEventAttachments,
  fetchFilesFirstPage,
  type CalendarEventCreatePayload,
  type CalendarEventUpdatePayload,
} from '../services/api';

interface Props {
  patients: Patient[];
  onSelectPatientFromEvent?: (event: CalendarEvent) => void;
  onClose?: () => void;
}

interface EventEditorState {
  id?: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  patientId?: string;
}

type CalendarViewMode = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth';

const VIEW_OPTIONS: Array<{ id: CalendarViewMode; label: string }> = [
  { id: 'dayGridMonth', label: 'month' },
  { id: 'timeGridWeek', label: 'week' },
  { id: 'timeGridDay', label: 'day' },
];

const getBrowserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatLocalDateTimeInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  return [
    `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`,
    `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`,
  ].join('T');
}

function parseLocalDateTimeInput(value: string): string {
  if (!value) return '';

  const [datePart, timePart = '00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);
  const localDate = new Date(
    year,
    (month || 1) - 1,
    day || 1,
    hours || 0,
    minutes || 0,
    0,
    0
  );

  return localDate.toISOString();
}

const findPatientName = (patients: Patient[], id?: string) =>
  id ? patients.find((p) => p.id === id)?.name ?? '' : '';

const PICKER_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildPickerDays(month: Date, selectedDate: Date) {
  const monthStart = startOfMonth(month);
  const gridStart = new Date(monthStart);
  const dayOffset = (monthStart.getDay() + 6) % 7;
  gridStart.setDate(monthStart.getDate() - dayOffset);
  const today = new Date();

  return Array.from({ length: 42 }).map((_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      iso: date.toISOString(),
      date,
      isCurrentMonth: date.getMonth() === month.getMonth(),
      isSelected: isSameDay(date, selectedDate),
      isToday: isSameDay(date, today),
    };
  });
}

export const CalendarPage: React.FC<Props> = ({
  patients,
  onSelectPatientFromEvent,
  onClose,
}) => {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentRange, setCurrentRange] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const [currentView, setCurrentView] = useState<CalendarViewMode>('timeGridWeek');
  const [currentTitle, setCurrentTitle] = useState('');
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [pickerMonth, setPickerMonth] = useState(() => startOfMonth(new Date()));
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorState, setEditorState] = useState<EventEditorState | null>(null);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachmentFiles, setAttachmentFiles] = useState<DriveFile[]>([]);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);

  const timeZone = useMemo(getBrowserTimeZone, []);

  useEffect(() => {
    setPickerMonth(startOfMonth(currentDate));
  }, [currentDate]);

  const loadEvents = useCallback(
    async (startIso: string, endIso: string) => {
      setLoading(true);
      try {
        const { events: fetched } = await fetchEventsInRange(
          startIso,
          endIso,
          timeZone
        );
        setEvents(fetched);
        setCurrentRange({ start: startIso, end: endIso });
      } catch {
        setEvents([]);
      }
      setLoading(false);
    },
    [timeZone]
  );

  const handleDatesSet = useCallback(
    (arg: any) => {
      const startIso = arg.start?.toISOString?.() ?? arg.startStr;
      const endIso = arg.end?.toISOString?.() ?? arg.endStr;
      if (startIso && endIso) {
        void loadEvents(startIso, endIso);
      }
      setCurrentView(arg.view.type as CalendarViewMode);
      setCurrentTitle(arg.view.title || '');
      const apiDate =
        calendarRef.current?.getApi().getDate() ??
        arg.view?.calendar?.getDate?.() ??
        arg.start ??
        new Date();
      setCurrentDate(new Date(apiDate));
    },
    [loadEvents]
  );

  const handleChangeView = useCallback((view: CalendarViewMode) => {
    calendarRef.current?.getApi().changeView(view);
  }, []);

  const handleMoveCalendar = useCallback((direction: 'prev' | 'next' | 'today') => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (direction === 'prev') api.prev();
    if (direction === 'next') api.next();
    if (direction === 'today') api.today();
  }, []);

  const handlePickDate = useCallback((date: Date) => {
    calendarRef.current?.getApi().gotoDate(date);
  }, []);

  const openCreateEditor = useCallback(
    (start: Date, end: Date) => {
      const startIso = start.toISOString();
      const endIso = end.toISOString();
      setEditorState({
        title: '',
        start: startIso,
        end: endIso,
      });
      setEditorOpen(true);
    },
    []
  );

  const openEditEditor = useCallback((ev: CalendarEvent) => {
    setEditorState({
      id: ev.id,
      title: ev.title,
      start: ev.start,
      end: ev.end,
      description: ev.description,
      location: ev.location,
      patientId: ev.patientId,
    });
    setEditorOpen(true);
  }, []);

  const closeEditor = () => {
    setEditorOpen(false);
    setEditorState(null);
  };

  const handleSaveEditor = async () => {
    if (!editorState) return;
    const { id, title, start, end, description, location, patientId } =
      editorState;
    if (!title.trim() || !start || !end) return;

    setSaving(true);
    try {
      const payload: CalendarEventCreatePayload = {
        title: title.trim(),
        start,
        end,
        timeZone,
        description: description?.trim() || undefined,
        location: location?.trim() || undefined,
        patientId: patientId || undefined,
      };

      if (!id) {
        const { event } = await createCalendarEvent(payload);
        setEvents((prev) => [...prev, event]);
      } else {
        const updatePayload: CalendarEventUpdatePayload = payload;
        const { event } = await updateCalendarEvent(id, updatePayload);
        setEvents((prev) =>
          prev.map((e) => (e.id === event.id ? event : e))
        );
      }
      closeEditor();
    } catch {
      // Errors surface through global handling in App.
    }
    setSaving(false);
  };

  const handleDeleteFromEditor = async () => {
    if (!editorState?.id) return;
    setSaving(true);
    try {
      await deleteCalendarEvent(editorState.id);
      setEvents((prev) => prev.filter((e) => e.id !== editorState.id));
      closeEditor();
    } catch {
      // Errors surface through global handling in App.
    }
    setSaving(false);
  };

  const handleEventClick = useCallback(
    (info: any) => {
      const full: CalendarEvent | undefined =
        info.event.extendedProps?.haloEvent || events.find(
          (e) => e.id === info.event.id
        );

      if (!full) return;

      openEditEditor(full);
    },
    [events, openEditEditor]
  );

  const openAttachments = async () => {
    if (!editorState?.id || !editorState.patientId) return;
    setAttachmentsOpen(true);
    setAttachmentLoading(true);
    setAttachmentFiles([]);
    setSelectedAttachmentIds([]);
    try {
      const { files } = await fetchFilesFirstPage(editorState.patientId, 100);
      setAttachmentFiles(files);
      const current = events.find((e) => e.id === editorState.id);
      if (current?.attachments && current.attachments.length > 0) {
        setSelectedAttachmentIds(current.attachments.map((a) => a.fileId));
      }
    } catch {
      setAttachmentFiles([]);
    }
    setAttachmentLoading(false);
  };

  const toggleAttachmentSelection = (fileId: string) => {
    setSelectedAttachmentIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  const saveAttachments = async () => {
    if (!editorState?.id) return;
    setAttachmentLoading(true);
    try {
      const { event } = await updateCalendarEventAttachments(
        editorState.id,
        selectedAttachmentIds
      );
      setEvents((prev) => prev.map((e) => (e.id === event.id ? event : e)));
      setAttachmentsOpen(false);
    } catch {
      // rely on global error handling
    }
    setAttachmentLoading(false);
  };

  const handleEventDropOrResize = useCallback(
    async (info: any) => {
      const id = info.event.id as string;
      const newStart = info.event.start?.toISOString();
      const newEnd = info.event.end?.toISOString();
      if (!newStart || !newEnd) return;

      try {
        const { event } = await updateCalendarEvent(id, {
          start: newStart,
          end: newEnd,
          timeZone,
        });
        setEvents((prev) =>
          prev.map((e) => (e.id === event.id ? event : e))
        );
      } catch {
        info.revert();
      }
    },
    [timeZone]
  );

  const fcEvents = useMemo(
    () =>
      events.map((ev) => ({
        id: ev.id,
        title: ev.title,
        start: ev.start,
        end: ev.end,
        backgroundColor: ev.color || '#4ea9db',
        borderColor: ev.color || '#3597cf',
        classNames: ['halo-calendar-event'],
        extendedProps: {
          haloEvent: ev,
          patientName: findPatientName(patients, ev.patientId),
        },
      })),
    [events, patients]
  );

  const currentRangeLabel = useMemo(() => {
    if (!currentRange) return '';
    const start = new Date(currentRange.start);
    const end = new Date(currentRange.end);
    end.setDate(end.getDate() - 1);
    const fmt: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    };
    return `${start.toLocaleDateString(undefined, fmt)} - ${end.toLocaleDateString(
      undefined,
      fmt
    )}`;
  }, [currentRange]);

  const selectedDateLabel = useMemo(
    () =>
      currentDate.toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    [currentDate]
  );

  const pickerDays = useMemo(
    () => buildPickerDays(pickerMonth, currentDate),
    [currentDate, pickerMonth]
  );

  return (
    <div className="halo-calendar-page flex h-full flex-col bg-[linear-gradient(180deg,#f6fbfe_0%,#edf7fb_100%)]">
      <div className="border-b border-[#dceaf2] bg-white/92 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-5 md:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-[linear-gradient(180deg,#ebf9fd_0%,#dff4fb_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
              <CalendarIcon className="text-[#2fa7c8]" size={24} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#6aa9c6]">
                Calendar
              </p>
              <h1 className="text-[28px] font-semibold tracking-tight text-slate-800">
                Schedule
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Cleaner weekly planning with the same booking tools underneath.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d8e7ef] bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm">
              <Clock className="h-3.5 w-3.5 text-[#55a9d3]" />
              {timeZone}
            </div>
            {currentRangeLabel && (
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8e7ef] bg-[#f8fcfe] px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm">
                <CalendarIcon className="h-3.5 w-3.5 text-[#55a9d3]" />
                {currentRangeLabel}
              </div>
            )}
            {loading && (
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8e7ef] bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#55a9d3]" />
                Refreshing
              </div>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#d8e7ef] bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
                Close
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto grid h-full max-w-[1500px] min-h-0 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="flex min-h-[340px] flex-col overflow-hidden rounded-[30px] border border-[#dbe9f1] bg-white p-5 shadow-[0_22px_55px_-36px_rgba(15,23,42,0.4)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#86adc2]">
                  Select Date
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-800">
                  {selectedDateLabel}
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Choose a day to anchor the schedule, then switch between day, week, and month.
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-[20px] bg-[#ebf8fc] text-[#2fa7c8]">
                <CalendarIcon className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between rounded-[24px] border border-[#e4eff5] bg-[#fbfdff] px-3 py-2 shadow-sm">
              <button
                type="button"
                onClick={() => setPickerMonth((prev) => addMonths(prev, -1))}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-slate-500 transition hover:bg-[#eef8fc] hover:text-[#3794c6]"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-center">
                <p className="text-lg font-semibold text-slate-800">
                  {pickerMonth.toLocaleDateString(undefined, {
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerMonth((prev) => addMonths(prev, 1))}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-slate-500 transition hover:bg-[#eef8fc] hover:text-[#3794c6]"
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-7 gap-2 text-center">
              {PICKER_DAY_LABELS.map((label) => (
                <span
                  key={label}
                  className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400"
                >
                  {label}
                </span>
              ))}
              {pickerDays.map((day) => (
                <button
                  key={day.iso}
                  type="button"
                  onClick={() => handlePickDate(day.date)}
                  className={`flex aspect-square items-center justify-center rounded-[18px] border text-sm font-semibold transition ${
                    day.isSelected
                      ? 'border-[#39a9c9] bg-[#39a9c9] text-white shadow-[0_12px_24px_-16px_rgba(57,169,201,0.85)]'
                      : day.isToday
                        ? 'border-[#b9e3ef] bg-[#eef9fd] text-[#278cb1]'
                        : day.isCurrentMonth
                          ? 'border-[#e4eef4] bg-white text-slate-700 hover:border-[#b8dceb] hover:bg-[#f5fbfe]'
                          : 'border-[#edf2f6] bg-[#f5f8fb] text-slate-300 hover:text-slate-400'
                  }`}
                >
                  {day.date.getDate()}
                </button>
              ))}
            </div>

            <div className="mt-auto pt-5">
              <button
                type="button"
                onClick={() => handleMoveCalendar('today')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[22px] border border-[#d8e7ef] bg-[#f8fcfe] px-4 py-3 text-sm font-semibold text-[#2f84b4] transition hover:border-[#a9d7e8] hover:bg-white"
              >
                <CalendarIcon className="h-4 w-4" />
                Jump to today
              </button>
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-[#dbe9f1] bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.35)]">
            <div className="border-b border-[#e6eff5] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbfd_100%)] px-4 py-4 md:px-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-col gap-2">
                  <div className="inline-flex w-fit items-center gap-2 rounded-full bg-[#eef8fc] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#67a7c7]">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    Day / Week / Month
                  </div>
                  <div>
                    <h2 className="text-3xl font-semibold tracking-tight text-slate-800">
                      {currentTitle || 'Schedule'}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Drag to move, resize to extend, and click any booking to edit it.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                  <div className="inline-flex items-center rounded-[22px] border border-[#d7e6ef] bg-white p-1 shadow-sm">
                    <button
                      type="button"
                      onClick={() => handleMoveCalendar('prev')}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-[18px] text-slate-500 transition hover:bg-[#eff8fc] hover:text-[#3794c6]"
                      aria-label="Previous period"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveCalendar('next')}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-[18px] text-slate-500 transition hover:bg-[#eff8fc] hover:text-[#3794c6]"
                      aria-label="Next period"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveCalendar('today')}
                      className="ml-1 inline-flex h-11 items-center justify-center rounded-[18px] bg-[#39a9c9] px-4 text-sm font-semibold text-white transition hover:bg-[#278cb1]"
                    >
                      Today
                    </button>
                  </div>

                  <div className="inline-flex items-center rounded-[22px] border border-[#d7e6ef] bg-[#f8fbfd] p-1 shadow-sm">
                    {VIEW_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => handleChangeView(option.id)}
                        className={`inline-flex h-11 items-center justify-center rounded-[18px] px-4 text-sm font-semibold capitalize transition ${
                          currentView === option.id
                            ? 'bg-[#1d3554] text-white shadow-sm'
                            : 'text-slate-500 hover:bg-white hover:text-[#3794c6]'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-hidden bg-[#f5fafc] p-3 md:p-4">
              <div className="halo-calendar h-full overflow-hidden rounded-[26px] border border-[#dce9f1] bg-white">
                <FullCalendar
                  ref={calendarRef}
                  plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                  initialView="timeGridWeek"
                  headerToolbar={false}
                  height="100%"
                  events={fcEvents}
                  selectable
                  selectMirror
                  editable
                  eventResizableFromStart
                  slotMinTime="06:00:00"
                  slotMaxTime="20:00:00"
                  weekends
                  nowIndicator
                  stickyHeaderDates
                  allDaySlot
                  expandRows
                  firstDay={1}
                  slotLabelFormat={{
                    hour: 'numeric',
                    minute: '2-digit',
                    meridiem: 'short',
                  }}
                  eventTimeFormat={{
                    hour: 'numeric',
                    minute: '2-digit',
                    meridiem: 'short',
                  }}
                  dayHeaderContent={(arg) => (
                    <div className="flex flex-col items-center py-1">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        {arg.date.toLocaleDateString(undefined, { weekday: 'short' })}
                      </span>
                      <span className="mt-1 text-sm font-semibold text-slate-700">
                        {arg.date.toLocaleDateString(undefined, { day: 'numeric' })}
                      </span>
                    </div>
                  )}
                  datesSet={handleDatesSet}
                  select={(arg) => openCreateEditor(arg.start, arg.end)}
                  eventClick={handleEventClick}
                  eventDrop={handleEventDropOrResize}
                  eventResize={handleEventDropOrResize}
                  eventContent={(arg) => {
                    const patientName = arg.event.extendedProps?.patientName as string | undefined;
                    return (
                      <div className="halo-calendar-event-inner">
                        <div className="truncate text-[11px] font-semibold text-slate-800">
                          {arg.timeText ? `${arg.timeText} - ${arg.event.title}` : arg.event.title}
                        </div>
                        {patientName && (
                          <div className="truncate text-[10px] text-slate-500">
                            {patientName}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      {editorOpen && editorState && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-editor-title"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2
                  id="event-editor-title"
                  className="text-lg font-bold text-slate-800"
                >
                  {editorState.id ? 'Edit booking' : 'New booking'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Quickly schedule sessions, then drag to adjust.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={editorState.title}
                  onChange={(e) =>
                    setEditorState((prev) =>
                      prev ? { ...prev, title: e.target.value } : prev
                    )
                  }
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-400"
                  placeholder="e.g. Sarah Connor - follow-up"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Starts
                  </label>
                  <input
                    type="datetime-local"
                    value={formatLocalDateTimeInput(editorState.start)}
                    onChange={(e) =>
                      setEditorState((prev) =>
                        prev
                          ? { ...prev, start: parseLocalDateTimeInput(e.target.value) }
                          : prev
                      )
                    }
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Ends
                  </label>
                  <input
                    type="datetime-local"
                    value={formatLocalDateTimeInput(editorState.end)}
                    onChange={(e) =>
                      setEditorState((prev) =>
                        prev
                          ? { ...prev, end: parseLocalDateTimeInput(e.target.value) }
                          : prev
                      )
                    }
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Patient (optional)
                </label>
                <select
                  value={editorState.patientId || ''}
                  onChange={(e) =>
                    setEditorState((prev) =>
                      prev ? { ...prev, patientId: e.target.value || undefined } : prev
                    )
                  }
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-400"
                >
                  <option value="">Unlinked booking</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Location
                </label>
                <input
                  type="text"
                  value={editorState.location || ''}
                  onChange={(e) =>
                    setEditorState((prev) =>
                      prev ? { ...prev, location: e.target.value } : prev
                    )
                  }
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-400"
                  placeholder="e.g. Rooms 3B, telehealth"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Notes
                </label>
                <textarea
                  value={editorState.description || ''}
                  onChange={(e) =>
                    setEditorState((prev) =>
                      prev ? { ...prev, description: e.target.value } : prev
                    )
                  }
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-400 resize-none"
                  placeholder="Internal notes for this booking..."
                />
              </div>
              {editorState.patientId && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Attachments
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1 flex-1">
                      {events
                        .find((e) => e.id === editorState.id)
                        ?.attachments?.map((att) => (
                          <a
                            key={att.fileId}
                            href={
                              att.url ||
                              `https://drive.google.com/file/d/${att.fileId}/view`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-[11px] text-slate-700 hover:bg-slate-200"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                            <span className="truncate max-w-[120px]">
                              {att.name || att.fileId}
                            </span>
                          </a>
                        ))}
                      {events.find((e) => e.id === editorState.id)?.attachments
                        ?.length === 0 && (
                        <span className="text-[11px] text-slate-400">
                          No files attached.
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={openAttachments}
                      className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 text-slate-100 hover:bg-slate-800 transition-colors"
                    >
                      Manage
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/70">
              {editorState.id ? (
                <div className="flex items-center gap-2">
                  {onSelectPatientFromEvent &&
                    editorState.patientId &&
                    events.find((event) => event.id === editorState.id) && (
                      <button
                        type="button"
                        onClick={() => {
                          const linkedEvent = events.find((event) => event.id === editorState.id);
                          if (!linkedEvent) return;
                          onSelectPatientFromEvent(linkedEvent);
                          closeEditor();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-sky-600 transition-colors hover:bg-sky-50 hover:text-sky-700"
                        disabled={saving}
                      >
                        Open patient workspace
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={handleDeleteFromEditor}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 px-3 py-2 rounded-lg hover:bg-rose-50 transition-colors"
                    disabled={saving}
                  >
                    Delete booking
                  </button>
                </div>
              ) : (
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Plus className="w-3 h-3" />
                  New booking
                </span>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditor}
                  disabled={saving || !editorState.title.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 text-white hover:bg-sky-700 shadow-sm shadow-sky-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CalendarIcon className="w-3.5 h-3.5" />
                      Save booking
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {attachmentsOpen && editorState && editorState.patientId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-800">
                  Attach files to booking
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Choose files from the patient&apos;s Drive folder to keep this visit
                  organised.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAttachmentsOpen(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {attachmentLoading ? (
                <div className="flex items-center justify-center py-8 text-slate-500 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
                  <span className="text-sm">Loading patient files...</span>
                </div>
              ) : attachmentFiles.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No files found in this patient&apos;s folder yet. Upload notes, labs or
                  reports from the workspace first.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {attachmentFiles.map((file) => {
                    const selected = selectedAttachmentIds.includes(file.id);
                    return (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => toggleAttachmentSelection(file.id)}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl border text-left text-sm transition-colors ${
                          selected
                            ? 'border-sky-500 bg-sky-50 text-sky-800'
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <span className="truncate mr-2">{file.name}</span>
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            selected ? 'bg-sky-500' : 'bg-slate-300'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/70">
              <span className="text-[11px] text-slate-500">
                {selectedAttachmentIds.length} file
                {selectedAttachmentIds.length === 1 ? '' : 's'} attached
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAttachmentsOpen(false)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  disabled={attachmentLoading}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={saveAttachments}
                  disabled={attachmentLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 text-white hover:bg-sky-700 shadow-sm shadow-sky-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {attachmentLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      Save attachments
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
