/** Window whole element groups, retaining their motion/subtitle rows. */
export function timelineRowWindow(counts: number[], scrollTop: number, height: number, rowHeight: number, headerHeight: number, overscan = 4) {
  const offsets = [0];
  for (const count of counts) offsets.push(offsets.at(-1)! + count);
  if (counts.length <= 100 || height <= 0 || rowHeight <= 0) return { start: 0, end: counts.length, before: 0, after: 0, offsets };
  const first = Math.max(0, (scrollTop - headerHeight) / rowHeight - overscan);
  const last = Math.max(first, (scrollTop + height - headerHeight) / rowHeight + overscan);
  let start = 0;
  while (start < counts.length && offsets[start + 1] <= first) start++;
  let end = start;
  while (end < counts.length && offsets[end] < last) end++;
  return { start, end, before: offsets[start], after: offsets.at(-1)! - offsets[end], offsets };
}
