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
    try {
      super.render(...args);
    } finally {
      for (const object of hidden) object.visible = true;
    }
  }
}
