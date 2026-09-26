import { Object3D } from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

/** The normal override cannot represent alpha-cut leaves; exclude their cards
 * from this pass so transparent gaps do not cast rectangular ambient shadows. */
export class WoodlandOcclusionPass extends GTAOPass {
  override render(...args: Parameters<GTAOPass['render']>): void {
    const hidden: Object3D[] = [];
    this.scene.traverse(object => {
      if (object.visible && object.userData.skipAO) {
        hidden.push(object);
        object.visible = false;
      }
    });
    // RenderPass has already refreshed this frame's shadows. The normal/depth
    // render inside GTAO must reuse them instead of rendering every caster again.
    const shadowMap = args[0].shadowMap;
    const previousAutoUpdate = shadowMap.autoUpdate;
    shadowMap.autoUpdate = false;
    try {
      super.render(...args);
    } finally {
      shadowMap.autoUpdate = previousAutoUpdate;
      for (const object of hidden) object.visible = true;
    }
  }
}
