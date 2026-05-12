import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AdmissionsCard } from '../../../../../shared/types';
import { Clock3, GripVertical } from 'lucide-react';
import { formatTimeInStage } from './admissionsUtils';

interface Props {
  card: AdmissionsCard;
  now: number;
  idNumber?: string;
  onOpen: () => void;
}

export const AdmissionsPatientCard: React.FC<Props> = ({ card, now, idNumber, onOpen }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: { type: 'card' },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const completedTasks = card.tasks.filter((task) => task.done).length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-[10px] border border-slate-200/90 bg-white p-3.5 shadow-sm transition ${
        isDragging
          ? 'opacity-60 shadow-md ring-2 ring-cyan-200/60'
          : 'hover:border-slate-300 hover:shadow'
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 flex-col items-start text-left"
        >
          <p className="w-full truncate text-[15px] font-semibold leading-snug tracking-tight text-slate-900">
            {card.patientName}
          </p>

          {(card.folderNumber || idNumber) && (
            <p className="mt-1.5 text-[11px] text-slate-400">
              {[card.folderNumber ? `Folder ${card.folderNumber}` : null, idNumber ? `ID ${idNumber}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-0.5 font-medium text-cyan-700">
              <Clock3 className="h-3 w-3 shrink-0" />
              {formatTimeInStage(card.enteredColumnAt, now)}
            </span>
            {card.diagnosis && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                {card.diagnosis.startsWith('#') ? card.diagnosis : `#${card.diagnosis}`}
              </span>
            )}
          </div>

          {card.coManagingDoctors.length > 0 && (
            <p className="mt-2 line-clamp-1 text-xs text-slate-500">
              <span className="font-medium text-slate-600">Co-managing:</span> {card.coManagingDoctors.join(', ')}
            </p>
          )}

          {card.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-slate-200 bg-slate-50/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex w-full items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-400">
            <span className="font-medium text-cyan-600">
              {card.tasks.length > 0 ? `${completedTasks}/${card.tasks.length} tasks` : 'No tasks'}
            </span>
            <span className="text-slate-400">Open</span>
          </div>
        </button>
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-300 transition hover:bg-slate-100 hover:text-slate-500"
          aria-label="Drag card"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

/** Static preview for DragOverlay (not sortable). */
export const AdmissionsPatientCardPreview: React.FC<{
  card: AdmissionsCard;
  now: number;
  idNumber?: string;
}> = ({ card, now, idNumber }) => {
  const completedTasks = card.tasks.filter((task) => task.done).length;
  return (
    <div className="w-[280px] cursor-grabbing rounded-[10px] border border-slate-200 bg-white p-3.5 shadow-lg ring-2 ring-cyan-200/50">
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[15px] font-semibold text-slate-900">{card.patientName}</p>
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />
      </div>
      {(card.folderNumber || idNumber) && (
        <p className="mt-1 text-[11px] text-slate-400">
          {[card.folderNumber ? `Folder ${card.folderNumber}` : null, idNumber ? `ID ${idNumber}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-0.5 font-medium text-cyan-700">
          <Clock3 className="h-3 w-3" />
          {formatTimeInStage(card.enteredColumnAt, now)}
        </span>
        {card.diagnosis && (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
            {card.diagnosis.startsWith('#') ? card.diagnosis : `#${card.diagnosis}`}
          </span>
        )}
      </div>
      <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] font-medium text-cyan-600">
        {card.tasks.length > 0 ? `${completedTasks}/${card.tasks.length} tasks` : 'No tasks'}
      </div>
    </div>
  );
};
