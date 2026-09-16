import type { DirectionPreset, SceneComment, TimelineCommentScope } from './schema';

const acting = 'Adatta la posa alla morfologia e ai controlli realmente presenti nel personaggio. Conserva identità, eventuale assenza della bocca e contatti già stabiliti. Nel registro cartoon usa silhouette nette, asimmetrie motivate, gesti rapidi e tenute leggibili; anticipazione, overshoot e assestamento solo quando sostengono l’intenzione. Non aggiungere dialoghi, oggetti o gag. Raccorda la posa allo stato precedente senza un ritorno obbligatorio al neutro.';
const movement = 'Rispetta i tempi, i bersagli e gli appoggi della scena. Coordina sguardo, corpo e arti, preservando prese e contatti. Il percorso del proxy è indicativo salvo un vincolo esplicito. Non introdurre un nuovo evento narrativo. Se manca una destinazione che cambia il significato dell’azione, chiedila prima di animare.';
const camera = 'Rispetta composizione, durata e tagli stabiliti. Il movimento deve mantenere leggibile il soggetto e i suoi gesti. Non aggiungere movimenti secondari automatici. Se direzione, bersaglio o motivazione non sono deducibili, includili nelle domande preliminari.';
const preset = (id: string, label: string, category: DirectionPreset['category'], prompt: string): DirectionPreset => ({ id, label, category, version: 1, prompt: `${prompt}\n\n${category === 'emotion' ? acting : category === 'movement' ? movement : camera}` });

export const DIRECTION_PRESETS: DirectionPreset[] = [
  preset('entusiasta', 'Entusiasta', 'emotion', 'Esprimi entusiasmo con postura aperta, busto energico, sguardo vivo e sopracciglia sollevate. Il personaggio si prepara con slancio all’azione descritta; le braccia amplificano l’intenzione senza agitazione continua. Arriva rapidamente su una posa espansiva e mantienila quanto basta per leggerla.'),
  preset('felice', 'Felice', 'emotion', 'Comunica felicità con un corpo disteso e aperto, occhi luminosi e gesti leggeri. Usa il viso disponibile senza inventare un sorriso se il personaggio non ha bocca. Distingui la gioia dall’eccitazione frenetica con una posa soddisfatta e pause serene.'),
  preset('sorpreso', 'Sorpreso', 'emotion', 'Fai leggere il momento della scoperta: arresto dell’azione precedente, occhi che si aprono, sopracciglia alte e un rapido allungamento o arretramento del corpo. Segui lo scatto con un assestamento elastico e una tenuta evidente. Non anticipare la scoperta e non inserire automaticamente un salto.'),
  preset('spaventato', 'Spaventato', 'emotion', 'Rendi la paura attraverso un riflesso di ritrazione, occhi molto aperti, postura difensiva e mani che si raccolgono quando libere. Individua lo stimolo nella scena e orienta lo sguardo verso di esso. Mantieni una breve tensione dopo lo scatto, evitando tremori casuali o fughe non richieste.'),
  preset('confuso', 'Confuso', 'emotion', 'Esprimi confusione con inclinazione del capo o del corpo, sopracciglia asimmetriche e un gesto interrogativo che si interrompe. Lo sguardo cerca informazioni nel bersaglio pertinente. Alterna un tentativo breve e una pausa di comprensione; evita oscillazioni ripetitive.'),
  preset('curioso', 'Curioso', 'emotion', 'Dirigi prima lo sguardo verso lo stimolo, poi inclina il busto per osservarlo con attenzione. Rendi evidente il desiderio di capire attraverso una posa protesa e sopracciglia vive. Lascia una pausa di osservazione; non spostare tutto il personaggio se non è richiesto.'),
  preset('scocciato', 'Scocciato', 'emotion', 'Comunica fastidio con postura afflosciata, spalle basse, mani rilassate se libere, occhi socchiusi e sopracciglia inclinate. Passa alla posa con un cedimento rapido e un breve assestamento. Mantieni un’espressione netta, evitando che il fastidio diventi automaticamente rabbia o un nuovo gesto narrativo.'),
  preset('arrabbiato', 'Arrabbiato', 'emotion', 'Concentra la rabbia in una postura tesa, sguardo fisso e sopracciglia contratte. Usa appoggi decisi, compressione del busto e pochi accenti bruschi. Le mani possono irrigidirsi solo se compatibile con ciò che tengono. Evita gesticolazione continua e azioni aggressive non descritte.'),
  preset('triste', 'Triste', 'emotion', 'Esprimi tristezza con sguardo basso, postura raccolta e peso che cede in modo leggibile. Usa un contrasto chiaro rispetto alla posa precedente e pause più lunghe. Mantieni la recitazione caricaturale senza imporre scatti allegri, pianto o lacrime non richiesti.'),
  preset('concentrato', 'Concentrato', 'emotion', 'Fissa l’attenzione sul compito: sguardo preciso, sopracciglia raccolte e corpo orientato verso il bersaglio. Esegui gesti brevi e deliberati con arresti di verifica. La concentrazione deve risultare evidente senza continui movimenti degli occhi o rigidità uniforme.'),
  preset('imbarazzato', 'Imbarazzato', 'emotion', 'Comunica imbarazzo con postura leggermente chiusa, sguardo che si distoglie dal bersaglio e asimmetria del corpo. Un gesto esitante e una pausa devono rendere leggibile il disagio. Non aggiungere rossore, dialoghi o gesti convenzionali incompatibili con la situazione.'),
  preset('sicuro', 'Sicuro', 'emotion', 'Mostra sicurezza con appoggi stabili, busto aperto, sguardo diretto e gesti ampi ma controllati. Raggiungi la posa con decisione e mantienila senza oscillare. Evita di introdurre arroganza o una gag non prevista.'),
  preset('si-avvicina', 'Si avvicina', 'movement', 'Il personaggio raggiunge il bersaglio indicato con passi coordinati alla distanza. Orienta lo sguardo prima della partenza; prepara il trasferimento del peso, alterna piedi in sostegno e avanzamento e completa l’arresto con appoggi stabili. Il corpo non deve scivolare sopra piedi fermi. Adatta l’andatura all’emozione selezionata.'),
  preset('si-allontana', 'Si allontana', 'movement', 'Il personaggio aumenta la distanza dal bersaglio verso la destinazione prevista. Scegli avanzamento o passi all’indietro secondo la regia e l’attenzione richiesta. Coordina falcate, peso e ritmo; mantieni orientamento e oggetti impugnati coerenti. Concludi con un arresto leggibile.'),
  preset('si-gira', 'Si gira', 'movement', 'Il personaggio si orienta verso il bersaglio previsto. Anticipa con gli occhi, trasferisci il peso e riposiziona i piedi se l’ampiezza della rotazione lo richiede. Raccorda busto e mani, evitando una rotazione rigida dell’intero asset o piedi che pattinano.'),
  preset('indica', 'Indica', 'movement', 'Il personaggio indica il bersaglio descritto con una mano libera. Lo sguardo chiarisce il riferimento, il braccio percorre un arco breve e la posa finale rende evidente la direzione. Adatta il gesto alle dita realmente disponibili, senza modificarne il numero, e mantieni la posa per renderla leggibile.'),
  preset('afferra', 'Afferra', 'movement', 'Il personaggio raggiunge l’oggetto indicato con una mano disponibile: avvicinamento, contatto, chiusura della presa e trasporto. Mantieni il rapporto mano-oggetto dopo il contatto, senza salti di posizione o compenetrazioni. Non creare oggetti diversi da quelli descritti nella scena.'),
  preset('lascia-cadere', 'Lascia cadere', 'movement', 'Il personaggio rilascia l’oggetto che sta tenendo al momento narrativo previsto. Apri la presa, fai partire il moto libero dalla posizione e velocità effettive e segui la caduta fino all’appoggio pertinente. Conserva la continuità fra oggetto vincolato e libero; non teletrasportarlo a terra.'),
  preset('mani-al-viso', 'Mani al viso', 'movement', 'Il personaggio porta le mani libere verso la zona del viso pertinente alla scena. Coordina archi delle braccia e reazione del corpo; mantieni le mani aderenti alla superficie anche durante squash/stretch senza attraversarla. Se una mano è occupata, risolvi la sequenza di rilascio con la regia, non facendo sparire l’oggetto.'),
  preset('sobbalza', 'Sobbalza', 'movement', 'Esegui un sobbalzo breve motivato dall’evento descritto, con contrasto fra compressione e allungamento e un recupero elastico. Se c’è distacco da terra, mostra entrambi i piedi in volo e un atterraggio con assorbimento e contatto effettivo. Conserva una posa leggibile dopo il sobbalzo.'),
  preset('camera-statica', 'Camera statica', 'camera', 'Mantieni invariati posizione, orientamento e focale durante l’intervallo richiesto. Non aggiungere oscillazioni, inseguimenti, zoom o correzioni automatiche. I movimenti del personaggio devono rispettare l’inquadratura. Un’eccezione può avvenire soltanto nel momento esplicitamente descritto dall’utente.'),
  preset('panoramica', 'Panoramica', 'camera', 'Ruota la camera dalla posizione fissa per seguire o rivelare il bersaglio descritto. Conserva la focale e separa partenza, rotazione e arresto senza derive. Direzione, estensione e momento della panoramica devono derivare dalla regia, non da movimenti casuali.'),
  preset('camera-avanza', 'Camera avanza', 'camera', 'Avvicina fisicamente la camera al bersaglio lungo il percorso previsto, mantenendo la focale. Preserva composizione e leggibilità durante il cambiamento di prospettiva. Prepara una partenza controllata e un arresto chiaro senza attraversare il soggetto o gli oggetti.'),
  preset('camera-arretra', 'Camera arretra', 'camera', 'Allontana fisicamente la camera per ampliare la lettura dello spazio o del soggetto, conservando la focale. Mantieni il centro d’interesse pertinente e un percorso privo di attraversamenti. La rivelazione di elementi deve corrispondere alla scena descritta.'),
  preset('camera-segue', 'Camera segue', 'camera', 'Trasla la camera per accompagnare il soggetto lungo il movimento previsto. Mantieni una composizione intenzionale e una distanza coerente; coordina orientamento e traslazione senza inseguimenti nervosi. Non cancellare l’impressione del moto bloccando ogni variazione del soggetto.'),
  preset('zoom', 'Zoom', 'camera', 'Modifica la focale mantenendo fissi posizione e orientamento della camera. Il soggetto verso cui stringere o da cui allargare deve essere indicato dalla regia. Rispetta valori iniziali e finali prescritti e concludi con una tenuta stabile; non confondere lo zoom con uno spostamento fisico.'),
  preset('camera-a-mano', 'Camera a mano', 'camera', 'Simula una camera sostenuta o toccata manualmente secondo la regia: piccoli spostamenti e rotazioni motivati dal peso e dal contatto. Se viene aggiustata dal personaggio, sincronizza gli impulsi con le mani. Evita rumore continuo; raggiungi una posa stabile quando il gesto termina.'),
];

export function presetsForScope(scope: TimelineCommentScope) {
  return scope === 'scene' ? [] : DIRECTION_PRESETS.filter(p => scope === 'framing' ? p.category === 'camera' : p.category !== 'camera');
}
const tokens = (text: string) => [...text.matchAll(/(?:^|\s)\/([a-z][a-z0-9-]*)(?=$|\s|[.,;:!?])/g)].map(m => m[1]);
export function resolvePresets(text: string, scope: TimelineCommentScope, previous: DirectionPreset[] = []): DirectionPreset[] {
  const allowed = presetsForScope(scope);
  return [...new Set(tokens(text))].flatMap(id => {
    const found = previous.find(p => p.id === id && (scope === 'framing' ? p.category === 'camera' : scope === 'object' && p.category !== 'camera')) ?? allowed.find(p => p.id === id);
    return found ? [structuredClone(found)] : [];
  });
}
export function expandedDirection(comment: SceneComment): string {
  const scope = comment.scope ?? (comment.targetIds.length ? 'object' : 'scene');
  const presets = resolvePresets(comment.text, scope, comment.presets);
  if (!presets.length) return comment.text;
  const corePrompt = (preset: DirectionPreset) => preset.prompt.split(/\n\s*\n/, 1)[0].trim();
  const emotions = presets.filter(preset => preset.category === 'emotion');
  const movements = presets.filter(preset => preset.category === 'movement');
  const cameras = presets.filter(preset => preset.category === 'camera');
  const sections: string[] = [comment.text];
  if (emotions.length > 1) {
    sections.push([
      `#### Progressione emotiva obbligatoria: ${emotions.map(preset => preset.label).join(' → ')}`,
      'Interpreta queste emozioni come beat successivi nell’ordine indicato, salvo che il testo libero dichiari esplicitamente una compresenza. Non mediarle in un’unica posa. Per ogni passaggio cambia in modo riconoscibile postura, silhouette, sguardo e qualità del movimento.',
      ...emotions.map((preset, index) => `${index + 1}. **${preset.label}** · ${corePrompt(preset)}`),
    ].join('\n'));
  } else if (emotions[0]) {
    sections.push(`[Preset ${emotions[0].label} · v${emotions[0].version}]\n${corePrompt(emotions[0])}`);
  }
  if (movements.length) sections.push(`#### Azioni e movimenti\n${movements.map(preset => `- **${preset.label}** · ${corePrompt(preset)}`).join('\n')}`);
  for (const preset of cameras) sections.push(`[Preset ${preset.label} · v${preset.version}]\n${corePrompt(preset)}`);
  const constraints = [emotions.length && acting, movements.length && movement, cameras.length && camera].filter(Boolean).join('\n\n');
  if (constraints) sections.push(`#### Vincoli condivisi\n${constraints}`);
  return sections.join('\n\n');
}
