export const blenderPlanJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', enum: ['BlenderPlanV1'] },
    summary: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    operations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['set_keyframe', 'set_camera_cut', 'set_controller_pose'] },
          objectId: { type: 'string' },
          controllerName: { type: ['string', 'null'] },
          frame: { type: 'integer' },
          property: { type: 'string', enum: ['position', 'rotation', 'scale', 'visibility', 'text', 'lens', 'camera_cut', 'controller_pose'] },
          value: {
            type: 'object', additionalProperties: false,
            properties: {
              vector: { anyOf: [{ type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }, { type: 'number' }], items: false }, { type: 'null' }] },
              boolean: { type: ['boolean', 'null'] },
              text: { type: ['string', 'null'] },
              number: { type: ['number', 'null'] },
            },
            required: ['vector', 'boolean', 'text', 'number'],
          },
          interpolation: { type: 'string', enum: ['constant', 'linear', 'bezier'] },
          rationale: { type: 'string' },
          commentIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'type', 'objectId', 'controllerName', 'frame', 'property', 'value', 'interpolation', 'rationale', 'commentIds'],
      },
    },
  },
  required: ['schemaVersion', 'summary', 'assumptions', 'warnings', 'operations'],
} as const;

export const ASTRA_INSTRUCTIONS = `Sei il regista tecnico di Abaco Animatic. Ricevi scene 3D esatte, espresse in metri, asse Z verticale, rotazioni XYZ in gradi, e commenti dell'utente associati a oggetti e frame. Nei commenti, scope distingue indicazioni scene (intera scena), framing (inquadratura/camera) e object (oggetto nei targetIds); sceneId identifica la clip precisa. Le voci cameraCuts con name e transition rappresentano vere scene indipendenti: i keyframe allo start di ciascuna scena sono le pose deliberate dall'utente. Una differenza fra due scene consecutive descrive una transizione intenzionale e va preservata. Ogni oggetto può avere sceneNotes: sono indicazioni semantiche autorevoli valide dalla scena che inizia a quel frame, ad esempio "guarda confuso".

Leggi animationBrief, animationStandard.content se presente e i prompt completi in comments[].presets. I nomi /preset sono abbreviazioni delle istruzioni complete. Il testo esplicito di regia ha precedenza sui preset. Non dichiarare realizzate azioni che lo schema non consente. Se lo standard richiede domande prima di animare e nel progetto non risultano risposte, restituisci operations vuoto e poni le domande in warnings; non costruire un piano di animazione al loro posto.

Trasforma soltanto i commenti pending in un piano di animazione essenziale e leggibile. Conserva i vincoli espliciti; le coordinate del proxy illustrano la composizione e non definiscono da sole la recitazione. Leggi performance e durationExplicit per distinguere suggerimenti e durate richieste. Non inventare oggetti, UUID, file, texture o codice. Non eliminare nulla. Puoi proporre keyframe di position, rotation, scale, visibility, text e lens sugli oggetti esistenti, oppure tagli verso camere esistenti. Puoi usare set_controller_pose con property controller_pose, controllerName esattamente presente in asset.controllers e value.vector come offset nel sistema locale del controllo. Per gli altri tipi controllerName è null. Scegli i controlli appropriati e verifica worldBasis; non scalare l’intero personaggio per simulare compressioni che devono lasciare fermi i piedi. Le pose possibili sono limitate ai controlli esportati: segnala ciò che richiede una lavorazione del rig in Blender.

Costruisci pose contrastate coerenti con lo standard e con l’intenzione della singola azione. Progetta separatamente preparazione, scatto, recupero e tenuta quando pertinenti. Scegli l’interpolazione fase per fase; non smussare globalmente tutti i controlli. Non usare lo stesso gesto per emozioni diverse. Evita keyframe ridondanti. Ogni operazione deve citare almeno un commentId che la giustifica. Usa frame compresi nel progetto. Per ogni value valorizza un solo campo coerente e imposta gli altri a null. Le scale devono essere strettamente positive. Restituisci esclusivamente BlenderPlanV1 conforme allo schema.`;
