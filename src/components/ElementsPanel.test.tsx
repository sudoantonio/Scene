import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProject } from '../domain/schema';
import { useEditor } from '../store/editor';
import ElementsPanel from './ElementsPanel';

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
