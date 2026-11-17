import { PORTAL_CHANNEL_PARAM } from "../graph/flatten";
import { T } from "../types/generics";
import { defineNode } from "./define";

/**
 * Structural nodes carry no shader semantics: the flatten pass removes them (resolving wires through them)
 * before IR construction. They have no `build`.
 */
export const rerouteNode = defineNode({
  id: "reroute",
  category: "Utility",
  name: "Reroute",
  description: "Pass-through knot used to tidy wires.",
  structural: true,
  inputs: [{ id: "in", name: "In", type: T("float") }],
  outputs: [{ id: "out", name: "Out", type: T("float") }],
});

const channelParam = { id: PORTAL_CHANNEL_PARAM, label: "Channel", control: "string" as const, default: "Portal" };

export const portalInNode = defineNode({
  id: "portalIn",
  category: "Utility",
  name: "Portal In",
  description: "Sends a value to every Portal Out with the same channel name.",
  structural: true,
  inputs: [{ id: "in", name: "In", type: T("float") }],
  params: [channelParam],
});

export const portalOutNode = defineNode({
  id: "portalOut",
  category: "Utility",
  name: "Portal Out",
  description: "Receives the value sent by the Portal In of the same channel.",
  structural: true,
  outputs: [{ id: "out", name: "Out", type: T("float") }],
  params: [channelParam],
});
