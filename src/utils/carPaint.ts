import * as THREE from 'three';

export const CAR_PAINT_MATERIAL_NAME = 'Car_Paint';

interface CarMaterialSettings {
  roughness: number;
  metalness: number;
  envMapIntensity: number;
}

function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function isColorableMaterial(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return 'color' in material && material.color instanceof THREE.Color;
}

function isPaintMaterial(material: THREE.Material): boolean {
  return material.name === CAR_PAINT_MATERIAL_NAME || material.userData?.['colorEditable'] === true;
}

function shouldApplyPaint(material: THREE.Material, paintOnly: boolean): boolean {
  return !paintOnly || isPaintMaterial(material);
}

export function carModelHasPaintMaterial(root: THREE.Object3D): boolean {
  let hasPaint = false;

  root.traverse((child) => {
    if (hasPaint || !(child instanceof THREE.Mesh)) return;
    for (const material of materialList(child.material)) {
      if (isPaintMaterial(material)) {
        hasPaint = true;
        return;
      }
    }
  });

  return hasPaint;
}

export function applyCarPaintColor(root: THREE.Object3D, color: THREE.Color): void {
  const paintOnly = carModelHasPaintMaterial(root);

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    for (const material of materialList(child.material)) {
      if (shouldApplyPaint(material, paintOnly) && isColorableMaterial(material)) {
        material.color.copy(color);
      }
    }
  });
}

export function cloneCarMaterialsForColor(
  material: THREE.Material | THREE.Material[],
  color: THREE.Color,
  paintOnly: boolean,
  settings: CarMaterialSettings,
): THREE.Material | THREE.Material[] {
  const cloneOne = (source: THREE.Material): THREE.Material => {
    const clone = source.clone();
    const standard = clone as THREE.MeshStandardMaterial;

    if (standard.map) standard.map.needsUpdate = true;
    if ('envMapIntensity' in standard) standard.envMapIntensity = settings.envMapIntensity;

    if (shouldApplyPaint(clone, paintOnly) && isColorableMaterial(clone)) {
      clone.color.copy(color);
      clone.roughness = settings.roughness;
      clone.metalness = settings.metalness;
      clone.emissive = new THREE.Color(0x111111);
      clone.emissiveIntensity = 0.3;
    }

    return clone;
  };

  return Array.isArray(material) ? material.map(cloneOne) : cloneOne(material);
}
