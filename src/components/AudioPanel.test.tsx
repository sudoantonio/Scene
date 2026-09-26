import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, ProjectSchema } from '../domain/schema';
import { useEditor } from '../store/editor';
import AudioPanel from './AudioPanel';

beforeEach(() => {
  useEditor.getState().loadProject(createProject(), '/test.abaco.json');
  useEditor.getState().addAudio({ sourcePath: '/voice.wav', name: 'Voice', duration: 3, waveform: [] });
});
afterEach(() => { cleanup(); delete window.abaco; vi.restoreAllMocks(); });

describe('Local audio subtitles', () => {
  it('transcribes locally and saves editable timed captions with the project', async () => {
    const transcribeAudio = vi.fn().mockResolvedValue([{ start: .2, end: 1.5, text: 'Hello world' }]);
    window.abaco = { transcribeAudio } as unknown as NonNullable<Window['abaco']>;
    render(<AudioPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe locally' }));
    await waitFor(() => expect(screen.getByLabelText('Subtitle text')).toHaveValue('Hello world'));
    expect(transcribeAudio).toHaveBeenCalledWith('/voice.wav', 'it-IT');
    fireEvent.change(screen.getByLabelText('Subtitle text'), { target: { value: 'Ciao mondo' } });
    const audio = ProjectSchema.parse(useEditor.getState().project).objects.find((object) => object.kind === 'audio')!;
    expect(audio.audio.captions[0].text).toBe('Ciao mondo');
    expect(audio.audio.captions[0].start).toBe(.2);
  });
});
