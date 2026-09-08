import * as T from 'three';
import { STATIC_OBSTACLES } from './navigation';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fernGeometry } from './foliage';
import { buildCottage } from './cottage';
import { buildTree } from './trees';
import { flagstoneGeometry } from './stonework';
import { buildBridge, buildRuinedGate } from './ruins';
import { character, type Character } from './characters';
export { character, type Character } from './characters';

const TAU = Math.PI * 2;
export const terrainHeight = (x: number, z: number) => {
  if (x > 8.5 && x < 13.5 && z > 1.8 && z < 6.2) return 1.05 * Math.sin((x - 8.5) / 5 * Math.PI);
  if (x > 8.5 && x < 13.5) return -.55;
  return -.04;
};
function random(seed = 83) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
let rng = random();
function mesh(g: T.BufferGeometry, m: T.Material, p: T.Object3D, x = 0, y = 0, z = 0) {
  const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; p.add(o); return o;
}
function box(p: T.Object3D, m: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
  const o = mesh(new T.BoxGeometry(sx, sy, sz), m, p, x, y, z); o.rotation.y = ry; return o;
}
function beam(p: T.Object3D, m: T.Material, a: T.Vector3, b: T.Vector3, r: number, r2 = r) {
  const o = mesh(new T.CylinderGeometry(r2, r, a.distanceTo(b), 8), m, p); o.position.copy(a).add(b).multiplyScalar(.5); o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize()); return o;
}
const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
function ring(p: T.Object3D, m: T.Material, x: number, y: number, z: number, r: number, tube: number) {
  const o = mesh(new T.TorusGeometry(r, tube, 5, 24), m, p, x, y, z); o.rotation.x = Math.PI / 2; return o;
}
interface Materials { [key: string]: T.MeshStandardMaterial }
function materials() {
  const loader = new T.TextureLoader();
  const texture = (name: string, repeat = 1) => { const t = loader.load(`/art/3d/${name}.png`); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8; return t; };
  const bark = texture('bark'), earth = texture('earth', 6), roof = texture('roof'), rock = texture('rock'), leaves=texture('leaves');
  const mat = (color: string | number, map?: T.Texture) => new T.MeshStandardMaterial({ color, map, roughness: .92, bumpMap: map, bumpScale: map ? .16 : 0 });
  // Masonry joints come from the modeled blocks. Mapping a complete brick wall
  // onto each block made the well and waystones read as miniature brickwork.
  return { stone: mat('#d2cbb6', rock), stoneDark: mat('#a7b3a2', rock), wood: mat('#bb9c75', bark), bark: mat('#ede2c6', bark), ground: mat('#a3b18a', earth), roof: mat('#c49898', roof), rock:mat('#b7b9a5',rock), plaster: mat('#927b60',bark), brass: new T.MeshStandardMaterial({ color: '#bd9b54', metalness: .62, roughness: .5 }), dark: mat('#292d2b'), moss: mat('#657447',earth), leaf: new T.MeshStandardMaterial({color:'#cbd1bd',map:leaves,alphaTest:.55,side:T.DoubleSide,roughness:.95}), cobble: new T.MeshStandardMaterial({color:'#b2a88c',map:rock,bumpMap:rock,bumpScale:.09,roughness:.86}), fern: new T.MeshStandardMaterial({color:'#557335', side:T.DoubleSide, roughness:.83}), glow: new T.MeshStandardMaterial({color:'#ffcf6b',emissive:'#ff9d30',emissiveIntensity:1.8}), cloth: mat('#415d66'), skin: mat('#b49a82'), purple: mat('#605770') } satisfies Materials;
}
function lantern(p: T.Object3D, m: Materials, x: number, y: number, z: number, light = true, intensity = 9) {
  const g = new T.Group(); g.position.set(x,y,z); p.add(g);
  box(g,m.brass,0,-.26,0,.34,.09,.34); box(g,m.brass,0,.28,0,.4,.08,.4);
  mesh(new T.ConeGeometry(.31,.19,4),m.brass,g,0,.41,0).rotation.y=Math.PI/4;
  box(g,m.glow,0,0,0,.23,.46,.23);
  for(const a of [-1,1]) for(const b of [-1,1]) box(g,m.dark,a*.15,0,b*.15,.04,.55,.04);
  if(light){const l = new T.PointLight('#ffb454',intensity,7,2); l.position.set(x,y,z); p.add(l);}
}
function roof(p:T.Object3D,m:Materials,x:number,y:number,z:number,width:number,depth:number,height:number) {
  for(const side of [-1,1]) {
    // Individual curved shingle rows silhouette the eaves instead of a flat triangle.
    const rows=9,cols=Math.ceil(depth/.55);
    for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
      const t=row/rows,xx=side*(.12+t*width/2), yy=height*(1-t)+.2*Math.sin(t*Math.PI);
      const tile=new RoundedBoxGeometry(Math.hypot(width/2,height)/rows*1.12,.10,.62,2,.025);
      const uv=tile.getAttribute('uv'),u0=(col%8)*.125,v0=(row%10)*.1;
      for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*.125+u0,uv.getY(i)*.1+v0);
      const o=mesh(tile,m.roof,p,x+xx,y+yy,z-depth/2+col*.55+(row%2)*.14);
      o.rotation.z=side*Math.atan2(-height,width/2);o.rotation.x=(rng()-.5)*.03;
    }
    beam(p,m.wood,v(x,y+height+.12,z-depth/2-.3),v(x+side*width/2,y-.08,z-depth/2-.3),.12);
    beam(p,m.wood,v(x,y+height+.12,z+depth/2+.2),v(x+side*width/2,y-.08,z+depth/2+.2),.12);
  }
  beam(p,m.wood,v(x,y+height+.12,z-depth/2-.4),v(x,y+height+.12,z+depth/2+.4),.14);
}
function archedWindow(p:T.Object3D,m:Materials,x:number,y:number,z:number,s=1) {
  const g=new T.Group();g.position.set(x,y,z);g.scale.setScalar(s);p.add(g);
  const shape=new T.Shape();shape.moveTo(-.42,0);shape.lineTo(-.42,.75);shape.absarc(0,.75,.42,Math.PI,0,true);shape.lineTo(.42,0);shape.closePath();
  mesh(new T.ShapeGeometry(shape),m.glow,g,0,0,.02);
  beam(g,m.wood,v(-.5,-.08,0),v(-.5,.8,0),.075);beam(g,m.wood,v(.5,-.08,0),v(.5,.8,0),.075);
  const arc=new T.Mesh(new T.TorusGeometry(.48,.07,6,18,Math.PI),m.wood);arc.position.y=.78;g.add(arc);
  box(g,m.wood,0,.5,.07,.06,1.12,.06);box(g,m.wood,0,.6,.07,.95,.06,.07);box(g,m.wood,0,0,.07,1.13,.15,.22);
}
function cottage(p:T.Object3D,m:Materials,x:number,z:number,s=1) {
  const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(s);p.add(g);
  box(g,m.stone,0,.4,0,6.4,.8,5.3);box(g,m.plaster,0,2.2,0,6,3.5,5);
  for(const xx of [-3,-1.5,0,1.5,3]) {box(g,m.wood,xx,2.1,2.54,.16,3.6,.2);box(g,m.wood,xx,2.1,-2.54,.16,3.6,.2);}
  for(const yy of [.85,3.5]) {box(g,m.wood,0,yy,2.55,6.2,.2,.18);box(g,m.wood,-3.03,yy,0,.2,.2,5.2);}
  for(const zz of [-2.45,0,2.45])box(g,m.wood,-3.03,2.2,zz,.18,3.3,.16);
  for(const zz of [-2.45,0,2.45])box(g,m.wood,3.03,2.2,zz,.18,3.3,.16);
  for(const side of [-1,1])for(const yy of [.85,3.5])box(g,m.wood,side*3.04,yy,0,.2,.2,5.2);
  for(const side of [-1,1])for(const zz of [-1.25,1.25]) {
    beam(g,m.wood,v(side*3.06,1,zz-.9),v(side*3.06,3.38,zz+.9),.075);
    const window=new T.Group();g.add(window);window.position.set(side*3.1,0,zz);window.rotation.y=side*Math.PI/2;archedWindow(window,m,0,1.45,0,.75);
  }
  const sh=new T.Shape();sh.moveTo(-3,0);sh.lineTo(0,3.5);sh.lineTo(3,0);sh.closePath();
  mesh(new T.ExtrudeGeometry(sh,{depth:5,bevelEnabled:false}),m.plaster,g,0,3.8,-2.5);
  for(const zz of [-2.54,2.56]) {
    box(g,m.wood,0,5.22,zz,.18,3.25,.17);
    beam(g,m.wood,v(-2.9,3.84,zz),v(0,7.22,zz),.1);
    beam(g,m.wood,v(2.9,3.84,zz),v(0,7.22,zz),.1);
    for(const side of [-1,1])beam(g,m.wood,v(side*.4,4,zz),v(side*1.65,5.15,zz),.075);
  }
  roof(g,m,0,3.6,0,7.2,6.2,3.9);
  box(g,m.wood,0,1.35,2.66,1.26,2.55,.2);for(let i=0;i<6;i++)box(g,m.brass,-.51+i*.2,1.35,2.78,.025,2.3,.03);
  ring(g,m.brass,.4,1.3,2.84,.09,.025).rotation.x=0;
  archedWindow(g,m,-1.8,1.45,2.66);archedWindow(g,m,1.8,1.45,2.66);archedWindow(g,m,0,4.25,2.68,.85);
  box(g,m.wood,0,3.08,3.12,2.5,.18,1.15);roof(g,m,0,3.1,3.1,2.8,1.7,1.2);
  for(let i=0;i<3;i++)box(g,m.stone,0,.15+i*.15,3.6-i*.3,2.7,.3,.6);
  // Gnarled supports and a hanging tavern sign.
  beam(g,m.wood,v(1.4,0,3.65),v(1.4,3.35,3.65),.105);beam(g,m.wood,v(-1.4,0,3.65),v(-1.4,3.35,3.65),.105);
  beam(g,m.wood,v(2.85,3.3,2.7),v(2.85,3.3,4.4),.09);box(g,m.wood,2.85,2.7,4.28,.85,.8,.13);ring(g,m.brass,2.85,2.72,4.38,.25,.045).rotation.x=0;
  box(g,m.stone,-1.7,6.6,-1.4,.95,3,.9);box(g,m.stoneDark,-1.7,8.1,-1.4,1.2,.25,1.15);
  lantern(g,m,-1.2,2.45,3.5);lantern(g,m,2.7,2.2,2.9);
  for(const a of [-1,1]) {const b=mesh(new T.CylinderGeometry(.43,.48,.95,12),m.wood,g,a*2.2,.5,3.2);for(const y of [.16,.7])ring(g,m.dark,b.position.x,y,b.position.z,.47,.035);}
}
function well(p:T.Object3D,m:Materials) {
  const g=new T.Group();g.position.set(4.5,0,8);p.add(g);
  for(let row=0;row<4;row++) for(let i=0;i<12;i++) {
    const a=(i+row%2*.5)/12*TAU;
    const block=mesh(new RoundedBoxGeometry(.59,.27,.45,2,.04),row===0&&i%3===0?m.moss:m.stone,g,Math.sin(a)*1.14,.13+row*.25,Math.cos(a)*1.14);
    block.rotation.set((rng()-.5)*.025,a,(rng()-.5)*.035);
  }
  for(let i=0;i<12;i++){
    const a=(i+.5)/12*TAU;
    const cap=mesh(new RoundedBoxGeometry(.62,.16,.58,2,.045),m.stone,g,Math.sin(a)*1.14,1.04,Math.cos(a)*1.14);
    cap.rotation.y=a;
  }
  for(const x of [-1.25,1.25])box(g,m.wood,x,1.65,0,.2,3.3,.2);
  roof(g,m,0,3.15,0,3.5,2.9,1.15);beam(g,m.wood,v(-1.35,2.3,0),v(1.35,2.3,0),.12);
  lantern(g,m,0,1.9,0,true,24);mesh(new T.CircleGeometry(.97,32),new T.MeshStandardMaterial({color:'#3dccc1',emissive:'#1c7b77',emissiveIntensity:.45,roughness:.2}),g,0,.12,0).rotation.x=-Math.PI/2;
}
function stones(p:T.Object3D,m:Materials) {
  const positions=[[6,4],[17,3],[24,-6]]; const result:T.Mesh[]=[];
  positions.forEach(([x,z])=>{
    const g=new T.Group();g.position.set(x,0,z);p.add(g);
    mesh(new T.CylinderGeometry(.76,.9,.25,7),m.stone,g,0,.1,0);
    const stone=mesh(new T.DodecahedronGeometry(1,1),m.stoneDark,g,0,1.03,0);stone.scale.set(.65,1.25,.48);
    const glow=new T.MeshStandardMaterial({color:'#717e80',emissive:'#ffd579',emissiveIntensity:0,roughness:.6});
    // Three carved lines, each individually inset, catch light as the stone renews.
    for(let i=0;i<3;i++){const line=box(g,glow,0,1.4-i*.23,.45,.6-i*.08,.055,.03);result.push(line);}
    ring(g,m.stone,x===6?0:.02,.16,0,1.05,.05);
  });return result;
}
/** Batch static meshes by material to keep the detailed world cheap to draw. */
function batchStatic(group:T.Group) {
  group.updateWorldMatrix(true,true);const inverse=group.matrixWorld.clone().invert();const bins=new Map<T.Material,T.BufferGeometry[]>(),remove:T.Mesh[]=[];
  group.traverse(o=>{if(o instanceof T.Mesh && !(o instanceof T.InstancedMesh) && !Array.isArray(o.material) && !o.userData.dynamic){const geo=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();geo.applyMatrix4(inverse.clone().multiply(o.matrixWorld));if(!geo.getAttribute('uv'))geo.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count*2),2));const list=bins.get(o.material)??[];list.push(geo);bins.set(o.material,list);remove.push(o);}});
  for(const o of remove){o.removeFromParent();o.geometry.dispose();}
  for(const [mat,geos] of bins){const merged=mergeGeometries(geos,false);if(merged){const o=new T.Mesh(merged,mat);o.castShadow=o.receiveShadow=true;group.add(o);}geos.forEach(g=>g.dispose());}
}
export interface World {
  root:T.Group; trees:T.Group[]; keeper:Character; companion:Character; guardian:Character; motes:T.Points; water:T.Mesh; stoneLines:T.Mesh[]; barrier:T.Mesh; update:(time:number,dt:number)=>void; dispose:()=>void;
}
export function buildWorld(scene:T.Scene):World {
  // Re-entering from the Ledger recreates the same woodland around the saved party.
  rng = random();
  const m=materials(),root=new T.Group(),statics=new T.Group();root.add(statics);scene.add(root);
  m.ground.color.set('#e1dfb5');
  const groundGeo=new T.PlaneGeometry(110,120,110,120),pos=groundGeo.getAttribute('position');
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=-pos.getY(i);const edge=Math.max(Math.abs(x-4)-25,Math.abs(z)-22,0);const base=x>8.5&&x<13.5?-.9:terrainHeight(x,z);pos.setZ(i,base+Math.min(edge*.15,2)+Math.sin(x*.6)*Math.cos(z*.45)*.025);}
  // Broad moss/soil variation gives the ground coherent masses beneath its
  // small leaf texture; a single tiled albedo otherwise reads as visual noise.
  const groundColors=new Float32Array(pos.count*3),soil=new T.Color().setRGB(1,.94,.82),forest=new T.Color().setRGB(.78,1,.72);
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),z=-pos.getY(i);
    const patch=T.MathUtils.clamp(.5+Math.sin(x*.24+Math.sin(z*.19))*.25+Math.cos(z*.31+x*.07)*.25,0,1);
    const c=soil.clone().lerp(forest,patch);
    groundColors.set([c.r,c.g,c.b],i*3);
  }
  groundGeo.setAttribute('color',new T.BufferAttribute(groundColors,3));m.ground.vertexColors=true;m.ground.bumpScale=.075;
  groundGeo.computeVertexNormals();const ground=mesh(groundGeo,m.ground,statics,0,-.05,0);ground.rotation.x=-Math.PI/2;
  buildCottage(statics,m,-11.5,-4,1.4);cottage(statics,m,3,-12,.85);well(statics,m);buildBridge(statics,m);buildRuinedGate(statics,m,27,-15);
  // Walkways are individually laid irregular cobbles, with open moss joints.
  const pebbleGeo=flagstoneGeometry();const pebble=new T.InstancedMesh(pebbleGeo,m.cobble,3600);let n=0;const dummy=new T.Object3D();
  for(let x=-18;x<33;x+=.65)for(let z=-20;z<16;z+=.65){
    const plaza=(x-.5)**2+(z-5)**2<45;
    const lane=Math.abs(z-(x<8?4: x<16?4:4-(x-16)*1.55))<1.75;
    const home=Math.abs(x+9)<1.5&&z>-3&&z<5;
    const wornEdge=plaza&&(x-.5)**2+(z-5)**2>28||lane&&Math.abs(z-(x<16?4:4-(x-16)*1.55))>1.1;
    if((plaza||lane||home)&&!(x>8.2&&x<13.9)&&n<3600&&(!wornEdge||rng()>.28)){dummy.position.set(x+(rng()-.5)*.3,.015+rng()*.055,z+(rng()-.5)*.3);dummy.rotation.set((rng()-.5)*.08,(rng()-.5)*.7,(rng()-.5)*.08);dummy.scale.set(.27+rng()*.17,.085+rng()*.09,.22+rng()*.15);dummy.updateMatrix();pebble.setColorAt(n,new T.Color().setHSL(.10+rng()*.025,.16+rng()*.12,.52+rng()*.23));pebble.setMatrixAt(n++,dummy.matrix);}
  }
  pebble.count=n;pebble.castShadow=false;pebble.receiveShadow=true;statics.add(pebble);
  // Creek banks, broken wall stones, and mossy outcrops.
  for(let j=0;j<240;j++){const z=-25+rng()*49,x=(j%2===0?8.4:13.6)+(rng()-.5)*1.1;if(z>1&&z<7)continue;const rock=mesh(new T.IcosahedronGeometry(.25+rng()*.65,1),j%4?m.rock:m.moss,statics,x,-.22,z);rock.scale.set(1,.6+rng()*.5,1.1);rock.rotation.set(rng(),rng(),rng());}
  const trees:T.Group[]=[];
  const treePoints=STATIC_OBSTACLES.filter(o=>o.kind==='circle'&&o.feature!=='well').map(o=>o.kind==='circle'?{x:o.center.x,z:o.center.z,r:o.radius*(o.radius>1.5?.68:.58)}:{x:0,z:0,r:1});
  for(let i=0;i<30;i++)treePoints.push({x:-32+rng()*70,z:-26-rng()*19,r:.55+rng()*.7});
  for(const {x,z,r} of treePoints){
    const ancient=x===-2&&z===-11;
    const h=ancient?24:13+rng()*8,g=buildTree(root,m,x,z,h,ancient?2.1:r,Math.round(rng()*10000));trees.push(g);
    // Each canopy follows its tree; the camera can reveal the party beneath it.
    const leaves=new T.InstancedMesh(new T.PlaneGeometry(3.2,2.1),m.leaf,180);leaves.userData.skipAO=true;
    for(let i=0;i<180;i++){
      const a=rng()*TAU,d=Math.sqrt(rng())*5.5;
      dummy.position.set(Math.cos(a)*d,h*(ancient?.46:.52)+rng()*h*.4-d*d*.03,Math.sin(a)*d);
      dummy.rotation.set(-.4+rng()*Math.PI,a,rng()*Math.PI);dummy.scale.setScalar(.6+rng()*.9);dummy.updateMatrix();
      leaves.setMatrixAt(i,dummy.matrix);leaves.setColorAt(i,new T.Color().setHSL(.23+rng()*.06,.12,.7+rng()*.25));
    }
    leaves.name='canopy';leaves.castShadow=leaves.receiveShadow=true;g.add(leaves);batchStatic(g);
  }
  // Ferns: paired feathered fronds and tiny flowering woodland plants.
  const ferns=new T.InstancedMesh(fernGeometry(),new T.MeshStandardMaterial({vertexColors:true,side:T.DoubleSide,roughness:.88}),600);let fi=0;
  for(let j=0;j<300;j++){const x=-24+rng()*58,z=-23+rng()*44;if((x-.5)**2+(z-5)**2<49||(x-4.5)**2+(z-10)**2<16||Math.abs(z-(x<16?4:4-(x-16)*1.55))<2.2||x>8.7&&x<13.3)continue;dummy.position.set(x,.02,z);dummy.rotation.set(0,rng()*TAU,0);dummy.scale.setScalar(z>14?.8+rng()*.9:.35+rng()*.65);dummy.updateMatrix();ferns.setMatrixAt(fi++,dummy.matrix);}
  ferns.count=fi;ferns.receiveShadow=true;statics.add(ferns);
  for(const [x,z] of [[-4,7],[5,-2],[-12,2],[16,6],[21,-2],[27,-8]]){beam(statics,m.wood,v(x,0,z),v(x,2.7,z),.085);beam(statics,m.wood,v(x,2.7,z),v(x+.55,2.7,z),.06);lantern(statics,m,x+.5,2.2,z);}
  // Low paddock fences frame the arrival without obstructing the walkway.
  for(let i=0;i<6;i++){box(statics,m.wood,-15+i*1.7,.67,9,.16,1.5,.16);if(i<5)for(const y of [.55,1.07])box(statics,m.wood,-14.15+i*1.7,y,9,1.75,.12,.12);}
  box(statics,m.wood,20,.42,8,1.2,.8,.85);box(statics,m.brass,20,.83,8,1.28,.09,.91);box(statics,m.brass,20,.5,8.45,.2,.2,.06);
  batchStatic(statics);
  const stoneLines=stones(root,m);
  const barrier=mesh(new T.PlaneGeometry(3.6,2.6),new T.MeshBasicMaterial({color:'#ad8bcc',transparent:true,opacity:.24,side:T.DoubleSide,depthWrite:false}),root,8.55,1.35,4);barrier.rotation.y=Math.PI/2;
  const waterMaterial=new T.ShaderMaterial({transparent:true,uniforms:{time:{value:0}},vertexShader:`varying vec2 vUv; varying vec3 world; void main(){vUv=uv;vec4 p=modelMatrix*vec4(position,1.);world=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,fragmentShader:`
    uniform float time;
    varying vec2 vUv;
    varying vec3 world;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
    float wave(vec2 p){return noise(p*2.8+vec2(0.,time*.4))*.055+noise(p*8.7-vec2(time*.12,time*.6))*.012;}
    void main(){
      vec2 p=world.xz;
      float h=wave(p);
      vec3 normal=normalize(vec3((h-wave(p+vec2(.06,0.)))/.06,1.,(h-wave(p+vec2(0.,.06)))/.06));
      vec3 view=normalize(cameraPosition-world);
      float fresnel=pow(1.-max(dot(view,normal),0.),3.);
      float glint=pow(max(dot(reflect(normalize(vec3(.4,-.8,-.2)),normal),view),0.),80.);
      float flow=noise(vec2(p.x*4.,p.y*.9-time*.8));
      float edge=smoothstep(0.,.12,vUv.x)*(1.-smoothstep(.85,1.,vUv.x));
      vec3 waterColor=mix(vec3(.008,.019,.022),vec3(.012,.055,.066),edge);
      waterColor+=vec3(.012,.04,.05)*flow+fresnel*vec3(.055,.105,.13)+glint*.2;
      gl_FragColor=vec4(waterColor,.96);
    }
  `});
  const water=mesh(new T.PlaneGeometry(4.6,72,1,1),waterMaterial,root,11,-.28,0);water.rotation.x=-Math.PI/2;water.castShadow=false;
  const motepos=new Float32Array(180*3);for(let i=0;i<180;i++){motepos[i*3]=-20+rng()*56;motepos[i*3+1]=.5+rng()*5;motepos[i*3+2]=-21+rng()*40;}
  const moteg=new T.BufferGeometry();moteg.setAttribute('position',new T.BufferAttribute(motepos,3));const motes=new T.Points(moteg,new T.PointsMaterial({color:'#ffce86',size:.055,transparent:true,opacity:.8,depthWrite:false}));root.add(motes);
  const keeper=character('#384955'),companion=character('#50735c'),guardian=character('#514a66',true);root.add(keeper.group,companion.group,guardian.group);keeper.group.position.set(-3,0,5);companion.group.position.set(3,0,6);guardian.group.position.set(27,0,-12);
  return {root,trees,keeper,companion,guardian,motes,water,stoneLines,barrier,update(time,dt){waterMaterial.uniforms.time.value=time;motes.rotation.y=Math.sin(time*.1)*.025;const a=moteg.getAttribute('position');for(let i=0;i<a.count;i++)a.setY(i,a.getY(i)+Math.sin(time+i)*dt*.06);a.needsUpdate=true;},dispose(){const gs=new Set<T.BufferGeometry>(),ms=new Set<T.Material>(),ts=new Set<T.Texture>();root.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Points){gs.add(o.geometry);for(const mat of Array.isArray(o.material)?o.material:[o.material]){ms.add(mat);for(const val of Object.values(mat))if(val instanceof T.Texture)ts.add(val);}}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());root.removeFromParent();}};
}
