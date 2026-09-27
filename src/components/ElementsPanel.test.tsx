import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProject } from '../domain/schema';
import { useEditor } from '../store/editor';
import ElementsPanel from './ElementsPanel';
import { inspectVideo } from '../domain/video';

vi.mock('../domain/video', async (load) => ({ ...await load<typeof import('../domain/video')>(), inspectVideo: vi.fn() }));

beforeEach(() => useEditor.getState().loadProject(createProject(), '/test.abaco.json'));
afterEach(() => { cleanup(); delete window.abaco; vi.unstubAllGlobals(); });

it('inserts the chosen image as an editable 3D plane', async () => {
  class LoadedImage {
    naturalWidth = 300;
    naturalHeight = 200;
    onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', LoadedImage);
  window.abaco = {
    chooseBackground: vi.fn().mockResolvedValue({ path: '/image.png', name: 'Image' }),
    loadAsset: vi.fn().mockResolvedValue('data:image/png;base64,iVBORw0KGgo='),
  } as unknown as NonNullable<Window['abaco']>;
  render(<ElementsPanel mode="add" />);
  fireEvent.click(screen.getByRole('button', { name: 'Image 3D' }));
  await waitFor(() => expect(useEditor.getState().project.objects.some((object) => object.kind === 'plane' && !object.screenSpace && object.asset.previewScale === 1.5)).toBe(true));
});

it('creates a standalone video scene from the Add menu', async () => {
  window.abaco = { chooseVideo: vi.fn().mockResolvedValue({ sourcePath: '/clip.mp4', name: 'Clip' }) } as unknown as NonNullable<Window['abaco']>;
  vi.mocked(inspectVideo).mockResolvedValue({ sourcePath: '/clip.mp4', duration: 4, aspectRatio: 16 / 9 });
  render(<ElementsPanel mode="add" />);
  fireEvent.click(screen.getByRole('button', { name: 'Video scene' }));
  await waitFor(() => expect(useEditor.getState().project.cameraCuts).toHaveLength(2));
  expect(useEditor.getState().project.cameraCuts[1].background.kind).toBe('video');
});
