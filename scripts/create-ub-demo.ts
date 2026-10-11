import { writeFile } from 'node:fs/promises';
import { applyAgentCommands, type AgentCommand } from '../src/domain/agent-commands';
import { createProject } from '../src/domain/schema';

const destination = process.argv[2];
if (!destination) throw new Error('Indica il percorso di uscita .abaco.json.');
const descriptions = [
  { name: 'La casa di Ub', durationFrames: 144, camera: { position: [7, -9, 5] as [number, number, number], target: [0, 0, 1.4] as [number, number, number], lens: 42 }, note: '[shocked] Ub... is that your new house?!\nYou invested in AI stocks, sold them at a profit... and actually bought a house?' },
  { name: 'Il colpo giusto', durationFrames: 168, camera: { position: [6, -8, 5] as [number, number, number], target: [0, 0, 1.4] as [number, number, number], lens: 45 }, note: '[short pause]\n[impressed] I had a joke ready. This is inconvenient.' },
  { name: 'La domanda della bolla', durationFrames: 168, camera: { position: [5, -9, 5] as [number, number, number], target: [0, 0, 2] as [number, number, number], lens: 48 }, note: "But you've walked straight into the question everyone's asking: is the AI boom becoming a bubble?" },
  { name: 'La corsa agli investimenti', durationFrames: 240, camera: { position: [8, -10, 6] as [number, number, number], target: [0, 0, 1.8] as [number, number, number], lens: 45 }, note: 'Companies are spending enormous sums on chips and data centers. Investors are betting those investments will produce enormous profits.' },
  { name: 'Il divario', durationFrames: 240, camera: { position: [6, -9, 5] as [number, number, number], target: [0, 0, 1.8] as [number, number, number], lens: 45 }, note: '[short pause]\nAnd that\'s the catch. If expectations grow faster than the profits, share prices can fall—even when the technology is real.' },
  { name: 'Il mobile mancante', durationFrames: 216, camera: { position: [7, -9, 5] as [number, number, number], target: [0, 0, 1.5] as [number, number, number], lens: 42 }, note: '[teasing] So congratulations, Ub. You got the timing right.\nEnjoy your new house.\n[short pause]\nJust don\'t expect the stock market to buy you the furniture.' },
];

let project = applyAgentCommands(createProject(), [
  { type: 'create_project', name: 'Ub — La bolla AI e la casa', fps: 24, width: 1920, height: 1080 },
  ...descriptions.map(({ name, durationFrames, camera }) => ({ type: 'add_scene' as const, name, durationFrames, camera, lighting: { preset: 'warm' as const, intensity: 1 } })),
]);
const ids = project.cameraCuts.map((scene) => scene.id);
const commands: AgentCommand[] = [];
const add = (scene: number, kind: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'text', name: string, color: string, position: [number, number, number], scale: [number, number, number], text?: string) => {
  commands.push({ type: 'add_element', sceneId: ids[scene], kind, name, color, transform: { position, scale }, ...(text ? { text, screenSpace: true } : {}) });
};
const house = (scene: number) => {
  add(scene, 'cube', `Casa · pareti ${scene}`, '#e7c8a5', [0, 0, 1.5], [2.5, 2, 2.5]);
  add(scene, 'cone', `Casa · tetto ${scene}`, '#c45b51', [0, 0, 3.3], [3, 2.7, 1.1]);
  add(scene, 'cube', `Casa · porta ${scene}`, '#5b3d37', [0, -2.06, .9], [.7, .12, 1.5]);
  add(scene, 'cube', `Casa · finestra ${scene}`, '#8ed4e6', [-1.2, -2.07, 2], [.55, .08, .55]);
};
const ub = (scene: number, x = 3.2) => {
  add(scene, 'cylinder', `Ub · corpo ${scene}`, '#317c91', [x, -1.2, 1.2], [.48, .48, 1.25]);
  add(scene, 'sphere', `Ub · testa ${scene}`, '#eacba9', [x, -1.2, 2.35], [.58, .58, .58]);
};
house(0); ub(0); add(0, 'text', 'Titolo · la casa', '#ffffff', [0, 0, -.79], [1.1, 1.1, 1.1], 'UB BOUGHT A HOUSE?!');
ub(1, -2.8); for (let index = 0; index < 5; index++) add(1, 'cube', `Profitto · barra ${index}`, '#68cba1', [-1 + index * .8, 1.2, .4 + index * .4], [.5, .5, .8 + index * .8]);
add(1, 'text', 'Titolo · profitto', '#ffffff', [0, 0, -.79], [1.1, 1.1, 1.1], 'SOLD AT A PROFIT');
add(2, 'sphere', 'Bolla delle aspettative', '#90bafa', [0, 0, 2], [2, 2, 2]);
add(2, 'text', 'Domanda', '#ffffff', [0, 0, -.79], [1.1, 1.1, 1.1], 'IS THIS A BUBBLE?');
for (let index = 0; index < 5; index++) {
  add(3, 'cube', `Data center ${index}`, '#79869b', [-3.6 + index * 1.8, .6, 1.1], [1.4, 1.4, 2.2]);
  add(3, 'cube', `Chip ${index}`, '#68cba1', [-3.6 + index * 1.8, -1, .3], [.85, .85, .24]);
}
add(3, 'text', 'Titolo · investimenti', '#ffffff', [0, 0, -.79], [1.1, 1.1, 1.1], 'CHIPS + DATA CENTERS');
for (let index = 0; index < 6; index++) {
  add(4, 'cube', `Aspettative ${index}`, '#f3bf62', [-3.5 + index * 1.3, 0, .4 + index * .25], [.35, .35, .8 + index * .5]);
  add(4, 'cube', `Profitti ${index}`, '#69c99b', [-3.2 + index * 1.3, -1, .35 + index * .08], [.35, .35, .7 + index * .16]);
}
add(4, 'text', 'Titolo · il divario', '#ffffff', [0, 0, -.79], [1.1, 1.1, 1.1], 'EXPECTATIONS ≠ PROFITS');
house(5); ub(5); add(5, 'cube', 'Scatola dei mobili vuota', '#b59569', [3.1, -.4, .5], [.9, .9, 1]);
add(5, 'text', 'Battuta finale', '#ffffff', [0, 0, -.79], [1.1, 1.1, 1.1], 'FURNITURE SOLD SEPARATELY');
descriptions.forEach((scene, index) => commands.push({ type: 'set_scene_note', sceneId: ids[index], text: scene.note }));
project = applyAgentCommands(project, commands);
const profit = project.objects.find((object) => object.name === 'Profitto · barra 4')!;
const bubble = project.objects.find((object) => object.name === 'Bolla delle aspettative')!;
const ubFinal = project.objects.find((object) => object.name === 'Ub · corpo 5')!;
project = applyAgentCommands(project, [
  { type: 'animate', sceneId: ids[1], elementId: profit.id, property: 'scale', keys: [{ offsetFrames: 0, value: [.5, .5, .8] }, { offsetFrames: 120, value: [.5, .5, 4], interpolation: 'linear' }] },
  { type: 'animate', sceneId: ids[2], elementId: bubble.id, property: 'scale', keys: [{ offsetFrames: 0, value: [1, 1, 1] }, { offsetFrames: 145, value: [2.5, 2.5, 2.5], interpolation: 'linear' }] },
  { type: 'animate', sceneId: ids[5], elementId: ubFinal.id, property: 'position', keys: [{ offsetFrames: 0, value: [3.2, -1.2, 1.2] }, { offsetFrames: 180, value: [2.6, -1.2, 1.2], interpolation: 'linear' }] },
]);
await writeFile(destination, JSON.stringify(project, null, 2));
console.log(JSON.stringify({ path: destination, scenes: project.cameraCuts.length, objects: project.objects.length, frames: project.settings.frameEnd, seconds: project.settings.frameEnd / project.settings.fps, notes: project.comments.length }));
