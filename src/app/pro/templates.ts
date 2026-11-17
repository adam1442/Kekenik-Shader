import { type TemplateEngine, buildTemplate } from "@/core";
import { toast } from "@/ui";
import { openDoc } from "@/ui/graph/graphStore";

/** Open a new graph built from a template (Unity URP or Godot 4 flavour). Unmappable pieces are reported in a toast. Returns the new document id. */
export function openTemplate(id: string, engine: TemplateEngine = "unity"): string | null {
  try {
    const { graph, problems } = buildTemplate(id, engine);
    const doc = openDoc(graph, { fit: true });
    if (problems.length)
      toast.show({
        title: `Template adapted for ${engine === "godot" ? "Godot" : "Unity"}`,
        description: `${problems.length} note${problems.length === 1 ? "" : "s"}: ${problems[0]}`,
        kind: "warning",
      });
    return doc;
  } catch (e) {
    toast.show({ title: "Could not create the template", description: (e as Error).message, kind: "danger" });
    return null;
  }
}

/** Short onboarding tips shown on the Welcome screen (rotating by day) and in Help. */
export const TIPS: readonly string[] = [
  "Press Space (or double-click the canvas) to search every node; press 1, 3, M, A… to drop a Float, Vector 3, Multiply or Add under the cursor.",
  "Click the “+” that appears when you hover a port to add a node that is already wired to it.",
  "Hold Shift and drag from a connected output port to move all of its wires to another output at once.",
  "Drag an image from Assets onto the canvas: you get a Texture property and a Sample Texture 2D node, already bound in the preview.",
  "Right-click an unconnected input → “Promote to Property” to expose it in the material inspector.",
  "Edit → Auto Layout arranges the whole graph (or the selection) left → right in one undo step.",
  "The Stats panel estimates ALU / texture / interpolator cost and points at expensive nodes (click a hint to select them).",
  "Autosave keeps local snapshots: File → Snapshot History restores any earlier version into a new tab.",
  "Ctrl/Cmd+E exports every target (Unity URP, Godot, GLSL, HLSL, WGSL) with a parameters.json for your engine.",
];
export const tipOfTheDay = (d: Date = new Date()): string => TIPS[Math.floor(d.getTime() / 86_400_000) % TIPS.length]!;
