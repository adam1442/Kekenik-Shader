# Kekenik Shader — User Guide

Welcome to **Kekenik Shader**! This short guide walks through creating your first shader graph, exposing material parameters, previewing on 3D/2D/VFX assets, and exporting to your game engine.

---

## 1. Your First Shader Graph

1. **Choose a Starting Point:**
   - When the app opens, use the **Welcome** dialog to pick a starter template (*Unlit*, *Lit PBR*, *2D Sprite*, *VFX Particles*, or *Stylized Toon* for Unity URP or Godot 4), or browse the **Samples** panel to open one of the 39 showcase shaders.
   - You can change your target engine and profile at any time in **Inspector → Graph → Target Profile** (or from the top toolbar's Target selector).
2. **Add Nodes (`Space`):**
   - Press **`Space`** (tap) anywhere over the node canvas to open the fuzzy **Add Node** search popup.
   - Type a node name, synonym, or math operation (e.g., `fresnel`, `simplex`, `lerp`, `mix`, `voronoi`, `sample`) and press `Enter`.
   - You can also press single-key quick shortcuts directly over the canvas: `1` (Float), `2` (Vector2), `3` (Vector3), `4` (Vector4), `C` (Color), `M` (Multiply), `A` (Add), `U` (UV), `T` (Time), `L` (Lerp), `S` (Sample Texture 2D), `P` (Property).
3. **Wire Ports Together:**
   - Drag from an output port (right side of a node) to an input port (left side of another node or the **Master Output** stack).
   - Release a wire on empty canvas to immediately search for compatible nodes and auto-connect the new node.
   - Drop a node onto an existing wire to splice it inline, or double-click a wire to insert a **Reroute** knot.

---

## 2. Exposing Material Parameters (Blackboard)

Parameters added in the **Blackboard** panel become material inspector properties in Unity URP and Godot 4:

1. Click **`+`** in the **Blackboard** panel and choose a property type (`Float`, `Int`, `Bool`, `Vector2/3/4`, `Color`, `Color (RGBA)`, or `Texture 2D`) or a Keyword (`Boolean Keyword`, `Enum Keyword`).
2. Select the property to edit its metadata in the **Inspector**:
   - **Display Name** & **Reference Name** (e.g., `_BaseColor` — automatically adapted per target: `_BaseColor` in Unity, `base_color` in Godot/WGSL, `u_Base_Color` in GLSL/HLSL).
   - **Range & Slider** (`Min`, `Max`, `Step`) for numeric parameters.
   - **HDR** toggle for emissive colors (`[HDR]` in Unity; base color + intensity uniform pair in Godot).
   - **Texture Default** (`White`, `Black`, `Gray`, `Bump` normal map) for `Texture 2D` slots.
   - **Category** (creates inspector headers / `group_uniforms` in Godot).
3. Drag the property from the Blackboard onto the canvas (or right-click any unconnected node input port and choose **Promote to Property**).
4. Open the **Material** panel to test tweaking your exposed sliders, colors, and textures without altering the graph's default values.

---

## 3. Organizing Complex Graphs

- **Groups (`Ctrl/Cmd+G`):** Select nodes and press `Ctrl/Cmd+G` to wrap them in a titled, color-coded group frame. Click the chevron in the group header to **collapse** the group into a compact node with proxy ports along its border.
- **Wireless Portals:** Right-click a wire and choose **Convert Wire to Portals** (or spawn `Portal In` and `Portal Out` nodes) to transmit signals across large graphs without long crossing wires. Hovering or selecting a portal highlights its wireless links.
- **Subgraphs:** Select a reusable node cluster, right-click, and choose **Convert to Subgraph**. Edit its inputs and outputs in **Inspector → Subgraph**, or export it as a `.kshadersub` file from the **Subgraphs** panel.
- **Comments (`C`):** Press `C` on the canvas to drop a Markdown sticky note.

---

## 4. Live 3D, 2D Sprite & VFX Preview

- **Switch Preview Modes:** Use the **Preview** toolbar to switch between **3D Mesh** (Sphere, Rounded Cube, Torus, Shaderball, Quad, Cylinder, or custom imported `.glb`/`.gltf`/`.obj`/`.fbx`), **2D Sprite** (with optional sprite-sheet slicing and frame animation), and **VFX Particles** (billboard particle emitter).
- **Custom Assets:** Drag `.glb`, `.obj`, `.fbx`, `.png`, `.jpg`, `.webp`, or `.hdr` files from your computer into the **Assets** panel, onto the **Preview** viewport, or directly onto the node canvas.
- **Lighting & Post-Processing:** Adjust studio lights (or `Alt+drag` in the viewport to rotate the key light), toggle shadows, enable **Bloom** and **Tone Mapping**, or switch the **Shading View** dropdown to inspect *Normals*, *UV Checker*, *Metallic*, *Smoothness*, *Emission*, or *Scene Depth*.

---

## 5. Inspecting Code, Optimizing & Exporting

- **Live Code Output:** Open the **Code Output** panel to view real-time generated **GLSL**, **WGSL**, **HLSL**, **Unity URP**, or **Godot 4** code side-by-side. Clicking a line highlights the originating node on the canvas.
- **Cost Heatmap & Baking:** Toggle the **Heatmap** in the toolbar or open the **Statistics** panel to inspect instruction costs and optimization hints. Use **Graph → Bake Texture…** to bake expensive procedural branches into a PNG texture.
- **Export (`Ctrl/Cmd+E`):** Choose **File → Export Shader…** (`Ctrl/Cmd+E`), select your target engines, preview every generated file, and click **Export zip** to download a ready-to-import archive containing your shaders, `parameters.json`, and setup instructions.
