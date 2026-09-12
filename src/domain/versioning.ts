export function nextExportVersion(entries: string[]): string {
  const highest = entries.reduce((max, name) => Math.max(max, /^v\d{3}$/.test(name) ? Number(name.slice(1)) : 0), 0);
  return `v${String(highest + 1).padStart(3, '0')}`;
}
