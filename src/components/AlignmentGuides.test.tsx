import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import AlignmentGuides from './AlignmentGuides';

const viewport = vi.hoisted(() => ({ width: 1000, height: 600 }));
let camera: THREE.PerspectiveCamera;
vi.mock('@react-three/fiber', () => ({ useThree: (select: (state: unknown) => unknown) => select({ camera }) }));
vi.mock('@react-three/drei', () => ({
  Html: ({ children, calculatePosition }: { children: React.ReactNode; calculatePosition: (object: unknown, camera: unknown, size: unknown) => number[] }) => {
    const [x, y] = calculatePosition({}, camera, viewport);
    // Drei fullscreen translates by half the viewport; the default Html origin
    // instead projects world [0,0,0], displacing the entire SVG in perspective.
    return <div data-testid="overlay" style={{ left: x - viewport.width / 2, top: y - viewport.height / 2 }}>{children}</div>;
  },
  Line: () => null,
}));
afterEach(cleanup);
describe('camera alignment overlay', () => {
  it('anchors to the viewport and keeps guides on the projected target with an off-centre camera', () => {
    camera = new THREE.PerspectiveCamera(60, 1000 / 600, .1, 100);
    camera.position.set(8, -10, 7); camera.up.set(0,0,1); camera.lookAt(3,1,2); camera.updateMatrixWorld();
    const point = new THREE.Vector3(2, 0, 1), projected = point.clone().project(camera);
    render(<AlignmentGuides cameraView guides={[{ id: 'x', axis: 0, label: 'Cube', from: point, to: point }, { id: 'y', axis: 1, label: 'Cube', from: point, to: point }]} />);
    expect(screen.getByTestId('overlay')).toHaveStyle({ left: '0px', top: '0px' });
    const lines = screen.getByTestId('object-alignment-guides').querySelectorAll('line');
    expect(Number.parseFloat(lines[0].getAttribute('x1')!)).toBeCloseTo((projected.x + 1) * 50);
    expect(lines[0].getAttribute('x2')).toBe(lines[0].getAttribute('x1'));
    expect(lines[1].getAttribute('y1')).toBe(lines[1].getAttribute('y2'));
    expect(Number.parseFloat(lines[1].getAttribute('y1')!)).toBeCloseTo((1 - projected.y) * 50);
    expect(lines[1].getAttribute('x1')).toBe('0'); expect(lines[1].getAttribute('x2')).toBe('100%');
  });
});
