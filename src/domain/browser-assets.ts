import type { AbacoProject } from './schema';

const sourceUrl = (file: File) => `${URL.createObjectURL(file)}#${encodeURIComponent(file.name)}`;
const mediaDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('scene-preview-media', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files');
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
export async function browserAsset(file: File) {
  const sourcePath = sourceUrl(file);
  try {
    const db = await mediaDb();
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(file, sourcePath); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  } catch { /* The selected file remains usable for the current browser session. */ }
  return { sourcePath, name: file.name };
}
export function chooseBrowserFile(accept: string): Promise<File | undefined> {
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.hidden = true;
    const finish = (file?: File) => { input.remove(); resolve(file); };
    input.addEventListener('change', () => finish(input.files?.[0]), { once: true });
    input.addEventListener('cancel', () => finish(), { once: true });
    document.body.append(input); input.click();
  });
}
export async function chooseBrowserAsset(accept: string) {
  const file = await chooseBrowserFile(accept); return file ? browserAsset(file) : undefined;
}
// Blob URLs expire on navigation; restore locally stored preview files before mounting.
export async function restoreBrowserAssets(project: AbacoProject): Promise<AbacoProject> {
  const paths = new Set([...project.objects.map(object => object.asset.sourcePath), ...project.cameraCuts.map(scene => scene.background.path)].filter(path => path.startsWith('blob:')));
  if (!paths.size) return project;
  const db = await mediaDb(), replacements = new Map<string, string>();
  for (const path of paths) {
    const file = await new Promise<File | undefined>((resolve, reject) => { const request = db.transaction('files').objectStore('files').get(path); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    if (file) {
      replacements.set(path, (await browserAsset(file)).sourcePath);
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(path); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    }
  }
  db.close();
  if (!replacements.size) return project;
  const next = structuredClone(project);
  for (const object of next.objects) object.asset.sourcePath = replacements.get(object.asset.sourcePath) ?? object.asset.sourcePath;
  for (const scene of next.cameraCuts) scene.background.path = replacements.get(scene.background.path) ?? scene.background.path;
  return next;
}
