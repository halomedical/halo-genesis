import React from 'react';
import { LayoutPanelTop, Plus, Search } from 'lucide-react';
import type { BoardFilterMode } from './admissionsUtils';

const FILTER_OPTIONS: { id: BoardFilterMode; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'openTasks', label: 'Open tasks' },
  { id: 'discharge', label: 'Discharge' },
  { id: 'critical', label: 'Critical' },
];

interface Props {
  boardSearch: string;
  onBoardSearchChange: (value: string) => void;
  filterMode: BoardFilterMode;
  onFilterModeChange: (mode: BoardFilterMode) => void;
  saving: boolean;
  updatedAt: string;
  onAddPatient: () => void;
}

export const AdmissionsBoardHeader: React.FC<Props> = ({
  boardSearch,
  onBoardSearchChange,
  filterMode,
  onFilterModeChange,
  saving,
  updatedAt,
  onAddPatient,
}) => {
  return (
    <div className="border-b border-slate-200/80 bg-white px-5 py-4 backdrop-blur-sm md:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
            <LayoutPanelTop className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-[28px]">Admissions</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Inpatient board — wards, tasks, and handovers in one calm view.
            </p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center lg:w-auto">
          <label className="relative block min-w-0 lg:min-w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input
              value={boardSearch}
              onChange={(event) => onBoardSearchChange(event.target.value)}
              placeholder="Search patients, tags, doctors..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white"
            />
          </label>
          <button
            type="button"
            onClick={onAddPatient}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-600"
          >
            <Plus className="h-4 w-4" />
            Add patient
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex rounded-lg border border-slate-200 bg-slate-50/80 p-0.5"
          role="tablist"
          aria-label="Board filters"
        >
          {FILTER_OPTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filterMode === id}
              onClick={() => onFilterModeChange(id)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                filterMode === id
                  ? 'bg-cyan-500 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400">
          {saving ? 'Saving…' : `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
        </p>
      </div>
    </div>
  );
};
