import defaultPetPackage from "../../assets/pets/default/pet.json";
import type {
  AnimationKey,
  PetPackageManifest,
  PetPackageValidation
} from "../types/pet-package";

export const REQUIRED_ANIMATIONS: AnimationKey[] = [
  "idle",
  "walk_left",
  "walk_right",
  "sit",
  "sit_idle",
  "sleep",
  "stretch",
  "groom",
  "eat",
  "drag",
  "fall"
];

export class PetPackageLoader {
  async loadDefault(): Promise<PetPackageManifest> {
    const manifest = defaultPetPackage as PetPackageManifest;
    const validation = this.validate(manifest);

    if (!validation.ok) {
      console.warn("Pet package is missing animations", validation.missingAnimations);
    }

    return manifest;
  }

  validate(manifest: PetPackageManifest): PetPackageValidation {
    const missingAnimations = REQUIRED_ANIMATIONS.filter(
      (animation) => !manifest.animations[animation]
    );

    return {
      ok: missingAnimations.length === 0,
      missingAnimations
    };
  }
}
