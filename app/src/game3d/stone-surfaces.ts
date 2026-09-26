import * as T from 'three';

export interface StoneReflection {
  texture: { value: T.Texture | null };
  projection: T.Matrix4;
  ready: { value: number };
}

const coordinates = `
  varying vec3 vStonePosition;
  varying vec3 vStoneNormal;
`;
const noise = `
  float stoneHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float stoneNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(stoneHash(i),stoneHash(i+vec2(1.,0.)),f.x),
      mix(stoneHash(i+vec2(0.,1.)),stoneHash(i+vec2(1.,1.)),f.x),f.y);
  }
`;

/** These materials belong to the world-batched, unskinned stone meshes. */
function surfaceCoordinates(shader: T.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = coordinates + shader.vertexShader.replace('#include <begin_vertex>', `
    #include <begin_vertex>
    vStonePosition=(modelMatrix*vec4(transformed,1.)).xyz;
    vStoneNormal=normalize(mat3(modelMatrix)*normal);
  `);
  shader.fragmentShader = coordinates + noise + shader.fragmentShader;
}

export function mossStone(material: T.MeshStandardMaterial, texture: T.Texture) {
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer);
    surfaceCoordinates(shader);
    shader.uniforms.stoneMoss = { value: texture };
    shader.fragmentShader = 'uniform sampler2D stoneMoss;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float upward=smoothstep(.32,.76,normalize(vStoneNormal).y);
      float islands=stoneNoise(vStonePosition.xz*1.15+vec2(vStonePosition.y*.23));
      islands+=stoneNoise(vStonePosition.xz*4.9)*.22;
      float mossCover=smoothstep(.51,.72,islands)*upward;
      vec3 moss=texture2D(stoneMoss,vStonePosition.xz*.8).rgb;
      diffuseColor.rgb=mix(diffuseColor.rgb,moss*.65,mossCover);
    `).replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor=mix(roughnessFactor,.96,mossCover);
    `);
  };
  material.customProgramCacheKey = () => `${key}/stone-moss-v1`;
  material.needsUpdate = true;
}

/** The damp subset is about a quarter of the paving. Partial surface masks
 * keep visible wet areas near an eighth of the court. Reflection radiance is
 * shared with the creek; this adds no scene render or new render target. */
export function wetStone(material: T.MeshStandardMaterial, reflection: StoneReflection) {
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer);
    surfaceCoordinates(shader);
    shader.uniforms.stoneReflection = reflection.texture;
    shader.uniforms.stoneReflectionProjection = { value: reflection.projection };
    shader.uniforms.stoneReflectionReady = reflection.ready;
    shader.fragmentShader = `
      uniform sampler2D stoneReflection;
      uniform mat4 stoneReflectionProjection;
      uniform float stoneReflectionReady;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float wetCover=smoothstep(.40,.62,stoneNoise(vStonePosition.xz*.78))
        *smoothstep(.6,.94,normalize(vStoneNormal).y);
      diffuseColor.rgb*=mix(1.,.74,wetCover);
    `).replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor=mix(roughnessFactor,.13,wetCover);
    `).replace('#include <opaque_fragment>', `
      vec4 reflected=stoneReflectionProjection*vec4(vStonePosition,1.);
      vec2 reflectionUv=reflected.xy/reflected.w;
      float inReflection=step(0.,reflectionUv.x)*step(reflectionUv.x,1.)
        *step(0.,reflectionUv.y)*step(reflectionUv.y,1.)*step(0.,reflected.w);
      vec3 reflectedRadiance=texture2D(stoneReflection,clamp(reflectionUv,vec2(.002),vec2(.998))).rgb;
      vec3 stoneView=normalize(cameraPosition-vStonePosition);
      float coatingFresnel=.055+.7*pow(1.-max(dot(stoneView,normalize(vStoneNormal)),0.),5.);
      outgoingLight=mix(outgoingLight,reflectedRadiance,
        wetCover*coatingFresnel*inReflection*stoneReflectionReady);
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => `${key}/wet-stone-v1`;
  material.needsUpdate = true;
}
