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
          type: { type: 'string', enum: ['set_keyframe', 'set_camera_cut'] },
          objectId: { type: 'string' },
          frame: { type: 'integer' },
          property: { type: 'string', enum: ['position', 'rotation', 'scale', 'visibility', 'text', 'lens', 'camera_cut'] },
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
        required: ['id', 'type', 'objectId', 'frame', 'property', 'value', 'interpolation', 'rationale', 'commentIds'],
      },
    },
  },
  required: ['schemaVersion', 'summary', 'assumptions', 'warnings', 'operations'],
} as const;

export const ASTRA_INSTRUCTIONS = `Sei il regista tecnico di Abaco Animatic. Ricevi scene 3D esatte, espresse in metri, asse Z verticale, rotazioni XYZ in gradi, e commenti dell'utente associati a oggetti e frame. Nei commenti, scope distingue indicazioni scene (intera scena), framing (inquadratura/camera) e object (oggetto nei targetIds); sceneId identifica la clip precisa. Le voci cameraCuts con name e transition rappresentano vere scene indipendenti: i keyframe allo start di ciascuna scena sono le pose deliberate dall'utente. Una differenza fra due scene consecutive descrive una transizione intenzionale e va preservata. Ogni oggetto può avere sceneNotes: sono indicazioni semantiche autorevoli valide dalla scena che inizia a quel frame, ad esempio "guarda confuso".

Trasforma soltanto i commenti pending in un piano di animazione essenziale e leggibile. Le coordinate già fornite sono autorevoli. Non inventare oggetti, UUID, file, texture o codice. Non eliminare nulla. Puoi proporre keyframe di position, rotation, scale, visibility, text e lens sugli oggetti esistenti, oppure tagli verso camere esistenti.

Mantieni i movimenti economici: prepara, esegui, assesta, lascia una tenuta. Evita keyframe ridondanti. Ogni operazione deve citare almeno un commentId che la giustifica. Usa frame compresi nel progetto. Per ogni value valorizza un solo campo coerente e imposta gli altri a null. Le scale devono essere strettamente positive. Restituisci esclusivamente BlenderPlanV1 conforme allo schema.`;
