import { useEffect, useRef } from 'react';
import { objectPresenceRange } from '../domain/presence';
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
          if (!sound.audio.waveform.length) {
            const analysis = await inspectAudio(source);
            const latest = useEditor.getState().project.objects.find((object) => object.id === sound.id && object.kind === 'audio');
            if (latest) useEditor.getState().updateObject(sound.id, { audio: { ...latest.audio, duration: analysis.duration, trimEnd: analysis.duration, waveform: analysis.waveform } });
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
      const range = objectPresenceRange(sound, project.settings.frameStart, project.settings.frameEnd + 1);
      if (!range || sound.audio.muted) { element.pause(); continue; }
      const clipElapsed = Math.max(0, (frame - range[0]) / project.settings.fps);
      const sourceEnd = sound.audio.trimEnd > sound.audio.trimStart ? sound.audio.trimEnd : sound.audio.duration || element.duration;
      const sourceLength = Math.max(.01, sourceEnd - sound.audio.trimStart);
      const playableElapsed = sound.audio.loop ? clipElapsed % sourceLength : clipElapsed;
      if (!sound.audio.loop && playableElapsed >= sourceLength) { element.pause(); continue; }
      const expected = sound.audio.trimStart + playableElapsed;
      const clipDuration = Math.max(.01, (range[1] - range[0]) / project.settings.fps);
      const fadeIn = sound.audio.fadeIn ? Math.min(1, clipElapsed / sound.audio.fadeIn) : 1;
      const fadeOut = sound.audio.fadeOut ? Math.min(1, Math.max(0, clipDuration - clipElapsed) / sound.audio.fadeOut) : 1;
      element.volume = Math.max(0, Math.min(1, sound.audio.volume * fadeIn * fadeOut));
      if (!playing || Math.abs(element.currentTime - expected) > .18) {
        try { element.currentTime = expected; } catch { /* metadata non ancora pronta */ }
      }
      if (playing) void element.play().catch(() => undefined); else element.pause();
    }
  }, [frame, playing, project, signature]);

  useEffect(() => () => { for (const player of players.current.values()) player.element.pause(); players.current.clear(); }, []);
  return null;
}
