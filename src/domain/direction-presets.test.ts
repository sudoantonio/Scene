import { describe, expect, it } from 'vitest';
import { createProject, ProjectSchema } from './schema';
import { DIRECTION_PRESETS, expandedDirection, resolvePresets } from './direction-presets';
import { prepareAnimationProject } from './animation-handoff';
import { useEditor } from '../store/editor';
import { hydratePortableProject, projectForStorage } from '../../electron/project-storage';

describe('Regia con preset e standard portatili', () => {
  it('combina preset nel testo senza interpretare percorsi e senza duplicarli', () => {
    const found = resolvePresets('/scocciato /si-avvicina verso la camera. /scocciato /inesistente /tmp/a.blend', 'object');
    expect(found.map(p => p.id)).toEqual(['scocciato', 'si-avvicina']);
    expect(resolvePresets('/camera-statica /scocciato', 'framing').map(p => p.id)).toEqual(['camera-statica']);
    expect(resolvePresets('/scocciato', 'scene').map(p => p.id)).toEqual(['scocciato']);
  });
  it('mantiene la versione del prompt salvato anche dopo un cambio del catalogo', () => {
    const original = { ...DIRECTION_PRESETS[0], version: 8, prompt: 'Versione approvata nel progetto' };
    expect(resolvePresets('/entusiasta', 'object', [original])[0]).toEqual(original);
    expect(resolvePresets('Testo senza preset', 'object', [original])).toEqual([]);
  });
  it('esporta più emozioni come progressione ordinata e non come miscela', () => {
    const comment = {
      id: crypto.randomUUID(), text: '/sicuro /sorpreso /spaventato /scocciato /mani-al-viso controlla la bocca',
      scope: 'object' as const, targetIds: [crypto.randomUUID()], startFrame: 1, endFrame: 72,
      status: 'pending' as const,
    };
    const expanded = expandedDirection(comment);
    expect(expanded).toContain('Progressione emotiva obbligatoria: Confident → Surprised → Frightened → Annoyed');
    expect(expanded).toContain('Non mediarle in un’unica posa');
    expect(expanded).toContain('#### Azioni e movimenti');
    expect(expanded.match(/#### Vincoli condivisi/g)).toHaveLength(1);
    expect(expanded.match(/Adatta la posa alla morfologia/g)).toHaveLength(1);
  });
  it('salva più preset, li riapre e rimuove le istruzioni dei token cancellati', () => {
    useEditor.getState().loadProject(createProject(), '/test.abaco.json');
    useEditor.getState().addObject('sphere');
    const p = useEditor.getState().project;
    const target = p.objects.find(o => o.kind === 'sphere')!;
    useEditor.getState().setTimelineComment('object', p.cameraCuts[0].id, '/scocciato /si-avvicina al bersaglio', target.id);
    const saved = ProjectSchema.parse(JSON.parse(JSON.stringify(useEditor.getState().project)));
    expect(saved.comments[0].presets).toHaveLength(2);
    useEditor.getState().loadProject(saved, '/test.abaco.json');
    useEditor.getState().setTimelineComment('object', p.cameraCuts[0].id, '/scocciato', target.id);
    expect(useEditor.getState().project.comments[0].presets).toHaveLength(1);
    expect(expandedDirection(useEditor.getState().project.comments[0])).not.toContain('[Preset Approaches');
  });
  it('unifica le vecchie note della scena e conserva i bersagli di @camera e @elemento', () => {
    const project = createProject();
    useEditor.getState().loadProject(project, '/test.abaco.json');
    useEditor.getState().addObject('cube');
    const current = useEditor.getState().project;
    const scene = current.cameraCuts[0];
    const camera = current.objects.find(o => o.id === scene.cameraId)!;
    const cube = current.objects.find(o => o.name === 'Cube 1')!;
    useEditor.getState().setTimelineComment('framing', scene.id, 'Mantieni la vista', camera.id);
    useEditor.getState().setTimelineComment('object', scene.id, 'Entra in scena', cube.id);
    expect(useEditor.getState().project.comments).toHaveLength(2);
    useEditor.getState().setSceneDirection(scene.id, `@${camera.name} /camera-statica. @${cube.name} /si-avvicina.`);
    const [saved] = useEditor.getState().project.comments;
    expect(useEditor.getState().project.comments).toHaveLength(1);
    expect(saved).toMatchObject({ scope: 'scene', sceneId: scene.id, targetIds: [camera.id, cube.id] });
    expect(saved.presets?.map(p => p.id)).toEqual(['camera-statica', 'si-avvicina']);
    const expanded = expandedDirection(saved);
    expect(expanded).toContain('Non aggiungere movimenti secondari automatici');
    expect(expanded).toContain('Coordina sguardo, corpo e arti');
    useEditor.getState().undo();
    expect(useEditor.getState().project.comments).toHaveLength(2);
  });
  it('include lo standard e i prompt nel JSON senza dipendere dal file originale', async () => {
    const p = createProject();
    p.animationStandard = { name: 'regia.md', content: 'Prima chiedi come costruire la scena e attendi.', attachedAt: '2026-09-15T12:00:00Z' };
    p.comments.push({ id: crypto.randomUUID(), text: '/camera-statica', scope: 'framing', sceneId: p.cameraCuts[0].id, targetIds: [p.objects[0].id], startFrame: 1, endFrame: 72, status: 'pending' });
    const prepared = prepareAnimationProject(p);
    const stored = ProjectSchema.parse(JSON.parse(JSON.stringify(projectForStorage(prepared, '/old/scene.abaco.json'))));
    const reopened = await hydratePortableProject(stored, '/new/scene.abaco.json', async () => { throw Error('Non deve leggere il documento originale'); });
    expect(reopened.animationStandard).toEqual(p.animationStandard);
    expect(reopened.comments[0].presets?.[0].prompt).toContain('Mantieni invariati');
    expect(reopened.animationBrief).toContain('attendi le risposte');
    expect(reopened.animationBrief).toContain('[Preset Static camera');
    expect(p.comments[0].presets).toBeUndefined();
  });
  it('rende esplicita nel brief la costruzione per beat e pose contrastate', () => {
    const p = createProject();
    const target = p.objects[0];
    p.comments.push({ id: crypto.randomUUID(), text: '/sorpreso /spaventato /scocciato', scope: 'object', sceneId: p.cameraCuts[0].id, targetIds: [target.id], startFrame: 1, endFrame: 72, status: 'pending' });
    const brief = prepareAnimationProject(p).animationBrief!;
    expect(brief).toContain('Surprised → Frightened → Annoyed');
    expect(brief).toContain('Non limitarti a miscelare cursori emotivi');
  });
  it('mantiene i vecchi progetti validi e la descrizione narrativa vuota', () => {
    const legacy = createProject();
    delete legacy.animationStandard;
    const p = ProjectSchema.parse(legacy);
    expect(p.animationStandard).toBeUndefined();
    expect(prepareAnimationProject(p).animationStandard?.version).toBe('2026-09-26.1');
    expect(prepareAnimationProject(p).comments).toEqual([]);
  });
  it('allega e rimuove il documento con undo senza alterare le scene', () => {
    useEditor.getState().loadProject(createProject(), '/test.abaco.json');
    const standard = { name: 'regia.md', content: 'Chiedi prima.', attachedAt: '2026-09-15T12:00:00Z' };
    useEditor.getState().setAnimationStandard(standard);
    expect(useEditor.getState().dirty).toBe(true);
    useEditor.getState().setAnimationStandard(undefined);
    expect(useEditor.getState().project.animationStandard).toBeUndefined();
    useEditor.getState().undo();
    expect(useEditor.getState().project.animationStandard).toEqual(standard);
    expect(useEditor.getState().project.comments).toEqual([]);
  });
});
