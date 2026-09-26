import { useEffect, useRef } from 'react';
import { audioStateAt } from '../domain/media-timeline';
import { inspectAudio } from '../domain/audio';
import { useEditor } from '../store/editor';

type Player = { element: HTMLAudioElement; sourcePath: string };

export default function AudioPlayback() {
  const project = useEditor((state) => state.project);
  const frame = useEditor((state) => state.currentFrame);
  const playing = useEditor((state) => state.isPlaying);
  const players = useRef(new Map<string, Player>());
  const sounds = project.objects.filter((object) => object.kind === 'audio' && object.asset.sourcePath);
  const signature = sounds.map((sound) => `${sound.id}:${sound.asset.sourcePath}`).join('|');

  useEffect(() => {
    let cancelled = false;
    const wanted = new Set(sounds.map((sound) => sound.id));
    for (const [id, player] of players.current) if (!wanted.has(id)) { player.element.pause(); players.current.delete(id); }
    for (const sound of sounds) {
      const current = players.current.get(sound.id);
      if (current?.sourcePath === sound.asset.sourcePath) continue;
      current?.element.pause();
      void (async () => {
        try {
          const source = window.abaco ? await window.abaco.loadAsset(sound.asset.sourcePath) : sound.asset.sourcePath;
          if (cancelled) return;
          const element = new Audio(source);
          element.preload = 'auto';
          players.current.set(sound.id, { element, sourcePath: sound.asset.sourcePath });
          if (sound.audio.waveform.length < Math.min(8192, Math.max(120, Math.ceil(sound.audio.duration * 60)))) {
            const analysis = await inspectAudio(source);
            const latest = useEditor.getState().project.objects.find((object) => object.id === sound.id && object.kind === 'audio');
            if (latest) useEditor.getState().updateObject(sound.id, { audio: { ...latest.audio, duration: analysis.duration, trimEnd: latest.audio.trimEnd > latest.audio.trimStart ? latest.audio.trimEnd : analysis.duration, waveform: analysis.waveform } });
          }
        } catch { /* il pannello mantiene visibile l'asset mancante */ }
      })();
    }
    return () => { cancelled = true; };
  }, [signature]);

  useEffect(() => {
    for (const sound of sounds) {
      const element = players.current.get(sound.id)?.element;
      if (!element) continue;
      const state = audioStateAt(project, sound, frame, Number.isFinite(element.duration) ? element.duration : sound.audio.duration);
      if (!state) { element.pause(); continue; }
      const expected = state.sourceTime;
      element.volume = Math.max(0, Math.min(1, state.gain));
      if (!playing || Math.abs(element.currentTime - expected) > .18) {
        try { element.currentTime = expected; } catch { /* metadata non ancora pronta */ }
      }
      if (playing) void element.play().catch(() => undefined); else element.pause();
    }
  }, [frame, playing, project, signature]);

  useEffect(() => () => { for (const player of players.current.values()) player.element.pause(); players.current.clear(); }, []);
  return null;
}
