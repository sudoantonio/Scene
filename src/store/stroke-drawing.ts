import { create } from 'zustand';

export const useStrokeDrawing = create<{
  mode: 'stroke' | 'motion'; durationSeconds: number; previewMotion?: { objectId: string; position: [number, number, number] };
  panelOpen: boolean; elementCount: number; surfaceNeighborCount: number;
  active: boolean; drawing: boolean; instruction: string; color: string; thickness: number; showInfluence: boolean;
  radius: number; neighborCount: number; status: string;
  sourceId?: string; destinationId?: string; circleRadius: number;
  cursor?: { x: number; y: number }; sourcePointCount: number; destinationPointCount: number;
}>(() => ({
  mode: 'motion', durationSeconds: 2, previewMotion: undefined,
  sourceId: undefined, destinationId: undefined, circleRadius: 48, cursor: undefined, sourcePointCount: 0, destinationPointCount: 0,
  panelOpen: false, elementCount: 0, surfaceNeighborCount: 0,
  active: false, drawing: false, instruction: '', color: '#efae45', thickness: .025, showInfluence: true,
  radius: .2, neighborCount: 0, status: 'Click the object to move, then the second object. Click the first again to deselect it.',
}));
