import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { createPerformanceFixture } from '../src/domain/performance-fixture';
import { evaluateProperty, evaluateTransform, evaluateRenderProperty, evaluateRenderTransform } from '../src/domain/animation';

const percentile = (values: number[], p: number) => [...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)];
const results = [];
for (const count of [100, 1000, 3000]) {
  const project = createPerformanceFixture(count), objects = project.objects.slice(1);
  for (const optimized of [false, true]) {
    const transform = optimized ? evaluateRenderTransform : evaluateTransform;
    const property = optimized ? evaluateRenderProperty : evaluateProperty;
    const times: number[] = []; let checksum = 0;
    for (let sample = 0; sample < 220; sample++) {
      const frame = 2 + sample * 11, start = performance.now();
      for (const object of objects) {
        checksum += transform(object, frame).position[2];
        property(object, 'visibility', frame); property(object, 'text', frame);
        // Same object is also evaluated by another visible editor panel.
        checksum += transform(object, frame).position[0];
      }
      if (sample >= 20) times.push(performance.now() - start);
    }
    results.push({ count, animated: Math.ceil(count / 10), pathPoints: 10000, optimized, p50Ms: percentile(times,.5), p95Ms: percentile(times,.95), checksum });
  }
}
writeFileSync('work-build/animation-performance.json', JSON.stringify({ scope: 'CPU evaluation only; excludes React and GPU', results }, null, 2));
console.log(JSON.stringify(results, null, 2));
