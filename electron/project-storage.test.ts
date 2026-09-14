import { describe, expect, it, vi } from 'vitest';
import { createProject, createSceneObject } from '../src/domain/schema';
import { hydratePortableProject, projectForStorage } from './project-storage';

const preview = 'data:image/png;base64,aW1hZ2U=';
function imageProject() {
  const project = createProject();
  const image = createSceneObject('plane', 1);
  image.screenSpace = true;
  image.asset.sourcePath = '/originals/picture.png';
  image.asset.proxyPath = preview;
  project.objects.push(image);
  return project;
}

describe('project image recovery', () => {
  it('rende portatile il percorso degli elementi audio', async () => {
    const project = createProject();
    const audio = createSceneObject('audio', 1);
    audio.asset.sourcePath = '/project/assets/audio/footstep.wav';
    audio.audio.duration = 1.25;
    project.objects.push(audio);
    const stored = projectForStorage(project, '/project/scene.abaco.json');
    expect(stored.objects.slice(-1)[0]?.asset.sourcePath).toBe('assets/audio/footstep.wav');
    const loaded = await hydratePortableProject(stored, '/moved/scene.abaco.json', vi.fn());
    expect(loaded.objects.slice(-1)[0]?.asset.sourcePath).toBe('/moved/assets/audio/footstep.wav');
    expect(loaded.objects.slice(-1)[0]?.audio.duration).toBe(1.25);
  });

  it('roundtrips an imported image after the original file has been moved', async () => {
    const project = imageProject();
    const readImage = vi.fn().mockRejectedValue(new Error('Original missing'));
    const stored = projectForStorage(project, '/project/scene.abaco.json');
    const loaded = await hydratePortableProject(stored, '/project/scene.abaco.json', readImage);
    expect(loaded.objects.slice(-1)[0]?.asset.proxyPath).toBe(preview);
    expect(readImage).not.toHaveBeenCalled();
    expect(project.objects.slice(-1)[0]?.asset.sourcePath).toBe('/originals/picture.png');
  });

  it('resolves bundled files relative to the project after its folder moves', async () => {
    const project = imageProject();
    project.objects.slice(-1)[0]!.asset = { ...project.objects.slice(-1)[0]!.asset, sourcePath: '/old/assets/picture.png', proxyPath: '/old/assets/picture.png' };
    const stored = projectForStorage(project, '/old/project.abaco.json');
    const readImage = vi.fn().mockResolvedValue(preview);
    const loaded = await hydratePortableProject(stored, '/new/project.abaco.json', readImage);
    expect(readImage).toHaveBeenCalledWith('/new/assets/picture.png');
    expect(loaded.objects.slice(-1)[0]?.asset.sourcePath).toBe('/new/assets/picture.png');
  });

  it('loads an existing proxy when the original image is missing', async () => {
    const project = imageProject();
    project.objects.slice(-1)[0]!.asset.proxyPath = 'assets/recovery.png';
    const readImage = vi.fn().mockRejectedValueOnce(new Error('Original missing')).mockResolvedValueOnce(preview);
    const loaded = await hydratePortableProject(project, '/bundle/project.abaco.json', readImage);
    expect(readImage).toHaveBeenLastCalledWith('/bundle/assets/recovery.png');
    expect(loaded.objects.slice(-1)[0]?.asset.proxyPath).toBe(preview);
  });

  it('does not load stale image assets when an image has been replaced by text', async () => {
    const project = imageProject();
    project.objects.slice(-1)[0]!.kind = 'text';
    project.objects.slice(-1)[0]!.asset.proxyPath = '/missing/image.png';
    const readImage = vi.fn().mockRejectedValue(new Error('Not an image layer'));
    await hydratePortableProject(project, '/bundle/project.abaco.json', readImage);
    expect(readImage).not.toHaveBeenCalled();
  });
});
