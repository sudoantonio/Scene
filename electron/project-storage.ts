import path from 'node:path';
import { ProjectSchema, type AbacoProject } from '../src/domain/schema';

const isDataUrl = (value: string) => value.startsWith('data:');
const portablePath = (value: string) => value.split(path.sep).join('/');
const isInside = (root: string, value: string) => {
  const relative = path.relative(root, value);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

export function projectForStorage(project: AbacoProject, filePath: string) {
  const stored = structuredClone(project);
  const root = path.dirname(filePath);
  const relativeIfBundled = (value: string) => value && !isDataUrl(value) && path.isAbsolute(value) && isInside(root, value) ? portablePath(path.relative(root, value)) : value;
  for (const object of stored.objects) {
    object.asset.sourcePath = relativeIfBundled(object.asset.sourcePath);
    // The embedded image is the recovery copy when an imported original is moved.
    object.asset.proxyPath = relativeIfBundled(object.asset.proxyPath);
  }
  for (const scene of stored.cameraCuts) scene.background.path = relativeIfBundled(scene.background.path);
  return stored;
}

export async function hydratePortableProject(project: AbacoProject, filePath: string, readImage: (filePath: string) => Promise<string>) {
  const hydrated = structuredClone(project);
  const root = path.dirname(filePath);
  const resolveAsset = (value: string) => value && !isDataUrl(value) && !path.isAbsolute(value) ? path.resolve(root, value) : value;
  for (const object of hydrated.objects) {
    object.asset.sourcePath = resolveAsset(object.asset.sourcePath);
    object.asset.proxyPath = resolveAsset(object.asset.proxyPath);
    if (object.screenSpace && object.kind !== 'text' && !isDataUrl(object.asset.proxyPath)) {
      const paths = Array.from(new Set([object.asset.sourcePath, object.asset.proxyPath].filter(Boolean)));
      let error: unknown;
      for (const imagePath of paths) {
        try {
          object.asset.proxyPath = isDataUrl(imagePath) ? imagePath : await readImage(imagePath);
          error = undefined;
          break;
        } catch (failure) { error = failure; }
      }
      if (error) throw error;
    }
  }
  for (const scene of hydrated.cameraCuts) scene.background.path = resolveAsset(scene.background.path);
  return ProjectSchema.parse(hydrated);
}
