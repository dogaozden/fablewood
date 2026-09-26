import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WoodlandOcclusionPass } from './ambient-occlusion';
import { buildWorld, character, terrainHeight, type Character } from './world';
import { LANDMARKS, distance, findPath, isNearLandmark, nearestReachable, type LandmarkId, type Point } from './navigation';
import { canAction, type Journey } from './model';
import { disposeTree } from './dispose';
import { intersectLandscape } from './landscape-picking';

interface Callbacks { onStep:(point:Point)=>boolean; onInteract:(id:LandmarkId)=>void; onSelectEnemy:(id:string)=>void; onStats:(fps:number,drawCalls:number)=>void; onMoving:(moving:boolean)=>void; onReady:()=>void }
export class RealmRenderer {
  readonly renderer:T.WebGLRenderer;
  readonly scene=new T.Scene();
  readonly camera=new T.PerspectiveCamera(44,1,.1,150);
  readonly controls:OrbitControls;
  private composer:EffectComposer;
  private ambientOcclusion:WoodlandOcclusionPass;
  private world:ReturnType<typeof buildWorld>;
  private state:Journey;
  private path:Point[]=[];
  private enabled=true;
  private frame=0;
  private clock=new T.Clock();
  private frames:number[]=[];
  private lastStats=0;
  private resizeObserver:ResizeObserver;
  private markers=new Map<string,HTMLButtonElement>();
  private enemies=new Map<string,Character>();
  private ray=new T.Raycaster();
  private pointer=new T.Vector2();
  private startPointer={x:0,y:0};
  private destination:T.Mesh;
  private telegraph:T.Mesh;
  private range:T.Mesh;
  private ready=false;
  private renderingPaused=false;
  private down=(e:PointerEvent)=>{this.startPointer={x:e.clientX,y:e.clientY};};
  private up=(e:PointerEvent)=>{
    if(e.button!==0||!this.enabled||Math.hypot(e.clientX-this.startPointer.x,e.clientY-this.startPointer.y)>6)return;
    const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);
    const point=intersectLandscape(this.ray.ray);if(point)this.walkTo(point);
  };
  private key=(e:KeyboardEvent)=>{
    if(!this.enabled||e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement)return;
    const key=e.key.toLowerCase();
    if(key==='e'){e.preventDefault();const id=this.nearby();if(id)this.callbacks.onInteract(id);return;}
    if(key==='q'||key==='r'){e.preventDefault();const p=this.camera.position.clone().sub(this.controls.target);p.applyAxisAngle(new T.Vector3(0,1,0),key==='q'?.15:-.15);this.camera.position.copy(this.controls.target).add(p);return;}
    if(key==='f'){this.focus();return;}
    if(!['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key))return;
    e.preventDefault();if(this.path.length)return;
    const forward=this.controls.target.clone().sub(this.camera.position);forward.y=0;forward.normalize();const right=new T.Vector3(-forward.z,0,forward.x);let dir=forward;
    if(key==='s'||key==='arrowdown')dir=forward.negate();if(key==='a'||key==='arrowleft')dir=right.negate();if(key==='d'||key==='arrowright')dir=right;
    this.walkTo({x:this.state.position.x+Math.round(dir.x),z:this.state.position.z+Math.round(dir.z)});
  };
  constructor(private container:HTMLDivElement,private labels:HTMLDivElement,initial:Journey,private callbacks:Callbacks){
    this.state=initial;
    this.renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance',alpha:false});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));this.renderer.info.autoReset=false;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.VSMShadowMap;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;
    this.renderer.domElement.setAttribute('aria-label','The Lantern Wood, an interactive 3D world');this.renderer.domElement.tabIndex=0;container.appendChild(this.renderer.domElement);
    this.scene.background=new T.Color('#112f46');this.scene.fog=new T.Fog('#1b4c68',38,80);
    this.scene.add(new T.HemisphereLight('#8fb2d0','#19252f',3.6));
    const moon=new T.DirectionalLight('#94c5db',3.1);moon.position.set(-15,30,6);moon.castShadow=true;moon.shadow.mapSize.set(2048,2048);moon.shadow.radius=3;moon.shadow.blurSamples=8;moon.shadow.intensity=.75;moon.shadow.camera.left=-35;moon.shadow.camera.right=35;moon.shadow.camera.top=35;moon.shadow.camera.bottom=-35;moon.shadow.camera.far=90;moon.shadow.normalBias=.045;moon.shadow.bias=-.0002;this.scene.add(moon);
    const rim=new T.DirectionalLight('#4c93c8',2);rim.position.set(15,14,-24);this.scene.add(rim);
    this.world=buildWorld(this.scene);
    this.world.keeper.group.position.set(initial.position.x,0,initial.position.z);
    this.camera.position.set(5,15,30);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(5,.7,1);this.controls.minDistance=9;this.controls.maxDistance=49;this.controls.minPolarAngle=.25;this.controls.maxPolarAngle=1.2;this.controls.enableDamping=true;this.controls.dampingFactor=.075;this.controls.enablePan=true;this.controls.maxTargetRadius=40;this.controls.mouseButtons={LEFT:undefined as unknown as T.MOUSE,MIDDLE:T.MOUSE.PAN,RIGHT:T.MOUSE.ROTATE};
    this.composer=new EffectComposer(this.renderer);this.composer.addPass(new RenderPass(this.scene,this.camera));this.ambientOcclusion=new WoodlandOcclusionPass(this.scene,this.camera);
    this.ambientOcclusion.updateGtaoMaterial({radius:.8,thickness:.45,scale:1,samples:8});
    this.ambientOcclusion.updatePdMaterial({radius:5,samples:8});
    this.ambientOcclusion.blendIntensity=.58;this.composer.addPass(this.ambientOcclusion);
    this.composer.addPass(new UnrealBloomPass(new T.Vector2(1,1),.14,.55,1.2));this.composer.addPass(new OutputPass());
    const flatRing=(radius:number,color:string,opacity:number)=>{const o=new T.Mesh(new T.RingGeometry(radius-.03,radius,48),new T.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:T.DoubleSide}));o.rotation.x=-Math.PI/2;o.position.y=.12;this.scene.add(o);return o;};
    this.destination=flatRing(.5,'#efd3a0',.8);this.destination.visible=false;this.range=flatRing(3,'#bbd9cc',.4);this.telegraph=new T.Mesh(new T.CircleGeometry(1.65,48),new T.MeshBasicMaterial({color:'#d28a69',transparent:true,opacity:.24,depthWrite:false}));this.telegraph.rotation.x=-Math.PI/2;this.scene.add(this.telegraph);
    for(const landmark of LANDMARKS){const b=document.createElement('button');b.className='realm-marker';b.setAttribute('aria-label',landmark.label);b.innerHTML=`<span class="marker-symbol">${landmark.id.startsWith('stone')?'◇':landmark.id==='mira'?'✧':landmark.id==='guardian'?'⚔':landmark.id==='chest'?'▣':'⌂'}</span><span class="marker-label">${landmark.label}</span>`;b.addEventListener('click',()=>{if(!this.enabled)return;if(isNearLandmark(this.state.position,landmark.id))this.callbacks.onInteract(landmark.id);else this.walkNear(landmark.id);});labels.appendChild(b);this.markers.set(landmark.id,b);}
    this.renderer.domElement.addEventListener('pointerdown',this.down);this.renderer.domElement.addEventListener('pointerup',this.up);window.addEventListener('keydown',this.key);
    if(import.meta.env.DEV&&new URLSearchParams(location.search).has('profile-render')){
      (window as Window & {__FW_RENDERER?:RealmRenderer}).__FW_RENDERER=this;
    }
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();this.setState(initial);this.animate();
  }
  private resize(){const {width,height}=this.container.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height);this.composer.setSize(width,height);this.ambientOcclusion.setSize(Math.ceil(width*.65),Math.ceil(height*.65));this.camera.aspect=width/height;this.camera.updateProjectionMatrix();}
  setEnabled(enabled:boolean){this.enabled=enabled;if(!enabled)this.stop();}
  /** Freeze only animation while browser tooling captures this rendered frame. */
  setRenderingPaused(paused:boolean){
    if(this.renderingPaused===paused)return;
    this.renderingPaused=paused;
    if(paused)cancelAnimationFrame(this.frame);
    else{this.clock.getDelta();this.animate();}
  }
  private stop(){this.callbacks.onMoving(false);this.path=[];this.destination.visible=false;}
  walkNear(id:LandmarkId){const lm=LANDMARKS.find(l=>l.id===id)!;const dir=new T.Vector2(this.state.position.x-lm.position.x,this.state.position.z-lm.position.z).normalize().multiplyScalar(Math.max(1.8,lm.radius-.6));this.walkTo({x:lm.position.x+dir.x,z:lm.position.z+dir.y});}
  walkTo(point:Point){if(!this.enabled)return;const to=nearestReachable(point,this.state.renewed.includes('stone-1'));if(!to)return;const path=findPath(this.state.position,to,this.state.renewed.includes('stone-1'));if(path.length<2)return;this.path=path.slice(1);this.destination.position.set(to.x,terrainHeight(to.x,to.z)+.15,to.z);this.destination.visible=true;this.callbacks.onMoving(true);}
  focus(){const p=this.world.keeper.group.position;const offset=this.camera.position.clone().sub(this.controls.target);this.controls.target.copy(p).add(new T.Vector3(0,.7,0));this.camera.position.copy(this.controls.target).add(offset);}
  nearby():LandmarkId|null{const sorted=[...LANDMARKS].sort((a,b)=>distance(this.state.position,a.position)-distance(this.state.position,b.position));return sorted.find(l=>isNearLandmark(this.state.position,l.id))?.id??null;}
  setState(state:Journey){
    const old=this.state;this.state=state;
    if(state.hp<old.hp)this.world.keeper.hurt?.();
    if(old.combat && state.combat?.enemies.some(enemy=>enemy.hp<(old.combat?.enemies.find(previous=>previous.id===enemy.id)?.hp??enemy.hp)))this.world.keeper.strike?.();
    if(!this.path.length&&distance({x:this.world.keeper.group.position.x,z:this.world.keeper.group.position.z},state.position)>4){this.world.keeper.group.position.set(state.position.x,0,state.position.z);this.focus();}
    if(old.combat&&!state.combat)this.stop();
    this.world.barrier.visible=!state.renewed.includes('stone-1');
    this.world.stoneLines.forEach((line,i)=>{const active=state.renewed.includes(`stone-${Math.floor(i/3)+1}`);const mat=line.material as T.MeshStandardMaterial;mat.emissiveIntensity=active?2.2:0;mat.color.set(active?'#ffd79c':'#70827d');});
    this.world.guardian.group.visible=state.chapter!=='return'&&state.chapter!=='complete'&&!state.combat;
    const live=new Set(state.combat?.enemies.map(e=>e.id)??[]);for(const [id,c]of this.enemies){if(!live.has(id)){disposeTree(c.group);this.enemies.delete(id);this.markers.get(id)?.remove();this.markers.delete(id);}}
    for(const e of state.combat?.enemies??[]){let c=this.enemies.get(e.id);if(!c){c=character('#5e5777',state.combat?.kind==='guardian');this.enemies.set(e.id,c);this.scene.add(c.group);const b=document.createElement('button');b.className='realm-marker enemy-marker';b.addEventListener('click',()=>this.callbacks.onSelectEnemy(e.id));this.labels.appendChild(b);this.markers.set(e.id,b);}if(e.hp<(old.combat?.enemies.find(previous=>previous.id===e.id)?.hp??e.hp))c.hurt?.();if(state.hp<old.hp)c.strike?.();c.group.position.set(e.position.x,terrainHeight(e.position.x,e.position.z)+.08,e.position.z);c.group.rotation.y=Math.atan2(state.position.x-e.position.x,state.position.z-e.position.z);c.group.visible=e.hp>0;const b=this.markers.get(e.id)!;b.innerHTML=`<span class="marker-symbol">⚔</span><span class="marker-label">${state.combat?.kind==='guardian'?'The Toll-Warden':'Faded sentinel'} · ${e.hp}/${e.maxHp}</span>`;b.setAttribute('aria-label',`Target ${e.id}`);}
  }
  private project(x:number,y:number,z:number){const p=new T.Vector3(x,y,z).project(this.camera),r=this.container.getBoundingClientRect();return {x:(p.x*.5+.5)*r.width,y:(-.5*p.y+.5)*r.height,visible:p.z<1&&p.z>-1&&Math.abs(p.x)<1.1&&Math.abs(p.y)<1.1};}
  private animate=()=>{
    if(this.renderingPaused)return;
    this.frame=requestAnimationFrame(this.animate);const rawDt=this.clock.getDelta(),dt=Math.min(rawDt,.05),time=this.clock.elapsedTime;
    const actor=this.world.keeper.group;let moving=false;
    if(this.path.length && !canAction(this.state,{type:'move',to:this.path[0]}).ok)this.stop();
    if(this.path.length&&this.enabled){const next=this.path[0],target=new T.Vector3(next.x,terrainHeight(next.x,next.z)+.08,next.z);const d=target.clone().sub(actor.position);if(d.length()<.13){if(this.callbacks.onStep(next)){actor.position.copy(target);this.path.shift();}else this.stop();if(!this.path.length)this.stop();}else{moving=true;actor.position.add(d.normalize().multiplyScalar(Math.min(4.8*dt,d.length())));actor.rotation.y=Math.atan2(next.x-actor.position.x,next.z-actor.position.z);}}
    if(!this.path.length){const target=new T.Vector3(this.state.position.x,terrainHeight(this.state.position.x,this.state.position.z)+.08,this.state.position.z);actor.position.lerp(target,Math.min(1,dt*12));}
    if(this.state.companion){const cp=this.world.companion.group;const desired={x:actor.position.x+1.6,z:actor.position.z+.55};
      const reachable=nearestReachable(desired,this.state.renewed.includes('stone-1'))??this.state.position;
      const target=new T.Vector3(reachable.x,terrainHeight(reachable.x,reachable.z)+.08,reachable.z);const d=target.clone().sub(cp.position);cp.position.lerp(target,Math.min(1,dt*3));cp.rotation.y=Math.atan2(d.x,d.z);this.world.companion.update(time,d.length()>.25);}else this.world.companion.update(time,false);
    this.world.keeper.update(time,moving);this.world.guardian.update(time,false);for(const c of this.enemies.values())c.update(time,false);
    const onScreen=actor.position.clone().project(this.camera);
    if(moving&&(Math.abs(onScreen.x)>.72||Math.abs(onScreen.y)>.68)){const delta=actor.position.clone().sub(this.controls.target).multiplyScalar(dt*1.2);delta.y=0;this.controls.target.add(delta);this.camera.position.add(delta);}
    this.controls.update();this.world.update(time,dt);
    const view=this.camera.position.clone().sub(this.controls.target);view.y=0;view.normalize();
    for(const tree of this.world.trees){const d=tree.position.clone().sub(this.controls.target);d.y=0;const front=d.dot(view),side=d.clone().addScaledVector(view,-front).length();tree.visible=!(front>3&&side<23);const canopy=tree.getObjectByName('canopy');if(canopy)canopy.visible=!(front>0&&side<20);}

    this.range.visible=!!this.state.combat;this.range.position.set(actor.position.x,terrainHeight(actor.position.x,actor.position.z)+.14,actor.position.z);this.range.scale.setScalar((this.state.combat?.moveRemaining??3)/3);
    const tel=this.state.combat?.telegraph;this.telegraph.visible=!!tel;if(tel){this.telegraph.position.set(tel.x,terrainHeight(tel.x,tel.z)+.12,tel.z);}
    for(const l of LANDMARKS){const b=this.markers.get(l.id)!;const p=this.project(l.position.x,l.id==='well'?3.8:l.id.startsWith('stone')?2.6:2.2,l.position.z);const near=distance(this.state.position,l.position)<8;b.style.display=p.visible&&!this.state.combat?'':'none';b.style.transform=`translate(-50%,-100%) translate(${p.x}px,${p.y}px)`;b.classList.toggle('near',near);b.classList.toggle('renewed',this.state.renewed.includes(l.id));if(l.id==='mira'&&this.state.companion)b.style.display='none';}
    for(const e of this.state.combat?.enemies??[]){const b=this.markers.get(e.id);if(!b)continue;const p=this.project(e.position.x,terrainHeight(e.position.x,e.position.z)+3.4,e.position.z);b.style.display=p.visible&&e.hp>0?'':'none';b.style.transform=`translate(-50%,-100%) translate(${p.x}px,${p.y}px)`;}
    this.renderer.info.reset();this.composer.render();if(!this.ready){this.ready=true;this.callbacks.onReady();}
    if(rawDt>0)this.frames.push(rawDt);if(time-this.lastStats>1){const avg=this.frames.reduce((a,b)=>a+b,0)/this.frames.length;this.callbacks.onStats(Math.round(1/avg),this.renderer.info.render.calls);this.frames=[];this.lastStats=time;}
  };
  dispose(){
    const debugWindow=window as Window & {__FW_RENDERER?:RealmRenderer};
    if(debugWindow.__FW_RENDERER===this)delete debugWindow.__FW_RENDERER;
    cancelAnimationFrame(this.frame);this.stop();this.resizeObserver.disconnect();window.removeEventListener('keydown',this.key);this.renderer.domElement.removeEventListener('pointerdown',this.down);this.renderer.domElement.removeEventListener('pointerup',this.up);this.controls.dispose();this.world.dispose();for(const c of this.enemies.values())disposeTree(c.group);for(const m of this.markers.values())m.remove();for(const object of [this.destination,this.range,this.telegraph])disposeTree(object);for(const pass of this.composer.passes)pass.dispose();this.composer.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();}
}
