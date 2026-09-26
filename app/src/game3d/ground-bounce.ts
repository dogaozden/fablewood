import { MeshLambertMaterial, MeshStandardMaterial, ShaderChunk } from 'three';

/** The scene's sole spotlight models diffuse lantern bounce across the court.
 * Link it to receiving ground materials so it cannot light the outside of the
 * well roof or wash out the party. The well masonry receives a small fraction.
 * Lantern response can also be restrained on bark without dimming path pools.
 * WebGL's light layers select cameras, not per-object light receivers. */
export function linkWoodlandLights(material: MeshStandardMaterial | MeshLambertMaterial, response: { groundBounce?: number; lanterns?: number } = {}): void {
  const strength=response.groundBounce??0, lanterns=response.lanterns??1;
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer);
    const source = ShaderChunk.lights_fragment_begin;
    const lookup = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';
    const pointLookup='getPointLightInfo( pointLight, geometryPosition, directLight );';
    if (!source.includes(lookup)||!source.includes(pointLookup)) throw new Error('Ground bounce light linking needs the current Three spotlight shader.');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      source.replace(lookup, `${lookup}\n\t\tdirectLight.color *= ${strength.toFixed(4)};`)
        .replace(pointLookup,`${pointLookup}\n\t\tdirectLight.color *= ${lanterns.toFixed(4)};`),
    );
  };
  material.customProgramCacheKey = () => `${cacheKey}/woodland-lights-v3/${strength}/${lanterns}`;
  material.needsUpdate = true;
}
