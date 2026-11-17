import { type Property, type PropertyValue, defaultValueFor } from "@/core";

export const toNum = (v: PropertyValue | undefined): number =>
  typeof v === "number" ? v : Array.isArray(v) ? (v[0] ?? 0) : v ? 1 : 0;

/** Normalise any stored value to `dim` numbers (colour alpha defaults to `alpha`). */
export function toVec(v: PropertyValue | undefined, dim: number, alpha = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < dim; i++)
    out.push(Array.isArray(v) ? (v[i] ?? (i === 3 ? alpha : 0)) : typeof v === "number" ? v : i === 3 ? alpha : 0);
  return out;
}

export const defaultOf = (p: Property): PropertyValue => p.default ?? defaultValueFor(p.type);

export const valuesEqual = (a: PropertyValue | undefined, b: PropertyValue | undefined): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;
