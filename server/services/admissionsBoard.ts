import { getVpsConfig, setVpsConfig } from './vpsApi';
import type {
  AdmissionsBoard,
  AdmissionsCard,
  AdmissionsCardMovement,
  AdmissionsColumn,
  AdmissionsTask,
} from '../../shared/types';

export const ADMISSIONS_BOARD_FILE_NAME = 'halo_admissions_board.json';

const DEFAULT_WARDS = [
  'Casualty',
  'Admissions Unit',
  'Ward',
  'ICU',
  'Theatre',
  'Discharge Planning',
];

function cleanText(value: unknown, maxLength = 160): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[<>]/g, '').slice(0, maxLength);
}

function normalizeTasks(value: unknown): AdmissionsTask[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((task) => {
      const item = task as Partial<AdmissionsTask>;
      const title = cleanText(item?.title, 120);
      if (!title) return null;
      return {
        id: cleanText(item?.id, 80) || crypto.randomUUID(),
        title,
        done: Boolean(item?.done),
        createdAt:
          typeof item?.createdAt === 'string' && item.createdAt
            ? item.createdAt
            : new Date().toISOString(),
      } satisfies AdmissionsTask;
    })
    .filter((task): task is AdmissionsTask => task !== null);
}

function normalizeMovementHistory(value: unknown): AdmissionsCardMovement[] {
  if (!Array.isArray(value)) return [];
  const movements: AdmissionsCardMovement[] = [];
  for (const movement of value) {
    const item = movement as Partial<AdmissionsCardMovement>;
    if (
      typeof item?.columnId !== 'string' ||
      typeof item?.columnTitle !== 'string' ||
      typeof item?.enteredAt !== 'string'
    ) {
      continue;
    }
    movements.push({
      columnId: cleanText(item.columnId, 80),
      columnTitle: cleanText(item.columnTitle, 80),
      enteredAt: item.enteredAt,
      exitedAt: typeof item.exitedAt === 'string' ? item.exitedAt : undefined,
    });
  }
  return movements;
}

function normalizeCard(value: unknown, column: AdmissionsColumn): AdmissionsCard | null {
  const item = value as Partial<AdmissionsCard>;
  const patientId = cleanText(item?.patientId, 120);
  const patientName = cleanText(item?.patientName, 160);
  if (!patientId || !patientName) return null;

  const createdAt =
    typeof item?.createdAt === 'string' && item.createdAt
      ? item.createdAt
      : new Date().toISOString();
  const enteredColumnAt =
    typeof item?.enteredColumnAt === 'string' && item.enteredColumnAt
      ? item.enteredColumnAt
      : createdAt;
  const movementHistory = normalizeMovementHistory(item?.movementHistory);

  const normalizedHistory =
    movementHistory.length > 0
      ? movementHistory
      : [
          {
            columnId: column.id,
            columnTitle: column.title,
            enteredAt: enteredColumnAt,
          },
        ];

  return {
    id: cleanText(item?.id, 80) || crypto.randomUUID(),
    patientId,
    patientName,
    folderNumber: cleanText(item?.folderNumber, 80) || undefined,
    diagnosis: cleanText(item?.diagnosis, 120),
    coManagingDoctors: Array.isArray(item?.coManagingDoctors)
      ? item.coManagingDoctors.map((value) => cleanText(value, 80)).filter(Boolean).slice(0, 10)
      : [],
    tags: Array.isArray(item?.tags)
      ? item.tags.map((value) => cleanText(value, 40)).filter(Boolean).slice(0, 12)
      : [],
    tasks: normalizeTasks(item?.tasks),
    enteredColumnAt,
    createdAt,
    updatedAt:
      typeof item?.updatedAt === 'string' && item.updatedAt
        ? item.updatedAt
        : new Date().toISOString(),
    movementHistory: normalizedHistory,
  };
}

function normalizeColumns(value: unknown): AdmissionsColumn[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((column) => {
      const item = column as Partial<AdmissionsColumn>;
      const title = cleanText(item?.title, 80);
      if (!title) return null;
      const normalizedColumn: AdmissionsColumn = {
        id: cleanText(item?.id, 80) || crypto.randomUUID(),
        title,
        cards: [],
      };
      normalizedColumn.cards = Array.isArray(item?.cards)
        ? item.cards
            .map((card) => normalizeCard(card, normalizedColumn))
            .filter((card): card is AdmissionsCard => card !== null)
        : [];
      return normalizedColumn;
    })
    .filter((column): column is AdmissionsColumn => column !== null);
}

export function createDefaultAdmissionsBoard(): AdmissionsBoard {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    columns: DEFAULT_WARDS.map((title) => ({
      id: crypto.randomUUID(),
      title,
      cards: [],
    })),
  };
}

export function normalizeAdmissionsBoard(value: unknown): AdmissionsBoard {
  const board = value as Partial<AdmissionsBoard>;
  const columns = normalizeColumns(board?.columns);
  return {
    version: typeof board?.version === 'number' && board.version > 0 ? board.version : 1,
    updatedAt:
      typeof board?.updatedAt === 'string' && board.updatedAt
        ? board.updatedAt
        : new Date().toISOString(),
    columns: columns.length > 0 ? columns : createDefaultAdmissionsBoard().columns,
  };
}

export async function loadAdmissionsBoard(
  vpsJwt: string
): Promise<{ board: AdmissionsBoard }> {
  const raw = await getVpsConfig(vpsJwt, 'admissions_board');
  if (!raw) {
    const seeded = createDefaultAdmissionsBoard();
    await setVpsConfig(vpsJwt, 'admissions_board', JSON.stringify(seeded));
    return { board: seeded };
  }
  const board = normalizeAdmissionsBoard(JSON.parse(raw));
  return { board };
}

export async function saveAdmissionsBoard(
  vpsJwt: string,
  board: AdmissionsBoard
): Promise<AdmissionsBoard> {
  const nextBoard: AdmissionsBoard = {
    ...normalizeAdmissionsBoard(board),
    updatedAt: new Date().toISOString(),
  };
  await setVpsConfig(vpsJwt, 'admissions_board', JSON.stringify(nextBoard));
  return nextBoard;
}
