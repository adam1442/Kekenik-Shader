import * as THREE from "three";
import type { Property, TextureDefault } from "@/core";
import { loadImage } from "../assets/decode";

const COLORS: Record<TextureDefault, [number, number, number, number]> = {
  white: [255, 255, 255, 255],
  black: [0, 0, 0, 255],
  grey: [128, 128, 128, 255],
  bump: [128, 128, 255, 255],
  red: [255, 0, 0, 255],
  none: [255, 255, 255, 255],
};

const cache = new Map<TextureDefault, THREE.DataTexture>();

/** 1×1 texture for a property's default kind (shared, never disposed). */
export function defaultTexture(kind: TextureDefault | undefined): THREE.DataTexture {
  const k = kind ?? "white";
  let t = cache.get(k);
  if (!t) {
    t = new THREE.DataTexture(new Uint8Array(COLORS[k]), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    cache.set(k, t);
  }
  return t;
}

/** Decode an image Blob into a texture sampled exactly as stored (no colour-space conversion); flipY follows GL UVs. */
export async function textureFromBlob(blob: Blob, nearest: boolean): Promise<THREE.Texture> {
  const { img, url } = await loadImage(blob);
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = !nearest;
  t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  t.userData.objectUrl = url; // revoked in disposeTexture
  return t;
}

export function disposeTexture(t: THREE.Texture | null | undefined): void {
  if (!t) return;
  const u = t.userData?.objectUrl as string | undefined;
  if (u) URL.revokeObjectURL(u);
  t.dispose();
}

/** Texture the shader should sample for a texture property: bound asset texture, else its default kind. */
const textureForProperty = (p: Property, bound: THREE.Texture | undefined): THREE.Texture =>
  bound ?? defaultTexture(p.textureDefault);

const MAIN_TEX = /^_?(maintex|spritetexture|basemap|albedo)$/i;

/** The textures the preview owns: asset textures bound to properties (by property id) and the sprite (fed to `_MainTex`-like properties). */
export class TextureSet {
  readonly bound = new Map<string, THREE.Texture>();
  sprite: { tex: THREE.Texture; w: number; h: number } | null = null;

  /** Texture to sample for a property: bound asset → sprite (for `_MainTex`-style names) → the property's default kind. */
  forProperty(p: Property): THREE.Texture {
    return (
      this.bound.get(p.id) ??
      (this.sprite && MAIN_TEX.test(p.referenceName) ? this.sprite.tex : textureForProperty(p, undefined))
    );
  }

  setBound(propId: string, tex: THREE.Texture | null): void {
    const old = this.bound.get(propId);
    if (tex) this.bound.set(propId, tex);
    else this.bound.delete(propId);
    if (old && old !== tex) disposeTexture(old);
  }

  setSprite(tex: THREE.Texture | null, w = 0, h = 0): void {
    if (this.sprite) disposeTexture(this.sprite.tex);
    this.sprite = tex ? { tex, w, h } : null;
  }

  /** Nearest vs linear sampling (the pixel-art toggle). */
  applyFilters(nearest: boolean): void {
    for (const t of [...this.bound.values(), ...(this.sprite ? [this.sprite.tex] : [])]) {
      t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
      t.minFilter = nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = !nearest;
      t.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const t of this.bound.values()) disposeTexture(t);
    this.bound.clear();
    this.setSprite(null);
  }
}
