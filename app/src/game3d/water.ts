import * as T from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { StoneReflection } from './stone-surfaces';
import { CREEK_HALF_WIDTH, creekCenter, creekHalfWidth } from './landscape';

/** A shallow moving current over a cached planar reflection of the wood.
 * Reflection updates are limited to four per second; ripples animate every
 * frame. The normal/depth pass reuses the cache and never renders the scene. */
export function woodlandWater() {
  const geometry = new T.PlaneGeometry(CREEK_HALF_WIDTH * 2 + .3, 72, 1, 144);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const z = -position.getY(i), across = position.getX(i) / (CREEK_HALF_WIDTH + .15);
    position.setX(i, across * (creekHalfWidth(z) + .15) + creekCenter(z));
  }
  geometry.computeVertexNormals();
  const mesh = new Reflector(geometry, {
    textureWidth: 768, textureHeight: 432, multisample: 0, clipBias: .003,
    shader: {
      name: 'Woodland water',
      uniforms: { time: { value: 0 }, color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: new T.Matrix4() } },
      vertexShader: `
        uniform mat4 textureMatrix;
        varying vec2 vUv;
        varying vec3 world;
        varying vec4 reflectionPosition;
        void main(){
          vUv=uv;
          vec4 p=modelMatrix*vec4(position,1.);
          world=p.xyz;
          reflectionPosition=textureMatrix*vec4(position,1.);
          gl_Position=projectionMatrix*viewMatrix*p;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        varying vec3 world;
        varying vec4 reflectionPosition;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
        float wave(vec2 p){
          vec2 flow=vec2(p.x+sin(p.y*.65-time*.3)*.25,p.y-time*.75);
          return noise(flow*vec2(1.3,3.1))*.055+noise(flow*vec2(4.1,8.7))*.014;
        }
        void main(){
          vec2 p=world.xz;
          float h=wave(p);
          vec3 normal=normalize(vec3((h-wave(p+vec2(.06,0.)))/.06,1.,(h-wave(p+vec2(0.,.06)))/.06));
          vec3 view=normalize(cameraPosition-world);
          float fresnel=.045+.75*pow(1.-max(dot(view,normal),0.),3.);
          float edge=smoothstep(0.,.11,vUv.x)*(1.-smoothstep(.87,1.,vUv.x));
          vec2 reflectedUv=reflectionPosition.xy/reflectionPosition.w;
          reflectedUv+=normal.xz*.017*edge;
          vec3 reflection=texture2D(tDiffuse,clamp(reflectedUv,vec2(.002),vec2(.998))).rgb;
          // Broad eddies modulate underwater scattering. Fine highlights come
          // from the reflected environment and surface normal, not dash masks.
          float eddy=noise(vec2(p.x*.9+sin(p.y*.4)*.6,p.y*1.7-time*.8));
          vec3 depth=mix(vec3(.003,.010,.015),vec3(.008,.072,.098),edge);
          depth+=vec3(.003,.045,.060)*eddy*edge;
          float glint=pow(max(dot(reflect(normalize(vec3(.4,-.8,-.2)),normal),view),0.),90.);
          vec3 surface=mix(depth,reflection,clamp(.28+fresnel,.0,.88));
          surface+=vec3(.05,.20,.26)*glint*edge;
          gl_FragColor=vec4(surface,1.);
        }
      `,
    },
  });
  mesh.name = 'woodland-reflecting-creek';
  mesh.position.y = -.28;
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = false;
  const material = mesh.material as T.ShaderMaterial;
  const reflection: StoneReflection = { texture: { value: mesh.getRenderTarget().texture }, projection: new T.Matrix4(), ready: { value: 0 } };
  const inverseWorld = new T.Matrix4();
  let time = 0;
  let lastReflection = -Infinity;
  const renderReflection = mesh.onBeforeRender;
  mesh.onBeforeRender = function(renderer, scene, camera, geometry, material, group) {
    if (scene.overrideMaterial || time - lastReflection < .25) return;
    const previous = { target: renderer.getRenderTarget(), xr: renderer.xr.enabled, shadows: renderer.shadowMap.autoUpdate, visible: this.visible };
    try {
      // Wet stones consume this cache. Unbind it while drawing into the same
      // target; sampling an attached framebuffer is invalid even behind a
      // zero-weight shader branch.
      reflection.texture.value = null;
      renderReflection.call(this, renderer, scene, camera, geometry, material, group);
      reflection.projection.copy((this.material as T.ShaderMaterial).uniforms.textureMatrix.value)
        .multiply(inverseWorld.copy(this.matrixWorld).invert());
      reflection.ready.value = 1;
      lastReflection = time;
    } finally {
      // Restore renderer state even when a material fails inside the reflection.
      reflection.texture.value = mesh.getRenderTarget().texture;
      renderer.xr.enabled = previous.xr;
      renderer.shadowMap.autoUpdate = previous.shadows;
      renderer.setRenderTarget(previous.target);
      this.visible = previous.visible;
    }
  };
  return {
    mesh, reflection,
    update(elapsed: number) { time = elapsed; material.uniforms.time.value = elapsed; },
    // Geometry and material are released by the world's shared resource walk.
    dispose() { mesh.getRenderTarget().dispose(); },
  };
}
