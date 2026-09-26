import * as T from 'three';
import { STATIC_OBSTACLES } from './navigation';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fernGeometry, woodlandPlantGeometry } from './foliage';
import { buildCottage } from './cottage';
import { buildTree } from './trees';
import { buildWoodlandTerrain, courtContains } from './woodland-terrain';
import { BRIDGE, creekCenter, creekHalfWidth, isCreekPoint, landscapeHeight, woodlandSoilRelief } from './landscape';
import { buildBridge, buildRuinedGate } from './ruins';
import { linkWoodlandLights } from './ground-bounce';
import { woodlandWater } from './water';
import { addWellMasonry } from './well-masonry';
import { addWellFrame } from './well-frame';
import { wetStone } from './stone-surfaces';
import { character, type Character } from './characters';
export { character, type Character } from './characters';

const TAU = Math.PI * 2;
export const terrainHeight = landscapeHeight;
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
  const bark = texture('bark'), earth = texture('earth', 6), roof = texture('roof'), rock = texture('rock'), leaves=texture('leaves'), leafSurface=texture('leaf-surface-v1'),mossSurface=texture('moss-surface-v1');
  const mat = (color: string | number, map?: T.Texture) => new T.MeshStandardMaterial({ color, map: map ?? null, roughness: .92, bumpMap: map ?? null, bumpScale: map ? .16 : 0 });
  // Masonry joints come from the modeled blocks. Mapping a complete brick wall
  // onto each block made the well and waystones read as miniature brickwork.
  const broadleaf=new T.MeshStandardMaterial({map:leafSurface,bumpMap:leafSurface,bumpScale:.016,roughness:.78,vertexColors:true,side:T.DoubleSide});
  return { broadleaf, stone: mat('#d2cbb6', rock), stoneDark: mat('#a7b3a2', rock), wood: mat('#bb9c75', bark), bark: mat('#ede2c6', bark), ground: mat('#a3b18a', earth), roof: mat('#c49898', roof), rock:mat('#e8e0c8',rock), plaster: mat('#927b60',bark), brass: new T.MeshStandardMaterial({ color: '#bd9b54', metalness: .62, roughness: .5 }), dark: mat('#292d2b'), moss: mat('#8c9d66',mossSurface), leaf: new T.MeshStandardMaterial({color:'#cbd1bd',map:leaves,alphaTest:.55,side:T.DoubleSide,roughness:.95}), cobble: new T.MeshStandardMaterial({color:'#b2a88c',map:rock,bumpMap:rock,bumpScale:.09,roughness:.86}), fern: new T.MeshStandardMaterial({color:'#557335', side:T.DoubleSide, roughness:.83}), glow: new T.MeshStandardMaterial({color:'#ffcf6b',emissive:'#ff9d30',emissiveIntensity:1.3}), cloth: mat('#415d66'), skin: mat('#b49a82'), purple: mat('#605770') } satisfies Materials;
}
function lantern(p: T.Object3D, m: Materials, x: number, y: number, z: number, light = true, intensity = 9, reach = 7) {
  const g = new T.Group(); g.position.set(x,y,z); p.add(g);
  box(g,m.brass,0,-.26,0,.34,.09,.34); box(g,m.brass,0,.28,0,.4,.08,.4);
  mesh(new T.ConeGeometry(.31,.19,4),m.brass,g,0,.41,0).rotation.y=Math.PI/4;
  box(g,m.glow,0,0,0,.23,.46,.23);
  for(const a of [-1,1]) for(const b of [-1,1]) box(g,m.dark,a*.15,0,b*.15,.04,.55,.04);
  if(light){const l = new T.PointLight('#ffb454',intensity,reach,2); l.position.set(x,y,z); p.add(l);}
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
function well(p:T.Object3D,m:Materials) {
  const g=new T.Group();g.position.set(4.5,0,10);p.add(g);
  addWellMasonry(g,m.stone,rng);
  addWellFrame(g,m.wood);
  roof(g,m,0,3.15,0,3.5,2.9,1.15);beam(g,m.wood,v(-1.35,2.3,0),v(1.35,2.3,0),.12);
  lantern(g,m,0,1.9,0,true,42,11);mesh(new T.CircleGeometry(.97,32),new T.MeshStandardMaterial({color:'#3dccc1',emissive:'#1c7b77',emissiveIntensity:.45,roughness:.2}),g,0,.12,0).rotation.x=-Math.PI/2;
}
/** Small inhabited rooms fitted into the old trees, above the walking space. */
function treeRoom(p:T.Group,lightRoot:T.Group,m:Materials,y:number,z:number,s=1) {
  const g=new T.Group();g.position.set(0,y,z);g.scale.setScalar(s);p.add(g);
  box(g,m.wood,0,.95,-.22,1.65,2.35,.6);
  archedWindow(g,m,0,.3,.13,1.35);
  roof(g,m,0,2.25,.05,2.5,1.75,1.4);
  for(let i=0;i<8;i++)box(g,m.wood,-1.35+i*.38,-.06,.6,.35,.16,1.6);
  for(const x of [-1.48,1.48]){
    beam(g,m.wood,v(x,-.05,1.35),v(x,1.02,1.35),.065);
    beam(g,m.wood,v(x,1.02,1.35),v(x,.82,-.1),.055);
    beam(g,m.bark,v(x,-.1,1.2),v(x*.35,-2.5,-.5),.15,.25);
  }
  beam(g,m.wood,v(-1.48,1.02,1.35),v(1.48,1.02,1.35),.065);
  for(const x of [-.95,-.45,.05,.55,1.05])beam(g,m.wood,v(x,0,1.35),v(x,.94,1.35),.028);
  const light=new T.PointLight('#ffb663',16,8,2);light.position.set(0,1.35,1.3);g.add(light);
  // Camera occlusion hides the tree mesh, not its lights. Changing the visible
  // point-light count otherwise recompiles every lit material on first orbit.
  lightRoot.attach(light);
}
function stones(p:T.Object3D,m:Materials) {
  const positions=[[6,4],[17,3],[24,-6]]; const result:T.Mesh[]=[];
  positions.forEach(([x,z])=>{
    const g=new T.Group();g.position.set(x,terrainHeight(x,z),z);p.add(g);
    mesh(new T.CylinderGeometry(.76,.9,.25,7),m.stone,g,0,.1,0);
    const stone=mesh(new T.DodecahedronGeometry(1,1),m.stoneDark,g,0,1.03,0);stone.scale.set(.65,1.25,.48);
    const glow=new T.MeshStandardMaterial({color:'#717e80',emissive:'#ffd579',emissiveIntensity:0,roughness:.6});
    // Three carved lines, each individually inset, catch light as the stone renews.
    for(let i=0;i<3;i++){const line=box(g,glow,0,1.4-i*.23,.45,.6-i*.08,.055,.03);result.push(line);}
    ring(g,m.stone,x===6?0:.02,.16,0,1.05,.05);
  });return result;
}

/** Curled fallen leaves collect at root shoulders, with exposed soil between
 * clusters. One instanced mesh keeps these ground contacts inexpensive. */
function rootLitter(parent:T.Group,base:T.MeshStandardMaterial,roots:{x:number;z:number;r:number}[]) {
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([
    0,.008,-.18, -.064,.002,-.045, -.044,0,.105, 0,.004,.17,
    .059,.003,.07, .048,.011,-.10, 0,.024,-.01,
  ],3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute([
    .5,1, 0,.62, .16,.19, .5,0, .97,.29, .88,.77, .5,.53,
  ],2));
  geometry.setIndex([0,1,6,1,2,6,2,3,6,3,4,6,4,5,6,5,0,6]);
  geometry.computeVertexNormals();
  const material=base.clone();material.name='woodland-margin-litter';
  material.vertexColors=false;material.color.set('#b69a65');material.roughness=.98;
  const leaves=new T.InstancedMesh(geometry,material,roots.length*36);
  const placed=new T.Object3D(),randomLeaf=random(4907);
  let count=0;
  for(const root of roots){
    if(root.z < -24)continue;
    const radius=root.x===-2&&root.z===-11?2.1:root.r;
    for(let cluster=0;cluster<6;cluster++){
      const angle=randomLeaf()*TAU,reach=radius*(1.5+randomLeaf()*1.25);
      const cx=root.x+Math.cos(angle)*reach,cz=root.z+Math.sin(angle)*reach;
      for(let leaf=0;leaf<6;leaf++){
        const x=cx+(randomLeaf()-.5)*.65,z=cz+(randomLeaf()-.5)*.65;
        if(isCreekPoint(x,z,.2)||courtContains(x,z))continue;
        const y=terrainHeight(x,z)-.05+Math.sin(x*.6)*Math.cos(z*.45)*.025;
        placed.position.set(x,y+.009,z);
        placed.rotation.set((randomLeaf()-.5)*.1,randomLeaf()*TAU,(randomLeaf()-.5)*.1);
        placed.scale.set(.7+randomLeaf()*.7,.6+randomLeaf()*.4,.7+randomLeaf()*.8);
        placed.updateMatrix();leaves.setMatrixAt(count,placed.matrix);
        leaves.setColorAt(count,new T.Color('#e3cc9d').multiplyScalar(.55+randomLeaf()*.35));
        count++;
      }
    }
  }
  leaves.count=count;leaves.receiveShadow=true;parent.add(leaves);
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
  const groundGeo=new T.PlaneGeometry(110,120,220,240),pos=groundGeo.getAttribute('position');
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=-pos.getY(i);const edge=Math.max(Math.abs(x-4)-25,Math.abs(z)-22,0);const base=isCreekPoint(x,z,.2)?-.9:terrainHeight(x,z);pos.setZ(i,base+Math.min(edge*.15,2)+Math.sin(x*.6)*Math.cos(z*.45)*.025);}
  // Broad moss/soil variation gives the ground coherent masses beneath its
  // small leaf texture; a single tiled albedo otherwise reads as visual noise.
  const groundColors=new Float32Array(pos.count*3),soil=new T.Color().setRGB(1,.94,.82),forest=new T.Color().setRGB(.78,1,.72);
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),z=-pos.getY(i);
    const patch=T.MathUtils.clamp(.5+Math.sin(x*.24+Math.sin(z*.19))*.25+Math.cos(z*.31+x*.07)*.25,0,1);
    const c=soil.clone().lerp(forest,patch);
    const sheltered=T.MathUtils.smoothstep(woodlandSoilRelief(x,z),.05,.30);
    c.multiplyScalar(1-sheltered*.16);
    groundColors.set([c.r,c.g,c.b],i*3);
  }
  groundGeo.setAttribute('color',new T.BufferAttribute(groundColors,3));m.ground.vertexColors=true;m.ground.bumpScale=.075;
  groundGeo.computeVertexNormals();const ground=mesh(groundGeo,m.ground,statics,0,-.05,0);ground.rotation.x=-Math.PI/2;
  buildCottage(statics,m,-11.5,-4,1.4);well(statics,m);buildBridge(statics,m);buildRuinedGate(statics,m,27,-15);
  const terrain=buildWoodlandTerrain(statics,m,1607);
  const dummy=new T.Object3D();
  // Diffuse amber bounce from the well lantern spreads across the gathering
  // court. Its raised position avoids burning out the stone directly below.
  const hearthBounce=new T.SpotLight('#ff8a1a',700,24,1.1,1,2);
  hearthBounce.position.set(4.5,5,15);hearthBounce.target.position.set(4.5,0,12);
  statics.add(hearthBounce,hearthBounce.target);
  const trees:T.Group[]=[];
  const treePoints=STATIC_OBSTACLES.filter(o=>o.kind==='circle'&&o.feature!=='well').map(o=>o.kind==='circle'?{x:o.center.x,z:o.center.z,r:o.radius*(o.radius>1.5?.68:.58)}:{x:0,z:0,r:1});
  for(let i=0;i<30;i++)treePoints.push({x:-32+rng()*70,z:-26-rng()*19,r:.55+rng()*.7});
  for(const {x,z,r} of treePoints){
    const ancient=x===-2&&z===-11;
    const h=ancient?24:13+rng()*8,g=buildTree(root,m,x,z,h,ancient?2.1:r,Math.round(rng()*10000));trees.push(g);
    if(ancient)treeRoom(g,root,m,6.2,2.05,.95);
    if(x===13&&z===-13)treeRoom(g,root,m,7.5,1.6,.72);
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
  rootLitter(statics,m.broadleaf,treePoints);
  // Fine fronds, broad folded leaves and upright grasses grow in overlapping
  // colonies. Three silhouettes replace the conspicuous repeated fern stamps.
  const vegetation=[fernGeometry(7),woodlandPlantGeometry('broadleaf',11),woodlandPlantGeometry('grass',23)]
    .map((geometry,i)=>new T.InstancedMesh(geometry,i===1?m.broadleaf:new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide}),600));
  const counts=[0,0,0];
  const plant=(x:number,z:number,scale:number,family:number,y=terrainHeight(x,z)+.02)=>{
    dummy.position.set(x,y,z);dummy.rotation.set((rng()-.5)*.5,rng()*TAU,(rng()-.5)*.5);
    dummy.scale.set(scale*(.6+rng()*.8),scale*(.65+rng()*.8),scale*(.6+rng()*.8));dummy.updateMatrix();
    const instance=counts[family]++;
    vegetation[family].setMatrixAt(instance,dummy.matrix);
    vegetation[family].setColorAt(instance,new T.Color().setRGB(1,.99,.92).multiplyScalar(.72+rng()*.28));
  };
  const soilPocket=(x:number,z:number)=>((x+6.2)/1.05)**2+((z-13.1)/1.45)**2<1
    ||((x+9)/.8)**2+((z-7.5)/1.1)**2<1
    ||((x+8.9)/1.25)**2+((z-10.8)/.95)**2<1
    ||((x+7.1)/.85)**2+((z-15.6)/1.6)**2<1;
  const colonies=[[-8,9],[-5.8,15],[-13,8],[-9,-11],[0,-16],[9,-17],[21,9],[27,13],[25,-10],[31,-12],[-18,-12],[6,-6]];
  for(let j=0;j<400;j++){
    const anchor=colonies[j%colonies.length],a=rng()*TAU,r=Math.sqrt(rng())*3.1;
    const x=anchor[0]+Math.cos(a)*r,z=anchor[1]+Math.sin(a)*r;
    if(soilPocket(x,z)||(x>-5.1&&x<-2.7&&z>9&&z<19)||courtContains(x,z)||(x-4.5)**2+(z-10)**2<16||
      (z<0&&x>0&&x<6)||Math.abs(z-(x<18?2:2-(x-18)*1.5))<1.5||isCreekPoint(x,z,.25))continue;
    const family=j%10<3?0:j%10<8?1:2;
    plant(x,z,(z>10?.75:.45)+rng()*.65,family);
  }
  // Deliberately planted clumps knit the raised bank and fence into the court.
  for(let i=0;i<10;i++){
    const z=8.2+i*.95,x=-6.1+Math.sin(i*2.1)*.35;
    if(!soilPocket(x,z))plant(x,z,.85+rng()*.3,i%3);
  }
  // Root creekside plants on the actual sculpted stone tops, not the lower
  // walking plane. This keeps their stems in contact with the irregular bank.
  const bankRay=new T.Raycaster(new T.Vector3(),new T.Vector3(0,-1,0));
  const bankRocks=terrain.meshes.filter(mesh=>mesh.name.endsWith('bank-outcrops'));
  statics.updateMatrixWorld(true);
  const bankRandom=random(611);
  const bankClumps=[{side:-1,z:7.0,scale:.65},{side:1,z:6.3,scale:.55},
    {side:1,z:10.5,scale:.7},{side:-1,z:15.8,scale:.9},
    {side:1,z:19.8,scale:.85},{side:-1,z:22,scale:.6}];
  for(const clump of bankClumps){
    const count=3+Math.floor(bankRandom()*5);
    let planted=0;
    for(let attempt=0;attempt<30&&planted<count;attempt++){
      const z=clump.z+(bankRandom()-.5)*1.8;
      const x=creekCenter(z)+clump.side*(creekHalfWidth(z)+.35+bankRandom()*.6);
      bankRay.ray.origin.set(x,5,z);
      const hit=bankRay.intersectObjects(bankRocks,false)[0];
      if(!hit)continue;
      const family=planted%5<2?0:planted%5<4?1:2;
      plant(x,z,clump.scale*(.65+bankRandom()*.95),family,hit.point.y+.015);
      planted++;
    }
  }
  vegetation.forEach((plants,i)=>{plants.count=counts[i];plants.receiveShadow=true;statics.add(plants);});
  for(const [x,z] of [[-4,7],[5,-2],[-12,2],[19,5],[23,-2],[27,-8],[1,-8],[5,-16]]){
    beam(statics,m.wood,v(x,0,z),v(x,2.7,z),.085);beam(statics,m.wood,v(x,2.7,z),v(x+.55,2.7,z),.06);
    lantern(statics,m,x+.5,2.2,z,true,z<0&&x<6?65:9,8);
  }
  // A foreground fence follows the planted bank beside the gathering court.
  for(let i=0;i<6;i++){
    const x=-4.2+i*.2,z=10+i*1.55,y=terrainHeight(x,z);
    box(statics,m.wood,x,y+.75,z,.22,1.6,.22,(rng()-.5)*.09);
    if(i<5){
      const nx=x+.2,nz=z+1.55,ny=terrainHeight(nx,nz);
      for(const height of [.58,1.13])beam(statics,m.wood,v(x,y+height,z),v(nx,ny+height,nz),.085);
    }
  }
  box(statics,m.wood,20,.42,8,1.2,.8,.85);box(statics,m.brass,20,.83,8,1.28,.09,.91);box(statics,m.brass,20,.5,8.45,.2,.2,.06);
  batchStatic(statics);
  const stoneLines=stones(root,m);
  const barrier=mesh(new T.PlaneGeometry(3.6,2.6),new T.MeshBasicMaterial({color:'#ad8bcc',transparent:true,opacity:.24,side:T.DoubleSide,depthWrite:false}),root,8.55,1.35,BRIDGE.centerZ);barrier.rotation.y=Math.PI/2;
  const creek=woodlandWater(),water=creek.mesh;root.add(water);
  const dampPaving=terrain.meshes.find(mesh=>mesh.name==='woodland-court-paving-damp')!;
  wetStone(dampPaving.material as T.MeshStandardMaterial,creek.reflection);
  const motepos=new Float32Array(180*3);for(let i=0;i<180;i++){motepos[i*3]=-20+rng()*56;motepos[i*3+1]=.5+rng()*5;motepos[i*3+2]=-21+rng()*40;}
  const moteg=new T.BufferGeometry();moteg.setAttribute('position',new T.BufferAttribute(motepos,3));const motes=new T.Points(moteg,new T.PointsMaterial({color:'#ffce86',size:.055,transparent:true,opacity:.8,depthWrite:false}));root.add(motes);
  const keeper=character('#384955'),companion=character('#50735c'),guardian=character('#514a66',true);root.add(keeper.group,companion.group,guardian.group);keeper.group.position.set(-3,0,5);companion.group.position.set(3,0,6);guardian.group.position.set(27,0,-12);
  const caretaker=character('#76634e');caretaker.group.position.set(1.8,0,11.2);
  caretaker.group.rotation.y=2;caretaker.group.scale.setScalar(.97);root.add(caretaker.group);
  const linked=new Set<T.Material>();
  root.traverse(object=>{
    if(!(object instanceof T.Mesh))return;
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(linked.has(material))continue;
      linked.add(material);
      const ground=material===m.ground||vegetation.some(plants=>material===plants.material)||/woodland-(court|moss|margin)/.test(material.name);
      if(!ground&&(material instanceof T.MeshStandardMaterial||material instanceof T.MeshLambertMaterial))linkWoodlandLights(material,{groundBounce:material.name==='weathered-well-stone'?.16:material.name==='weathered-well-rim'?.07:0,lanterns:material===m.bark?.82:1});
    }
  });
  return {root,trees,keeper,companion,guardian,motes,water,stoneLines,barrier,update(time,dt){caretaker.update(time,false);creek.update(time);motes.rotation.y=Math.sin(time*.1)*.025;const a=moteg.getAttribute('position');for(let i=0;i<a.count;i++)a.setY(i,a.getY(i)+Math.sin(time+i)*dt*.06);a.needsUpdate=true;},dispose(){creek.dispose();const gs=new Set<T.BufferGeometry>(),ms=new Set<T.Material>(),ts=new Set<T.Texture>();root.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Points){gs.add(o.geometry);for(const mat of Array.isArray(o.material)?o.material:[o.material]){ms.add(mat);for(const val of Object.values(mat))if(val instanceof T.Texture)ts.add(val);}}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());root.removeFromParent();}};
}
