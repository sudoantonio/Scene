import { writeFile } from 'node:fs/promises';
import { applyAgentCommands, type AgentAsset, type AgentCommand } from '../src/domain/agent-commands';
import { createProject } from '../src/domain/schema';

const [destination, roomPath] = process.argv.slice(2);
if (!destination || !roomPath) throw new Error('Uso: create-ub-salotto progetto.abaco.json Ab-salotto.glb');
const roomAsset: AgentAsset = { id: crypto.randomUUID(), kind: 'model', name: 'Ab-salotto.glb', sourcePath: roomPath };
const shots = [
  { name: 'Ub ha comprato casa', frames: 144, camera: { position: [0, -10, 4.2] as [number, number, number], target: [0, -.2, 2.5] as [number, number, number], lens: 24 }, note: '[shocked] Ub... is that your new house?!\nYou invested in AI stocks, sold them at a profit... and actually bought a house?' },
  { name: 'Il guadagno sulla TV', frames: 168, camera: { position: [-2.5, -4.2, 1.6] as [number, number, number], target: [-5.7, -2.95, 1.3] as [number, number, number], lens: 65 }, note: '[short pause]\n[impressed] I had a joke ready. This is inconvenient.' },
  { name: 'La bolla sulla lavagna', frames: 168, camera: { position: [1.5, -.8, 3.5] as [number, number, number], target: [6.75, -.85, 3.5] as [number, number, number], lens: 34 }, note: "But you've walked straight into the question everyone's asking: is the AI boom becoming a bubble?" },
  { name: 'Chip e data center sulla TV', frames: 240, camera: { position: [-2.5, -4.2, 1.6] as [number, number, number], target: [-5.7, -2.95, 1.3] as [number, number, number], lens: 65 }, note: 'Companies are spending enormous sums on chips and data centers. Investors are betting those investments will produce enormous profits.' },
  { name: 'Aspettative e profitti sulla lavagna', frames: 240, camera: { position: [1.5, -.8, 3.5] as [number, number, number], target: [6.75, -.85, 3.5] as [number, number, number], lens: 34 }, note: "[short pause]\nAnd that's the catch. If expectations grow faster than the profits, share prices can fall—even when the technology is real." },
  { name: 'La battuta sui mobili', frames: 216, camera: { position: [0, -10, 4.2] as [number, number, number], target: [0, -.2, 2.5] as [number, number, number], lens: 24 }, note: "[teasing] So congratulations, Ub. You got the timing right.\nEnjoy your new house.\n[short pause]\nJust don't expect the stock market to buy you the furniture." },
];
let project = applyAgentCommands(createProject(), [
  { type: 'create_project', name: 'Ub — La casa e la bolla AI', fps: 24, width: 1920, height: 1080 },
  ...shots.map((shot) => ({ type: 'add_scene' as const, name: shot.name, durationFrames: shot.frames, camera: shot.camera, lighting: { preset: 'soft' as const, intensity: 1 } })),
]);
const ids = project.cameraCuts.map((shot) => shot.id);
const commands: AgentCommand[] = [];
const element = (scene: number, kind: 'plane' | 'text' | 'sphere' | 'cylinder', name: string, color: string, position: [number, number, number], scale: [number, number, number], rotation?: [number, number, number], text?: string, screenSpace = false) => commands.push({ type: 'add_element', sceneId: ids[scene], kind, name, color, transform: { position, scale, ...(rotation ? { rotation } : {}) }, ...(text !== undefined ? { text } : {}), screenSpace });
const caption = (scene: number, body: string) => element(scene, 'text', `Sottotitolo ${scene}`, '#ffffff', [0, 0, -.82], [1, 1, 1], undefined, body, true);
const tvCenter: [number, number, number] = [-5.62, -2.985, 1.29];
const tvRot: [number, number, number] = [90, 70, 0];
const tvPoint = (u: number, v: number, depth = .015): [number, number, number] => [tvCenter[0] + .342 * u + .94 * depth, tvCenter[1] + .94 * u - .342 * depth, tvCenter[2] + v];
const boardRot: [number, number, number] = [90, -90, 0];
for (let i = 0; i < shots.length; i++) {
  commands.push({ type: 'set_scene_background', sceneId: ids[i], assetId: roomAsset.id });
  commands.push({ type: 'set_scene_note', sceneId: ids[i], text: shots[i].note });
}
// Ub è un segnaposto modificabile finché l'utente non seleziona il suo modello.
element(0, 'cylinder', 'Ub · corpo provvisorio', '#49acc4', [1.4, -.5, 1.05], [.42, .42, .9]);
element(0, 'sphere', 'Ub · testa provvisoria', '#e7c8a5', [1.4, -.5, 2.16], [.47, .47, .47]);
caption(0, 'UB BOUGHT A HOUSE?!');
// La TV contiene un grafico animato. Un video locale scelto dall'utente può sostituirlo.
element(1, 'plane', 'TV · fondo video guadagno', '#0c2045', tvCenter, [.52, .34, 1], tvRot);
for (let i = 0; i < 5; i++) element(1, 'plane', `TV · profitto ${i}`, '#67dbab', tvPoint(-.34 + i * .17, -.12), [.055, .06 + i * .025, 1], tvRot);
caption(1, 'SOLD AT A PROFIT');
// La lavagna ospita le domande e i numeri, sulla superficie fisica del GLB.
element(2, 'text', 'Lavagna · domanda', '#184457', [6.69, -.85, 4.2], [.45, .45, .45], boardRot, 'AI BOOM = BUBBLE?');
element(2, 'text', 'Lavagna · contesto', '#267885', [6.69, -.85, 3.0], [.31, .31, .31], boardRot, 'REAL TECH / BIG BETS');
caption(2, 'IS THE AI BOOM A BUBBLE?');
element(3, 'plane', 'TV · fondo video investimenti', '#0c2045', tvCenter, [.52, .34, 1], tvRot);
for (let i = 0; i < 4; i++) element(3, 'plane', `TV · data center ${i}`, '#7fb1ff', tvPoint(-.3 + i * .2, -.06), [.075, .14, 1], tvRot);
element(3, 'text', 'TV · titolo chip', '#ffffff', tvPoint(0, .23, .03), [.13, .13, .13], tvRot, 'CHIPS + DATA');
caption(3, 'CHIPS · DATA CENTERS · PROFITS?');
element(4, 'text', 'Lavagna · aspettative', '#184457', [6.69, -.85, 4.55], [.35, .35, .35], boardRot, 'EXPECTATIONS');
element(4, 'text', 'Lavagna · profitti', '#267885', [6.69, -.85, 3.65], [.35, .35, .35], boardRot, 'vs PROFITS');
for (let i = 0; i < 5; i++) {
  element(4, 'plane', `Lavagna · aspettativa ${i}`, '#f0a359', [6.68, 1.7 - i * .7, 2.18], [.2, .35 + i * .1, 1], boardRot);
  element(4, 'plane', `Lavagna · profitto ${i}`, '#62be9e', [6.66, 1.45 - i * .7, 2.18], [.13, .25 + i * .03, 1], boardRot);
}
caption(4, 'IF EXPECTATIONS OUTRUN PROFITS…');
element(5, 'cylinder', 'Ub · corpo finale', '#49acc4', [1.4, -.5, 1.05], [.42, .42, .9]);
element(5, 'sphere', 'Ub · testa finale', '#e7c8a5', [1.4, -.5, 2.16], [.47, .47, .47]);
caption(5, 'FURNITURE SOLD SEPARATELY');
project = applyAgentCommands(project, commands, [roomAsset]);
const lookup = (name: string) => project.objects.find((item) => item.name === name)!;
project = applyAgentCommands(project, [
  { type: 'animate', sceneId: ids[0], elementId: project.cameraCuts[0].cameraId, property: 'position', keys: [{ offsetFrames: 0, value: [0, -10, 4.2] }, { offsetFrames: 130, value: [0, -8.6, 3.9], interpolation: 'linear' }] },
  { type: 'animate', sceneId: ids[1], elementId: lookup('TV · profitto 4').id, property: 'scale', keys: [{ offsetFrames: 0, value: [.055, .06, 1] }, { offsetFrames: 145, value: [.055, .26, 1], interpolation: 'linear' }] },
  { type: 'animate', sceneId: ids[3], elementId: lookup('TV · data center 3').id, property: 'scale', keys: [{ offsetFrames: 0, value: [.075, .05, 1] }, { offsetFrames: 200, value: [.075, .19, 1], interpolation: 'linear' }] },
  { type: 'animate', sceneId: ids[5], elementId: lookup('Ub · corpo finale').id, property: 'position', keys: [{ offsetFrames: 0, value: [1.4, -.5, 1.05] }, { offsetFrames: 185, value: [.9, -.5, 1.05], interpolation: 'linear' }] },
]);
await writeFile(destination, JSON.stringify(project, null, 2));
console.log(JSON.stringify({ path: destination, scenes: project.cameraCuts.length, objects: project.objects.length, frames: project.settings.frameEnd, seconds: project.settings.frameEnd / project.settings.fps, room: roomAsset.name }));
