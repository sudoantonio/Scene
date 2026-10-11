import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {objectMotionPoints,projectMotionPoints,pointsInCircle,fitViewPlane} from '../src/domain/circle-motion';
const scene=new THREE.Scene(),geometry=new THREE.BufferGeometry();
const vertices=Array.from({length:10000},(_,i)=>[(i%100)/50-1,Math.floor(i/100)/50-1,Math.sin(i/100)*.1]).flat();
geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
for(let i=0;i<100;i++){const root=new THREE.Group();root.userData.sceneObjectId=String(i);const mesh=new THREE.Mesh(geometry);root.add(mesh);root.position.x=i*3;scene.add(root);}
const camera=new THREE.PerspectiveCamera(60,1,.1,1000);camera.position.set(0,-5,3);camera.up.set(0,0,1);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
const start=performance.now(),points=objectMotionPoints(scene.children[0]),screen=projectMotionPoints(points,camera,{width:900,height:900}),cold=performance.now()-start;
const times=[];let count=0;
for(let i=0;i<240;i++){const begin=performance.now(),chosen=pointsInCircle(screen,450+i%10,450,150);count=chosen.length;fitViewPlane(chosen,camera.getWorldDirection(new THREE.Vector3()));times.push(performance.now()-begin);}
times.sort((a,b)=>a-b);
const result={objects:100,pointsPerObject:10000,totalVertices:1000000,selectedObjectVertices:points.length,selectedCircleVertices:count,initialCollectionMs:cold,localUpdateMedianMs:times[120],localUpdateP95Ms:times[Math.floor(times.length*.95)],cachedProjection:true};
writeFileSync(process.argv[2],JSON.stringify(result,null,2));console.log(result);
