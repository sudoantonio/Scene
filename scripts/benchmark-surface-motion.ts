import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { shortestSurfaceMotion, pathLengths } from '../src/domain/surface-motion';
import type { Vec3 } from '../src/domain/schema';
const cases = [
  {name:'straight-10000',points:Array.from({length:10000},(_,i)=>[i/1000,0,0] as Vec3)},
  {name:'curve-10000',points:Array.from({length:10000},(_,i)=>[i/1000,.2*Math.sin(i/100),0] as Vec3)},
];
const results=cases.map(({name,points})=>{const start=performance.now(),path=shortestSurfaceMotion(points,[0,0,1],3),ms=performance.now()-start;return{name,inputPoints:points.length,minimumCurvePoints:path.length,finalSolveMs:ms,length:pathLengths(path).at(-1)};});
writeFileSync(process.argv[2],JSON.stringify({releaseCalculationOnly:true,results},null,2));console.log(results);
