import type { StorageType } from "../../types/shaderType";

/** One placed member of a constant / uniform block. */
interface PlacedMember {
  name: string;
  ty: StorageType;
  offset: number;
  size: number;
}

export interface BlockLayout {
  members: PlacedMember[];
  /** Total byte size (struct size rounded up to its alignment for WGSL; to a 16-byte register for HLSL). */
  size: number;
}

const scalarish = (ty: StorageType): number =>
  ty === "float" || ty === "int" || ty === "bool" ? 1 : ty === "vec2" ? 2 : ty === "vec3" ? 3 : ty === "vec4" ? 4 : 0;
const matN = (ty: StorageType): number => (ty === "mat2" ? 2 : ty === "mat3" ? 3 : ty === "mat4" ? 4 : 0);
const roundUp = (n: number, a: number): number => Math.ceil(n / a) * a;

/**
 * WGSL `uniform` address-space layout (WGSL spec §14.4.4) for f32 / i32 / u32 members (bool is stored as u32):
 * scalar 4/4, vec2 8/8, vec3 size 12 **align 16**, vec4 16/16, mat2x2<f32> 16/8, mat3x3<f32> 48/16, mat4x4<f32> 64/16.
 * Members are placed at the next multiple of their alignment; the block is padded to the largest alignment.
 */
function wgslMemberInfo(ty: StorageType): { size: number; align: number } {
  const n = scalarish(ty);
  if (n === 1) return { size: 4, align: 4 };
  if (n === 2) return { size: 8, align: 8 };
  if (n === 3) return { size: 12, align: 16 };
  if (n === 4) return { size: 16, align: 16 };
  const m = matN(ty);
  if (m === 2) return { size: 16, align: 8 };
  if (m === 3) return { size: 48, align: 16 };
  if (m === 4) return { size: 64, align: 16 };
  throw new Error(`Type ${ty} cannot live in a WGSL uniform block`);
}

export function layoutWgsl(members: ReadonlyArray<{ name: string; ty: StorageType }>): BlockLayout {
  let offset = 0;
  let maxAlign = 4;
  const placed = members.map((m): PlacedMember => {
    const { size, align } = wgslMemberInfo(m.ty);
    offset = roundUp(offset, align);
    const p = { name: m.name, ty: m.ty, offset, size };
    offset += size;
    maxAlign = Math.max(maxAlign, align);
    return p;
  });
  return { members: placed, size: roundUp(offset, maxAlign) };
}

/**
 * HLSL `cbuffer` packing: members are packed into 16-byte registers in declaration order and a member never straddles a
 * register boundary; matrices start on a register boundary and take one register per column (column-major packing, the
 * HLSL default, which we also pin with `#pragma pack_matrix(column_major)`): mat2 = 24 bytes, mat3 = 44, mat4 = 64.
 * The following member may use the unused tail of a matrix's last register.
 */
export function layoutHlsl(members: ReadonlyArray<{ name: string; ty: StorageType }>): BlockLayout {
  let offset = 0;
  const placed = members.map((m): PlacedMember => {
    const n = scalarish(m.ty);
    const mat = matN(m.ty);
    let size: number;
    if (n > 0) {
      size = n * 4;
      if (Math.floor(offset / 16) !== Math.floor((offset + size - 1) / 16)) offset = roundUp(offset, 16);
    } else if (mat > 0) {
      offset = roundUp(offset, 16);
      size = (mat - 1) * 16 + mat * 4;
    } else throw new Error(`Type ${m.ty} cannot live in an HLSL constant buffer`);
    const p = { name: m.name, ty: m.ty, offset, size };
    offset += size;
    return p;
  });
  return { members: placed, size: roundUp(offset, 16) };
}
