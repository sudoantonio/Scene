import type { AbacoProject } from './schema';

/** Restore unchanged references after editing a detached draft. Never write to
 * the previous snapshot: undo and renderer caches continue to own that data. */
function reuseData<T>(previous: T, next: T): T {
  if (previous === next || !next || !previous || typeof next !== 'object' || typeof previous !== 'object') return next;
  if (Array.isArray(previous) !== Array.isArray(next)) return next;
  const before = previous as Record<string, unknown>, after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let equal = keys.length === Object.keys(before).length;
  for (const key of keys) {
    const value = reuseData(before[key], after[key]);
    after[key] = value;
    if (value !== before[key] || !Object.hasOwn(before, key)) equal = false;
  }
  return equal ? previous : next;
}

export function shareProjectSnapshot(previous: AbacoProject, draft: AbacoProject): AbacoProject {
  const oldObjects = new Map(previous.objects.map(object => [object.id, object]));
  draft.objects = draft.objects.map(object => reuseData(oldObjects.get(object.id), object)!);
  if (draft.objects.length === previous.objects.length && draft.objects.every((object, index) => object === previous.objects[index])) draft.objects = previous.objects;
  const before = previous as unknown as Record<string, unknown>, after = draft as unknown as Record<string, unknown>;
  for (const key of Object.keys(after)) if (key !== 'objects') after[key] = reuseData(before[key], after[key]);
  return draft;
}
