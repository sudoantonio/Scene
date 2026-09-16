import type { AbacoProject } from './schema';
import { expandedDirection, resolvePresets } from './direction-presets';

export function prepareAnimationProject(project: AbacoProject): AbacoProject {
  const copy = structuredClone(project);
  for (const comment of copy.comments) {
    if (comment.kind === 'transition') continue;
    comment.presets = resolvePresets(comment.text, comment.scope ?? (comment.targetIds.length ? 'object' : 'scene'), comment.presets);
  }
  copy.animationBrief = buildAnimationBrief(copy);
  return copy;
}
export function buildAnimationBrief(project: AbacoProject): string {
  const scenes = project.cameraCuts.slice().sort((a, b) => a.frame - b.frame);
  return [
    '# Consegna all’AI animatrice',
    'Scene contiene uno storyboard e indicazioni di regia. Realizza la recitazione sul personaggio originale in Blender. Le trasformazioni del proxy non descrivono da sole pose del rig, espressioni, appoggi o prese. Ispeziona asset e rig e interpreta le coordinate nel sistema corretto.',
    'I nomi /preset sono abbreviazioni: le descrizioni complete sono in comments[].presets[].prompt e la sintesi operativa è riportata sotto. Le emozioni multiple formano una progressione nell’ordine mostrato: ciascuna richiede un beat e una posa dominante distinti. Sovrapponile soltanto quando il testo libero lo richiede esplicitamente e stabilisce quale guida la recitazione. Le azioni descrivono ciò che accade dentro quei beat. Le indicazioni esplicite dell’utente hanno precedenza sui preset.',
    project.animationStandard
      ? `Standard allegato: ${project.animationStandard.name}. Il testo completo e autorevole della copia allegata è in animationStandard.content nel JSON, ed è anche esportato come STANDARD_ANIMAZIONE_ALLEGATO.md. Leggilo integralmente prima di costruire o animare. Rispetta l’eventuale fase di domande preliminari e attendi le risposte richieste; non trasformare da solo una domanda in un’assunzione.`
      : 'Nessuno standard allegato. Le regole stilistiche devono essere ricavate dalle richieste dell’utente; non presumere che un documento esterno sia stato incluso.',
    'La descrizione narrativa è scritta dall’utente e definisce causa, ordine e risultato dell’azione. Prima distribuisci i beat nel tempo, poi costruisci pose fortemente contrastate e infine raccordi e dettagli. Non limitarti a miscelare cursori emotivi o ad accelerare curve già esistenti. Se la descrizione è vuota e gli altri dati non chiariscono cosa succede, chiedila prima di inventare la scena. Gli stati pending/applied dei commenti non equivalgono a una verifica della recitazione finale.',
    ...scenes.map((scene, index) => {
      const comments = project.comments.filter(c => c.sceneId === scene.id || (!c.sceneId && c.kind !== 'transition' && c.startFrame >= scene.frame && c.startFrame < (scenes[index + 1]?.frame ?? project.settings.frameEnd + 1)));
      return `## ${scene.name ?? `Scena ${index + 1}`} · frame ${scene.frame}–${(scenes[index + 1]?.frame ?? project.settings.frameEnd + 1) - 1}\n` + (comments.length ? comments.map(c => `### ${c.scope ?? (c.targetIds.length ? 'object' : 'scene')} · ${c.targetIds.map(id => project.objects.find(o => o.id === id)?.name ?? id).join(', ')}\n${expandedDirection(c)}`).join('\n\n') : 'Nessuna descrizione di regia presente.')
    }),
    ...project.comments.filter(c => c.kind === 'transition').map(c => `## Transizione ${c.fromSceneId ?? ''} → ${c.toSceneId ?? ''}\n${c.text}`),
  ].join('\n\n');
}
