import * as THREE from "three";
import type { HdrData } from "../assets/decode";
import { ENV_H, ENV_W, generateRoomEnv } from "../logic/roomEnv";

function prepare(t: THREE.DataTexture): THREE.DataTexture {
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Procedural room as a half-float equirect texture (row 0 = bottom → flipY false). */
function makeRoomTexture(): THREE.DataTexture {
  const f = generateRoomEnv(ENV_W, ENV_H);
  const h = new Uint16Array(f.length);
  for (let i = 0; i < f.length; i++) h[i] = THREE.DataUtils.toHalfFloat(f[i]!);
  return prepare(new THREE.DataTexture(h, ENV_W, ENV_H, THREE.RGBAFormat, THREE.HalfFloatType));
}

/** User HDR (already parsed). RGBE row 0 = top of the image ⇒ flipY. */
function makeHdrTexture(hdr: HdrData): THREE.DataTexture {
  const t = new THREE.DataTexture(
    hdr.data as Uint16Array,
    hdr.width,
    hdr.height,
    THREE.RGBAFormat,
    hdr.type as THREE.TextureDataType,
  );
  t.flipY = true;
  return prepare(t);
}

/** Holds the procedural room and an optional user HDR; `active` is what lighting and the background use. */
export class Environment {
  readonly room = makeRoomTexture();
  private hdr: THREE.DataTexture | null = null;

  /** `false` = the procedural room is used even when an HDRI asset is loaded (Environment source setting). */
  preferHdr = true;

  get active(): THREE.DataTexture {
    return this.preferHdr && this.hdr ? this.hdr : this.room;
  }

  get hasHdr(): boolean {
    return this.hdr !== null;
  }

  setHdr(data: HdrData | null): void {
    this.hdr?.dispose();
    this.hdr = data ? makeHdrTexture(data) : null;
  }

  dispose(): void {
    this.room.dispose();
    this.hdr?.dispose();
  }
}
