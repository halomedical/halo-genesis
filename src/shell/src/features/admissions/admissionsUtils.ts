import type { AdmissionsBoard, AdmissionsCard } from '../../../../../shared/types';

export type BoardFilterMode = 'all' | 'openTasks' | 'discharge' | 'critical';

export interface CardDrawerState {
  columnId: string;
  cardId: string;
}

export function formatTimeInStage(enteredAt: string, now: number): string {
  const diffMs = Math.max(0, now - new Date(enteredAt).getTime());
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function findCardLocation(
  board: AdmissionsBoard,
  cardId: string
): { columnIndex: number; cardIndex: number } | null {
  for (let columnIndex = 0; columnIndex < board.columns.length; columnIndex += 1) {
    const cardIndex = board.columns[columnIndex].cards.findIndex((card) => card.id === cardId);
    if (cardIndex >= 0) return { columnIndex, cardIndex };
  }
  return null;
}

export function cloneBoard(board: AdmissionsBoard): AdmissionsBoard {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.map((card) => ({
        ...card,
        coManagingDoctors: [...card.coManagingDoctors],
        tags: [...card.tags],
        tasks: card.tasks.map((task) => ({ ...task })),
        movementHistory: card.movementHistory.map((movement) => ({ ...movement })),
      })),
    })),
  };
}

function cardMatchesFilter(card: AdmissionsCard, mode: BoardFilterMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'openTasks') return card.tasks.some((t) => !t.done);
  if (mode === 'discharge') {
    return card.tags.some((t) => t.toLowerCase().includes('discharge'));
  }
  if (mode === 'critical') {
    return card.tags.some((t) => {
      const x = t.toLowerCase();
      return x === 'critical' || x.includes('critical');
    });
  }
  return true;
}

/** Client-side search + ward filter (does not mutate source board). */
export function buildVisibleBoard(
  board: AdmissionsBoard,
  query: string,
  filterMode: BoardFilterMode,
  patientIdNumberLookup: (patientId: string) => string | undefined
): AdmissionsBoard {
  const q = query.trim().toLowerCase();
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.filter((card) => {
        if (!cardMatchesFilter(card, filterMode)) return false;
        if (!q) return true;
        const idNum = patientIdNumberLookup(card.patientId) || '';
        const haystack = [
          card.patientName,
          card.folderNumber || '',
          idNum,
          card.diagnosis,
          ...card.tags,
          ...card.coManagingDoctors,
          ...card.tasks.map((task) => task.title),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      }),
    })),
  };
}
