import { PROPERTY_TYPES } from "../properties/model";
import { edgeId } from "../graph/types";

/** Light structural validation of a `.kshader` v1 document; returns readable messages with JSON paths. */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

class Checker {
  errors: string[] = [];
  err(path: string, msg: string): void {
    if (this.errors.length < 50) this.errors.push(`${path}: ${msg}`);
  }
  obj(path: string, v: unknown): v is Obj {
    if (!isObj(v)) this.err(path, `expected an object, got ${Array.isArray(v) ? "array" : typeof v}`);
    return isObj(v);
  }
  arr(path: string, v: unknown): v is unknown[] {
    if (!Array.isArray(v)) this.err(path, `expected an array, got ${typeof v}`);
    return Array.isArray(v);
  }
  str(path: string, v: unknown, optional = false): void {
    if (optional && v === undefined) return;
    if (typeof v !== "string") this.err(path, `expected a string, got ${typeof v}`);
  }
  num(path: string, v: unknown): void {
    if (typeof v !== "number" || !Number.isFinite(v))
      this.err(path, `expected a finite number, got ${JSON.stringify(v)}`);
  }
  bool(path: string, v: unknown, optional = false): void {
    if (optional && v === undefined) return;
    if (typeof v !== "boolean") this.err(path, `expected a boolean, got ${typeof v}`);
  }
}

function checkPort(c: Checker, path: string, v: unknown, nodes: Obj): void {
  if (!c.obj(path, v)) return;
  c.str(`${path}.node`, v.node);
  c.str(`${path}.port`, v.port);
  if (typeof v.node === "string" && !(v.node in nodes)) c.err(`${path}.node`, `references missing node "${v.node}"`);
}

function checkBody(c: Checker, path: string, body: Obj): void {
  const nodes = isObj(body.nodes) ? body.nodes : {};
  if (c.obj(`${path}.nodes`, body.nodes)) {
    for (const [key, n] of Object.entries(body.nodes)) {
      const p = `${path}.nodes.${key}`;
      if (!c.obj(p, n)) continue;
      c.str(`${p}.id`, n.id);
      if (typeof n.id === "string" && n.id !== key) c.err(`${p}.id`, `"${n.id}" does not match its key "${key}"`);
      c.str(`${p}.defId`, n.defId);
      if (c.obj(`${p}.position`, n.position)) {
        c.num(`${p}.position.x`, n.position.x);
        c.num(`${p}.position.y`, n.position.y);
      }
      if (n.values !== undefined) c.obj(`${p}.values`, n.values);
      if (n.params !== undefined) c.obj(`${p}.params`, n.params);
      c.bool(`${p}.previewEnabled`, n.previewEnabled, true);
      c.bool(`${p}.collapsed`, n.collapsed, true);
      c.str(`${p}.label`, n.label, true);
      c.str(`${p}.color`, n.color, true);
    }
  }
  if (c.obj(`${path}.edges`, body.edges)) {
    for (const [key, e] of Object.entries(body.edges)) {
      const p = `${path}.edges.${key}`;
      if (!c.obj(p, e)) continue;
      checkPort(c, `${p}.from`, e.from, nodes);
      checkPort(c, `${p}.to`, e.to, nodes);
      if (isObj(e.from) && isObj(e.to) && typeof e.from.node === "string" && typeof e.to.node === "string") {
        const want = edgeId(
          { node: e.from.node, port: String(e.from.port) },
          { node: e.to.node, port: String(e.to.port) },
        );
        if (e.id !== want || key !== want) c.err(`${p}.id`, `edge id must be "${want}"`);
      }
    }
  }
}

export function validateDocument(doc: unknown): string[] {
  const c = new Checker();
  if (!c.obj("$", doc)) return c.errors;
  if (doc.format !== "kshader") c.err("$.format", `expected "kshader", got ${JSON.stringify(doc.format)}`);
  if (!c.obj("$.graph", doc.graph)) return c.errors;
  const g = doc.graph;
  c.str("$.graph.id", g.id);
  c.str("$.graph.name", g.name);
  c.str("$.graph.profileId", g.profileId);
  checkBody(c, "$.graph", g);

  const ids = new Set<string>();
  const list = (key: string, check: (p: string, v: Obj) => void) => {
    if (g[key] === undefined) return;
    if (!c.arr(`$.graph.${key}`, g[key])) return;
    (g[key] as unknown[]).forEach((item, i) => {
      const p = `$.graph.${key}[${i}]`;
      if (c.obj(p, item)) check(p, item);
    });
  };
  list("properties", (p, v) => {
    c.str(`${p}.id`, v.id);
    c.str(`${p}.displayName`, v.displayName);
    c.str(`${p}.referenceName`, v.referenceName);
    if (!(PROPERTY_TYPES as readonly unknown[]).includes(v.type))
      c.err(`${p}.type`, `unknown property type ${JSON.stringify(v.type)}`);
    c.bool(`${p}.exposed`, v.exposed);
    c.bool(`${p}.perInstance`, v.perInstance);
    if (typeof v.id === "string") {
      if (ids.has(v.id)) c.err(`${p}.id`, `duplicate property id "${v.id}"`);
      ids.add(v.id);
    }
  });
  list("keywords", (p, v) => {
    c.str(`${p}.id`, v.id);
    c.str(`${p}.referenceName`, v.referenceName);
  });
  list("groups", (p, v) => {
    c.str(`${p}.id`, v.id);
    c.str(`${p}.title`, v.title);
    c.arr(`${p}.nodeIds`, v.nodeIds);
    if (v.collapsed !== undefined) c.bool(`${p}.collapsed`, v.collapsed);
  });
  list("comments", (p, v) => {
    c.str(`${p}.id`, v.id);
    c.str(`${p}.text`, v.text);
    if (c.obj(`${p}.position`, v.position)) {
      c.num(`${p}.position.x`, v.position.x);
      c.num(`${p}.position.y`, v.position.y);
    }
    if (c.obj(`${p}.size`, v.size)) {
      c.num(`${p}.size.w`, v.size.w);
      c.num(`${p}.size.h`, v.size.h);
    }
  });
  if (g.settings !== undefined) c.obj("$.graph.settings", g.settings);
  if (g.subgraphDefs !== undefined && c.obj("$.graph.subgraphDefs", g.subgraphDefs)) {
    for (const [key, d] of Object.entries(g.subgraphDefs)) {
      const p = `$.graph.subgraphDefs.${key}`;
      if (!c.obj(p, d)) continue;
      c.str(`${p}.id`, d.id);
      c.str(`${p}.name`, d.name);
      if (c.arr(`${p}.inputs`, d.inputs))
        d.inputs.forEach((x, i) =>
          isObj(x)
            ? (c.str(`${p}.inputs[${i}].id`, x.id), c.str(`${p}.inputs[${i}].type`, x.type))
            : c.err(`${p}.inputs[${i}]`, "expected an object"),
        );
      if (c.arr(`${p}.outputs`, d.outputs))
        d.outputs.forEach((x, i) =>
          isObj(x)
            ? (c.str(`${p}.outputs[${i}].id`, x.id), c.str(`${p}.outputs[${i}].type`, x.type))
            : c.err(`${p}.outputs[${i}]`, "expected an object"),
        );
      checkBody(c, p, d);
    }
  }
  return c.errors;
}
