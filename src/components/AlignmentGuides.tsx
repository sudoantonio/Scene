import { Html, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { AlignmentGuide } from './object-alignment';

export default function AlignmentGuides({ guides, cameraView }: { guides: AlignmentGuide[]; cameraView: boolean }) {
  const camera = useThree(state => state.camera);
  if (cameraView) return <Html fullscreen calculatePosition={(_object, _camera, size) => [size.width / 2, size.height / 2]} style={{ pointerEvents: 'none' }}><svg className="object-alignment-guides" data-testid="object-alignment-guides" aria-hidden="true">{guides.map(guide => {
    const projected = guide.to.clone().project(camera);
    const coordinate = guide.axis === 0 ? (projected.x + 1) * 50 : (1 - projected.y) * 50;
    return guide.axis === 0 ? <line key={guide.id} x1={`${coordinate}%`} x2={`${coordinate}%`} y1="0" y2="100%" />
      : <line key={guide.id} x1="0" x2="100%" y1={`${coordinate}%`} y2={`${coordinate}%`} />;
  })}</svg></Html>;
  return <>{guides.map(guide => <Line key={guide.id} points={[guide.from, guide.to]} color="#f0c547" lineWidth={2} dashed dashSize={.12} gapSize={.08} depthTest={false} renderOrder={100} raycast={() => {}} />)}</>;
}
