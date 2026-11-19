// Chunked AI grouping as a resumable state machine, so the background
// worker can group a 500-photo batch across several 60-second invocations
// (checkpointing after every chunk). Same chunk/carry-over rules as the
// Batch Upload page: the last group of a chunk may continue into the next
// chunk, so it's carried over ("pending") and re-sent with the next photos.

export const GROUP_CHUNK_SIZE = 15;

export interface GroupingState {
  cursor: number;
  pending: number[];
  groups: number[][];
  autoPlaced: number[];
  duplicates: number[];
  unusable: boolean;
}

export function initialGroupingState(): GroupingState {
  return { cursor: 0, pending: [], groups: [], autoPlaced: [], duplicates: [], unusable: false };
}

export function isGroupingDone(s: GroupingState, total: number): boolean {
  return s.cursor >= total && s.pending.length === 0;
}

/** Global photo indices for the next AI call. */
export function nextChunk(s: GroupingState, total: number, size = GROUP_CHUNK_SIZE): number[] {
  const take = Math.max(size - s.pending.length, 1);
  const fresh: number[] = [];
  for (let i = s.cursor; i < Math.min(s.cursor + take, total); i++) fresh.push(i);
  return [...s.pending, ...fresh];
}

export interface ChunkAnswer {
  groups: number[][];
  repairs?: { autoPlaced: { photo: number; group: number }[]; duplicatesRemoved: number[]; unusable: boolean };
}

/** Folds one chunk's answer (local indices) into the state. */
export function applyChunk(s: GroupingState, chunk: number[], answer: ChunkAnswer, total: number): GroupingState {
  const remapped = answer.groups.map((g) => g.map((local) => chunk[local])).filter((g) => g.length > 0);
  const freshCount = chunk.length - s.pending.length;
  const cursor = s.cursor + freshCount;
  const last = cursor >= total;
  const next: GroupingState = {
    cursor,
    pending: last ? [] : remapped[remapped.length - 1] ?? [],
    groups: [...s.groups, ...(last ? remapped : remapped.slice(0, -1))],
    autoPlaced: [...s.autoPlaced, ...(answer.repairs?.autoPlaced ?? []).map((a) => chunk[a.photo])],
    duplicates: [...s.duplicates, ...(answer.repairs?.duplicatesRemoved ?? []).map((d) => chunk[d])],
    unusable: s.unusable || !!answer.repairs?.unusable,
  };
  return next;
}
