import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import type { AdmissionsBoard, AdmissionsCard, Patient } from '../../../../../shared/types';
import { DEFAULT_PATIENT_NAMING, type PatientNamingConfig } from '../../../../../shared/patientNaming';
import { formatPatientDisplayName } from '../../../../../shared/patientNamingEngine';
import { ApiError, fetchAdmissionsBoard, saveAdmissionsBoard } from '../../services/api';
import { Loader2, Plus } from 'lucide-react';
import { AdmissionsAddPatientModal } from './AdmissionsAddPatientModal';
import { AdmissionsBoardHeader } from './AdmissionsBoardHeader';
import { AdmissionsCardDrawer } from './AdmissionsCardDrawer';
import { AdmissionsColumn } from './AdmissionsColumn';
import { AdmissionsPatientCardPreview } from './AdmissionsPatientCard';
import {
  type BoardFilterMode,
  type CardDrawerState,
  buildVisibleBoard,
  cloneBoard,
  findCardLocation,
} from './admissionsUtils';

interface Props {
  patients: Patient[];
  patientNaming?: PatientNamingConfig;
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
  onOpenPatient: (
    patientId: string,
    options?: { tab?: 'overview' | 'notes' | 'chat' | 'sessions'; freshSession?: boolean }
  ) => void;
}

export const AdmissionsPage: React.FC<Props> = ({
  patients,
  patientNaming = DEFAULT_PATIENT_NAMING,
  onToast,
  onOpenPatient,
}) => {
  const [board, setBoard] = useState<AdmissionsBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [boardSearch, setBoardSearch] = useState('');
  const [filterMode, setFilterMode] = useState<BoardFilterMode>('all');
  const [now, setNow] = useState(Date.now());
  const [renamingColumnId, setRenamingColumnId] = useState<string | null>(null);
  const [renameColumnValue, setRenameColumnValue] = useState('');
  const [showAddPatientModal, setShowAddPatientModal] = useState(false);
  const [newCardColumnId, setNewCardColumnId] = useState<string | null>(null);
  const [newCardPatientId, setNewCardPatientId] = useState('');
  const [newCardSearch, setNewCardSearch] = useState('');
  const [newCardDiagnosis, setNewCardDiagnosis] = useState('');
  const [newCardDoctorsInput, setNewCardDoctorsInput] = useState('');
  const [newCardTagsInput, setNewCardTagsInput] = useState('');
  const [newWardTitle, setNewWardTitle] = useState('');
  const [drawerState, setDrawerState] = useState<CardDrawerState | null>(null);
  const [drawerDraft, setDrawerDraft] = useState<AdmissionsCard | null>(null);
  const [taskInput, setTaskInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [doctorInput, setDoctorInput] = useState('');
  const [activeDragCard, setActiveDragCard] = useState<AdmissionsCard | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const patientsById = useMemo(
    () => new Map(patients.map((patient) => [patient.id, patient])),
    [patients]
  );

  const patientIdNumberLookup = useCallback(
    (patientId: string) => patientsById.get(patientId)?.idNumber,
    [patientsById]
  );

  const filteredPatientResults = useMemo(() => {
    const query = newCardSearch.trim().toLowerCase();
    const existingIds = new Set(
      board?.columns.flatMap((column) => column.cards.map((card) => card.patientId)) || []
    );
    return patients
      .filter((patient) => !existingIds.has(patient.id))
      .filter((patient) => {
        if (!query) return true;
        return (
          patient.name.toLowerCase().includes(query) ||
          patient.dob.toLowerCase().includes(query) ||
          (patient.folderNumber || '').toLowerCase().includes(query) ||
          (patient.idNumber || '').toLowerCase().includes(query)
        );
      })
      .slice(0, 12);
  }, [board?.columns, newCardSearch, patients]);

  const visibleBoard = useMemo(() => {
    if (!board) return null;
    return buildVisibleBoard(board, boardSearch, filterMode, patientIdNumberLookup);
  }, [board, boardSearch, filterMode, patientIdNumberLookup]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchAdmissionsBoard()
      .then((response) => {
        if (mounted) setBoard(response.board);
      })
      .catch((error) => {
        if (mounted) onToast(error instanceof Error ? error.message : 'Failed to load admissions board.', 'error');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [onToast]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const openCardDrawer = (columnId: string, cardId: string) => {
    const column = board?.columns.find((item) => item.id === columnId);
    const card = column?.cards.find((item) => item.id === cardId);
    if (!card) return;
    setDrawerState({ columnId, cardId });
    setDrawerDraft({
      ...card,
      coManagingDoctors: [...card.coManagingDoctors],
      tags: [...card.tags],
      tasks: card.tasks.map((task) => ({ ...task })),
      movementHistory: card.movementHistory.map((movement) => ({ ...movement })),
    });
    setTaskInput('');
    setTagInput('');
    setDoctorInput('');
  };

  const closeDrawer = () => {
    setDrawerState(null);
    setDrawerDraft(null);
    setTaskInput('');
    setTagInput('');
    setDoctorInput('');
  };

  const persistBoard = async (nextBoard: AdmissionsBoard) => {
    setBoard(nextBoard);
    setSaving(true);
    try {
      const response = await saveAdmissionsBoard(nextBoard);
      setBoard(response.board);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await fetchAdmissionsBoard();
          setBoard(latest.board);
        } catch {
          // Keep optimistic board if refetch fails.
        }
        onToast('Admissions board changed elsewhere. Reloaded the latest version.', 'info');
        closeDrawer();
      } else {
        onToast(error instanceof Error ? error.message : 'Failed to save admissions board.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleColumnRename = async (columnId: string) => {
    const title = renameColumnValue.trim();
    if (!board || !title) {
      setRenamingColumnId(null);
      setRenameColumnValue('');
      return;
    }
    const nextBoard = cloneBoard(board);
    const column = nextBoard.columns.find((item) => item.id === columnId);
    if (!column) return;
    column.title = title;
    column.cards = column.cards.map((card) => ({
      ...card,
      movementHistory: card.movementHistory.map((movement, index, list) =>
        movement.columnId === columnId && index === list.length - 1
          ? { ...movement, columnTitle: title }
          : movement
      ),
    }));
    setRenamingColumnId(null);
    setRenameColumnValue('');
    await persistBoard(nextBoard);
  };

  const handleDeleteColumn = async (columnId: string) => {
    if (!board) return;
    const column = board.columns.find((item) => item.id === columnId);
    if (!column) return;
    if (board.columns.length <= 1) {
      onToast('Keep at least one ward on the board.', 'info');
      return;
    }
    if (column.cards.length > 0) {
      onToast('Move patients out of this ward before deleting it.', 'info');
      return;
    }
    const nextBoard = {
      ...cloneBoard(board),
      columns: board.columns.filter((item) => item.id !== columnId),
    };
    await persistBoard(nextBoard);
  };

  const handleAddWard = async () => {
    if (!board) return;
    const title = newWardTitle.trim();
    if (!title) return;
    const nextBoard = cloneBoard(board);
    nextBoard.columns.push({
      id: crypto.randomUUID(),
      title,
      cards: [],
    });
    setNewWardTitle('');
    await persistBoard(nextBoard);
  };

  const handleOpenAddPatient = (columnId: string) => {
    setNewCardColumnId(columnId);
    setNewCardPatientId('');
    setNewCardSearch('');
    setNewCardDiagnosis('');
    setNewCardDoctorsInput('');
    setNewCardTagsInput('');
    setShowAddPatientModal(true);
  };

  const handleCreateCard = async () => {
    if (!board || !newCardColumnId || !newCardPatientId) return;
    const patient = patientsById.get(newCardPatientId);
    if (!patient) return;
    const targetColumn = board.columns.find((column) => column.id === newCardColumnId);
    if (!targetColumn) return;

    const nowIso = new Date().toISOString();
    const nextBoard = cloneBoard(board);
    const nextColumn = nextBoard.columns.find((column) => column.id === newCardColumnId);
    if (!nextColumn) return;

    nextColumn.cards.unshift({
      id: crypto.randomUUID(),
      patientId: patient.id,
      patientName: formatPatientDisplayName(patient, patientNaming),
      folderNumber: patient.folderNumber,
      diagnosis: newCardDiagnosis.trim(),
      coManagingDoctors: newCardDoctorsInput
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      tags: newCardTagsInput
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      tasks: [],
      enteredColumnAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
      movementHistory: [
        {
          columnId: nextColumn.id,
          columnTitle: nextColumn.title,
          enteredAt: nowIso,
        },
      ],
    });

    setShowAddPatientModal(false);
    await persistBoard(nextBoard);
  };

  const saveDrawerDraft = async () => {
    if (!board || !drawerState || !drawerDraft) return;
    const nextBoard = cloneBoard(board);
    const column = nextBoard.columns.find((item) => item.id === drawerState.columnId);
    const cardIndex = column?.cards.findIndex((item) => item.id === drawerState.cardId) ?? -1;
    if (!column || cardIndex < 0) return;
    column.cards[cardIndex] = {
      ...drawerDraft,
      updatedAt: new Date().toISOString(),
    };
    await persistBoard(nextBoard);
    closeDrawer();
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type !== 'card' || !board) {
      setActiveDragCard(null);
      return;
    }
    const loc = findCardLocation(board, String(event.active.id));
    if (!loc) {
      setActiveDragCard(null);
      return;
    }
    const card = board.columns[loc.columnIndex].cards[loc.cardIndex];
    setActiveDragCard(card ? { ...card } : null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragCard(null);
    const { active, over } = event;
    if (!board || !over || active.id === over.id) return;

    const activeType = active.data.current?.type as 'column' | 'card' | undefined;
    const overType = over.data.current?.type as 'column' | 'card' | 'columnEmpty' | undefined;
    const nextBoard = cloneBoard(board);

    if (activeType === 'column' && overType === 'column') {
      const oldIndex = nextBoard.columns.findIndex((column) => column.id === String(active.id));
      const newIndex = nextBoard.columns.findIndex((column) => column.id === String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      nextBoard.columns = arrayMove(nextBoard.columns, oldIndex, newIndex);
      await persistBoard(nextBoard);
      return;
    }

    if (activeType !== 'card') return;

    const activeLocation = findCardLocation(nextBoard, String(active.id));
    if (!activeLocation) return;

    const sourceColumn = nextBoard.columns[activeLocation.columnIndex];
    const [movedCard] = sourceColumn.cards.splice(activeLocation.cardIndex, 1);
    if (!movedCard) return;

    let targetColumnIndex = -1;
    let targetCardIndex = 0;

    const restore = () => {
      sourceColumn.cards.splice(activeLocation.cardIndex, 0, movedCard);
    };

    if (overType === 'card') {
      const overLocation = findCardLocation(nextBoard, String(over.id));
      if (!overLocation) {
        restore();
        return;
      }
      targetColumnIndex = overLocation.columnIndex;
      targetCardIndex = overLocation.cardIndex;
    } else if (overType === 'columnEmpty') {
      const cid = over.data.current?.columnId as string | undefined;
      if (!cid) {
        restore();
        return;
      }
      targetColumnIndex = nextBoard.columns.findIndex((column) => column.id === cid);
      if (targetColumnIndex < 0) {
        restore();
        return;
      }
      targetCardIndex = nextBoard.columns[targetColumnIndex].cards.length;
    } else if (overType === 'column') {
      targetColumnIndex = nextBoard.columns.findIndex((column) => column.id === String(over.id));
      if (targetColumnIndex < 0) {
        restore();
        return;
      }
      targetCardIndex = nextBoard.columns[targetColumnIndex].cards.length;
    } else {
      restore();
      return;
    }

    const targetColumn = nextBoard.columns[targetColumnIndex];
    if (!targetColumn) {
      restore();
      return;
    }

    if (sourceColumn.id !== targetColumn.id) {
      const nowIso = new Date().toISOString();
      const lastMovement = movedCard.movementHistory[movedCard.movementHistory.length - 1];
      const updatedHistory = lastMovement
        ? [
            ...movedCard.movementHistory.slice(0, -1),
            { ...lastMovement, exitedAt: lastMovement.exitedAt || nowIso },
            {
              columnId: targetColumn.id,
              columnTitle: targetColumn.title,
              enteredAt: nowIso,
            },
          ]
        : [
            {
              columnId: targetColumn.id,
              columnTitle: targetColumn.title,
              enteredAt: nowIso,
            },
          ];
      movedCard.enteredColumnAt = nowIso;
      movedCard.updatedAt = nowIso;
      movedCard.movementHistory = updatedHistory;
    }

    targetColumn.cards.splice(targetCardIndex, 0, movedCard);
    await persistBoard(nextBoard);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (!board || !visibleBoard) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-400">
        Unable to load the admissions board.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
      <AdmissionsBoardHeader
        boardSearch={boardSearch}
        onBoardSearchChange={setBoardSearch}
        filterMode={filterMode}
        onFilterModeChange={setFilterMode}
        saving={saving}
        updatedAt={board.updatedAt}
        onAddPatient={() => handleOpenAddPatient(board.columns[0]?.id || '')}
      />

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 py-4 md:px-6">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={(e: DragEndEvent) => void handleDragEnd(e)}
          onDragCancel={() => setActiveDragCard(null)}
        >
          <SortableContext items={board.columns.map((column) => column.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex h-full min-w-max items-start gap-6 pb-4">
              {visibleBoard.columns.map((column) => {
                const originalColumn = board.columns.find((item) => item.id === column.id) || column;
                return (
                  <AdmissionsColumn
                    key={column.id}
                    column={column}
                    now={now}
                    isRenaming={renamingColumnId === column.id}
                    renameValue={renameColumnValue}
                    onRenameValueChange={setRenameColumnValue}
                    onRenameSubmit={() => void handleColumnRename(column.id)}
                    onStartRename={() => {
                      setRenamingColumnId(column.id);
                      setRenameColumnValue(originalColumn.title);
                    }}
                    onDelete={() => void handleDeleteColumn(column.id)}
                    onAddPatient={() => handleOpenAddPatient(column.id)}
                    onOpenCard={(cardId) => openCardDrawer(column.id, cardId)}
                    patientIdNumberLookup={patientIdNumberLookup}
                  />
                );
              })}

              <div className="w-[260px] shrink-0 rounded-xl border border-dashed border-slate-200 bg-white/60 p-4 shadow-sm">
                <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Add ward</p>
                <p className="mt-1 text-sm text-slate-400">New unit or stage for inpatients.</p>
                <input
                  value={newWardTitle}
                  onChange={(event) => setNewWardTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleAddWard();
                  }}
                  placeholder="e.g. HDU"
                  className="mt-3 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300"
                />
                <button
                  type="button"
                  onClick={() => void handleAddWard()}
                  className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700"
                >
                  <Plus className="h-4 w-4" />
                  Add ward
                </button>
              </div>
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeDragCard ? (
              <AdmissionsPatientCardPreview
                card={activeDragCard}
                now={now}
                idNumber={patientIdNumberLookup(activeDragCard.patientId)}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <AdmissionsAddPatientModal
        open={showAddPatientModal}
        boardColumns={board.columns}
        filteredPatientResults={filteredPatientResults}
        patientNaming={patientNaming}
        newCardPatientId={newCardPatientId}
        newCardSearch={newCardSearch}
        newCardSearchChange={setNewCardSearch}
        newCardPatientIdChange={setNewCardPatientId}
        newCardColumnId={newCardColumnId}
        newCardColumnIdChange={setNewCardColumnId}
        newCardDiagnosis={newCardDiagnosis}
        newCardDiagnosisChange={setNewCardDiagnosis}
        newCardDoctorsInput={newCardDoctorsInput}
        newCardDoctorsInputChange={setNewCardDoctorsInput}
        newCardTagsInput={newCardTagsInput}
        newCardTagsInputChange={setNewCardTagsInput}
        onClose={() => setShowAddPatientModal(false)}
        onCreateCard={() => void handleCreateCard()}
      />

      {drawerState && drawerDraft && (
        <AdmissionsCardDrawer
          now={now}
          drawerDraft={drawerDraft}
          idNumber={patientIdNumberLookup(drawerDraft.patientId)}
          saving={saving}
          taskInput={taskInput}
          tagInput={tagInput}
          doctorInput={doctorInput}
          onClose={closeDrawer}
          onSave={() => void saveDrawerDraft()}
          setDrawerDraft={setDrawerDraft}
          setTaskInput={setTaskInput}
          setTagInput={setTagInput}
          setDoctorInput={setDoctorInput}
          onOpenPatient={onOpenPatient}
        />
      )}
    </div>
  );
};
