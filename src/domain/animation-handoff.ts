import type { AbacoProject } from './schema';
import { expandedDirection, resolvePresets } from './direction-presets';
import { ensureAnimationStandard, reconcileDirectionPlans } from './direction-integrity';

export function prepareAnimationProject(project: AbacoProject): AbacoProject {
  const copy = structuredClone(project);
  ensureAnimationStandard(copy);
  const issues = reconcileDirectionPlans(copy);
  copy.animationHandoff = { version: 1, role: 'storyboard', standardVersion: copy.animationStandard?.version, issues };
  if (!copy.animationStandard) issues.push({ severity: 'warning', code: 'no_standard', message: 'Standard di animazione disattivato: lo stile deve essere specificato nella regia.' });
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
      ? `Standard allegato: ${project.animationStandard.name}${project.animationStandard.version ? ` (versione ${project.animationStandard.version})` : ''}. Il testo completo e autorevole della copia allegata è in animationStandard.content nel JSON, nel pacchetto Blender è anche esportato come STANDARD_ANIMAZIONE_ALLEGATO.md. Leggilo integralmente prima di costruire o animare. Rispetta l’eventuale fase di domande preliminari e attendi le risposte richieste; non trasformare da solo una domanda in un’assunzione.`
      : 'Nessuno standard allegato. Le regole stilistiche devono essere ricavate dalle richieste dell’utente; non presumere che un documento esterno sia stato incluso.',
    'La descrizione narrativa è scritta dall’utente e definisce causa, ordine e risultato dell’azione. Prima distribuisci i beat nel tempo, poi costruisci pose fortemente contrastate e infine raccordi e dettagli. Non limitarti a miscelare cursori emotivi o ad accelerare curve già esistenti. Se la descrizione è vuota e gli altri dati non chiariscono cosa succede, chiedila prima di inventare la scena. Gli stati pending/applied dei commenti non equivalgono a una verifica della recitazione finale.',
    '## Interpretazione di tempi e movimento\n\n' + 'Il progetto è uno storyboard, non una recitazione finale verificata. I confini delle scene, fps e durata del progetto vanno conservati. directionPlans[].actions[].performance riporta istruzione, contesto narrativo, energia (0 quasi immobile, 4 esplosiva) e finestra disponibile. durationExplicit=true indica una durata richiesta; altrimenti è un suggerimento adattabile, preservando intenzione ed energia. Gli estremi dei frame descrivono intervalli: da 10 a 15 sono 5 intervalli. Le coordinate del proxy sono indicative salvo vincolo esplicito. Un’energia elevata deve produrre pose più incisive e accenti concentrati, non solo una traslazione più veloce.',
    'Prima dei dettagli costruisci pose estreme diverse e un ritmo leggibile. Usa compressione, slancio e recupero attraverso i controlli del rig quando richiesti dallo stile. Scegli l’interpolazione per ogni fase; non applicare una smussatura automatica globale. Varia le tenute secondo la narrazione. Produci brevi prove dei passaggi rappresentativi prima della rifinitura completa. Se non puoi osservare il movimento a velocità reale, dichiaralo: controlli tecnici e immagini ferme non sono una validazione artistica.',
    ...(project.animationHandoff?.issues.length ? ['## Controlli della consegna', ...project.animationHandoff.issues.map(i => `- ${i.severity}: ${i.message}`)] : []),
    ...scenes.map((scene, index) => {
      const comments = project.comments.filter(c => c.sceneId === scene.id || (!c.sceneId && c.kind !== 'transition' && c.startFrame >= scene.frame && c.startFrame < (scenes[index + 1]?.frame ?? project.settings.frameEnd + 1)));
      const end = (scenes[index + 1]?.frame ?? project.settings.frameEnd + 1) - 1;
      const actions = (project.directionPlans ?? []).flatMap(p => p.actions.filter(a => a.startFrame <= end && a.endFrame >= scene.frame).map(a => ({ plan: p, action: a })));
      const continuity = scene.actionContinuity === 'continue' ? 'Continua l’azione precedente mantenendo postura, appoggi e intenzione; non ricominciare il gesto al taglio.'
        : scene.actionContinuity === 'hold' ? 'Mantieni la posa raggiunta; non aggiungere gesti o cicli automatici.'
          : scene.actionContinuity === 'new_action' ? 'Nuova azione: usa la regia di questa scena. Se manca, occorre definirla prima di inventare eventi.'
            : 'Continuità non specificata: usa il contesto disponibile; se rimangono interpretazioni sostanzialmente diverse, chiedi un chiarimento.';
      const direction = comments.length ? comments.map(c => `### ${c.scope ?? (c.targetIds.length ? 'object' : 'scene')} · ${c.targetIds.map(id => project.objects.find(o => o.id === id)?.name ?? id).join(', ')}\n${expandedDirection(c)}`).join('\n\n') : 'Nessuna descrizione di regia presente.';
      const motions = actions.map(({ plan, action: a }) => `### Movimento · ${project.objects.find(o => o.id === plan.objectId)?.name ?? plan.objectId}\n${a.instruction}\nFrame ${a.startFrame}–${a.endFrame}; ${a.durationSeconds.toFixed(3)} s; durata ${a.durationExplicit ? 'esplicita' : 'suggerita'}${a.performance?.energy !== undefined ? `; energia ${a.performance.energy.toFixed(2)}/4` : ''}.\n${a.performance?.sceneDirection.join('\n') ?? ''}${plan.constraints?.length ? `\nVincoli: ${plan.constraints.join('; ')}` : ''}`);
      return [`## ${scene.name ?? `Scena ${index + 1}`} · frame ${scene.frame}–${end}`, continuity, direction, ...motions].join('\n\n');
    }),
    ...project.comments.filter(c => c.kind === 'transition').map(c => `## Transizione ${c.fromSceneId ?? ''} → ${c.toSceneId ?? ''}\n${c.text}`),
  ].join('\n\n');
}
