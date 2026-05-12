import React, { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AdmissionsColumn as AdmissionsColumnType } from '../../../../../shared/types';
import { GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { AdmissionsPatientCard } from './AdmissionsPatientCard';

function EmptyColumnDropZone({ columnId }: { columnId: string }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `empty-${columnId}`,
    data: { type: 'columnEmpty', columnId },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[100px] flex-col items-center justify-center rounded-[10px] border border-dashed px-3 py-6 text-center text-xs transition ${
        isOver
          ? 'border-cyan-300 bg-cyan-50/50 text-cyan-700'
          : 'border-slate-200/90 bg-slate-50/40 text-slate-400'
      }`}
    >
      <p className="font-medium">Drop patients here</p>
      <p className="mt-1 text-[11px] opacity-80">or use Add patient</p>
    </div>
  );
}

interface Props {
  column: AdmissionsColumnType;
  now: number;
  isRenaming: boolean;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameSubmit: () => void;
  onStartRename: () => void;
  onDelete: () => void;
  onAddPatient: () => void;
  onOpenCard: (cardId: string) => void;
  patientIdNumberLookup: (patientId: string) => string | undefined;
}

export const AdmissionsColumn: React.FC<Props> = ({
  column,
  now,
  isRenaming,
  renameValue,
  onRenameValueChange,
  onRenameSubmit,
  onStartRename,
  onDelete,
  onAddPatient,
  onOpenCard,
  patientIdNumberLookup,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: { type: 'column' },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex h-full w-[300px] shrink-0 flex-col ${isDragging ? 'opacity-75' : ''}`}
    >
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => onRenameValueChange(event.target.value)}
              onBlur={onRenameSubmit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRenameSubmit();
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-800 outline-none focus:border-cyan-400"
            />
          ) : (
            <>
              <p className="truncate text-[12px] font-bold uppercase tracking-[0.14em] text-slate-800">
                {column.title}
              </p>
              <p className="mt-0.5 text-[13px] text-slate-500">
                {column.cards.length} patient{column.cards.length === 1 ? '' : 's'}
              </p>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-slate-100 hover:text-slate-500"
            title="Drag to reorder ward"
            aria-label="Drag to reorder ward"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onAddPatient}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-cyan-600 transition hover:bg-cyan-50"
            title="Add patient"
            aria-label="Add patient to ward"
          >
            <Plus className="h-4 w-4" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Ward actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-10 cursor-default"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-20 mt-1 min-w-[180px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpen(false);
                      onStartRename();
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Rename ward
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete ward
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        <SortableContext items={column.cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2.5">
            {column.cards.map((card) => (
              <AdmissionsPatientCard
                key={card.id}
                card={card}
                now={now}
                idNumber={patientIdNumberLookup(card.patientId)}
                onOpen={() => onOpenCard(card.id)}
              />
            ))}
            {column.cards.length === 0 && <EmptyColumnDropZone columnId={column.id} />}
          </div>
        </SortableContext>
      </div>
    </div>
  );
};
