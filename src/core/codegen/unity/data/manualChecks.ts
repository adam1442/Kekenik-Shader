/** Manual Unity checklist ids (9a.unity.*). Every [K] fact emitted by the generator is tied to one of these. */
interface ManualCheck {
  id: string;
  title: string;
  /** What the user does in the Unity editor. */
  steps: string;
}

const MANUAL_CHECKS: readonly ManualCheck[] = [
  {
    id: "import",
    title: "Import without console errors/warnings (2022.3 and 6.3)",
    steps: "Copy each exported .shader into Assets/, wait for the import. Console must show no errors or warnings.",
  },
  {
    id: "inspector",
    title: "Material inspector shows every parameter correctly",
    steps:
      "Create a material with the shader. Check label, range slider, HDR color picker, texture slot + default, Int, Vector, toggle.",
  },
  {
    id: "srp-batcher",
    title: "Shader inspector says: SRP Batcher compatible (Unlit, Lit)",
    steps: "Select the .shader in the Project window; the inspector must say 'SRP Batcher: compatible'.",
  },
  {
    id: "lit-shadows",
    title: "Lit: main-light shadows cast + receive, additional lights",
    steps: "Test in a Forward and a Forward+ renderer. On 6.1+ confirm the _CLUSTER_LIGHT_LOOP path.",
  },
  {
    id: "soft-shadows",
    title: "Lit: soft-shadow quality levels (Unity 6.x)",
    steps: "Change the URP asset's soft shadow quality low/medium/high; shadows must change without errors.",
  },
  {
    id: "ssao-depthnormals",
    title: "SSAO with DepthNormals source does not break objects",
    steps: "Enable SSAO (Depth Normals source). Lit and Unlit objects must render and occlude normally.",
  },
  {
    id: "depth-priming",
    title: "Depth Priming enabled => objects visible",
    steps: "Enable Depth Priming in the renderer; objects must remain visible and correctly depth tested.",
  },
  {
    id: "keywords",
    title: "Keyword toggle / KeywordEnum switch variants",
    steps:
      "Graph with a Boolean keyword, an Enum keyword and a keyword-flagged Bool property: the material inspector shows a checkbox / dropdown, toggling it switches the look (variants compile, no console warnings). [Toggle(KW)] / [KeywordEnum] on a property whose name equals the keyword, and the macro-folded read (KS_KW_*), are [K]. Static keywords stay baked.",
  },
  {
    id: "render-state-props",
    title: "Exposed Cull / ZWrite / ZTest properties work",
    steps:
      "Enable 'Expose in Material' for Cull, ZWrite, ZTest; change them in the material inspector; rendering must follow.",
  },
  {
    id: "sprite-2d",
    title: "Sprite Unlit/Lit with the 2D Renderer, Light2D and normal map",
    steps: "Use a 2D Renderer asset. Sprite Lit must react to Light2D and the normal map.",
  },
  {
    id: "sprite-universal",
    title: "Sprite with the Universal Renderer shows the unlit fallback",
    steps: "Use the Universal Renderer; the sprite must be visible (UniversalForward pass).",
  },
  {
    id: "particles",
    title: "Particles: Alpha / Additive / Premultiply / Multiply, soft particles",
    steps:
      "Check each blend mode. Soft particles need Depth Texture enabled in the URP asset. Vertex stream order must match the header.",
  },
  {
    id: "no-pink",
    title: "No pink / fallback material anywhere",
    steps: "No object using the shaders may render magenta.",
  },
  {
    id: "unverified-api",
    title: "Unverified [K] API names compile",
    steps:
      "The import in 'import' covers it: every identifier tagged unverified-by-doc in docs/EXPORT_TARGETS.md must compile on both versions.",
  },
  {
    id: "sampler-state",
    title: "Inline sampler states (filter/wrap override) compile",
    steps: "Use a Sample Texture node with an explicit filter/wrap and confirm the import.",
  },
  {
    id: "vertex-lod",
    title: "Texture sampling in the vertex stage (SAMPLE_TEXTURE2D_LOD)",
    steps: "Use a texture-driven vertex displacement; the shader must compile and displace.",
  },
  {
    id: "alpha-clip",
    title: "Alpha clip is identical in all passes",
    steps: "Cutout shader: shadows and depth-priming must show the same cut-out as the color pass.",
  },
  {
    id: "double-sided",
    title: "Double-sided normals (Flip / Mirror)",
    steps: "Cull Off + Flip: back faces lit like front faces.",
  },
  {
    id: "lit-normal-map",
    title: "Lit: tangent-space normal map lights correctly; DepthNormals agrees",
    steps:
      "Lit shader with a Normal From Texture graph: bumps must light like a Unity Lit material; SSAO (Depth Normals source) must not show seams or inverted bumps.",
  },
  {
    id: "sprite-secondary",
    title: "Sprite Lit: secondary textures _NormalMap / _MaskTex are bound by the SpriteRenderer",
    steps:
      "Assign Secondary Textures named _NormalMap and _MaskTex in the Sprite Editor; the sprite must be lit with that normal map and mask.",
  },
  {
    id: "simple-lit",
    title: "Simple Lit profile: Blinn-Phong via UniversalFragmentBlinnPhong compiles and lights like URP/Simple Lit",
    steps:
      "Export a graph with the 'Unity URP · Simple Lit (mobile)' profile (baseColor + specular + smoothness). Import on 2022.3 and 6.3: no console errors; a specular highlight appears on a sphere under a directional light; turning Specular Highlights off in Surface Options removes it (the shader then has no #define _SPECULAR_COLOR). Compare the highlight with a stock URP/Simple Lit material.",
  },
  {
    id: "light-cost-options",
    title: "Lit / Simple Lit cost options remove variants without breaking lighting (O11)",
    steps:
      "Set Additional Lights = Off / Per-Vertex / Per-Pixel, Receive Shadows off, Soft Shadows off and Ambient SH per Vertex in turn. After each export: shader compiles; Off shows only the main light, Per-Vertex shows smooth (coarser) point-light shading, Receive Shadows off shows no shadows on the object; Soft Shadows off gives hard shadow edges; SH per vertex changes ambient only slightly. Check Inspector → 'Compiled variants' (Show/Compile and show code) is lower than with the defaults.",
  },
  {
    id: "sprite-lit-63",
    title: "Sprite Lit compiles on 6.3 (URP 17.x 2D includes)",
    steps: "Import the Sprite Lit shader on 6.3 with the 2D Renderer.",
  },
  // ── Everything below is generated from URP source reading, never compiled in Unity ──
  {
    id: "surface-options",
    title:
      "Runtime surface options (Expose surface options) drive blend / ZWrite / Cull / alpha clip in the material (E3)",
    steps:
      "Sprite / VFX profiles have it on by default. Import the shader; the material inspector shows Src Blend, Dst Blend, ZWrite, Cull (and Alpha Clip + Alpha Clip Threshold when the profile has them). Change Src/Dst Blend (e.g. 1/1 additive), ZWrite and Cull: rendering follows. Toggle Alpha Clip: cut-out appears in the colour AND shadow/depth passes. Check the shader inspector for SRP Batcher status (Unlit/Lit) and that hidden _Surface/_Blend cause no warnings.",
  },
  {
    id: "lit-gi",
    title: "Lit: baked GI — lightmaps, light probes, shadow mask, mixed lighting (E1)",
    steps:
      "Lit + 'Baked GI' on. Import on 2022.3 and 6.3. Mark a mesh Contribute GI / Receive GI = Lightmaps (mesh needs UV2), bake with Lighting > Generate; the object must show baked light (also with DIRLIGHTMAP_COMBINED = directional lightmaps on). Light probes: Receive GI = Light Probes. Shadow mask: Mixed light in Shadowmask mode. No console errors. Check variant count in Inspector > Compiled variants (adds ×16 to ForwardLit).",
  },
  {
    id: "lit-meta",
    title: "Lit: Meta pass lets Unity bake albedo / emission (E1)",
    steps:
      "Lit + 'Meta pass' on, 'Baked GI' on. Bake a scene where a bright-coloured wall made with this shader sits next to a white object: colour bleeding on the white object proves the Meta pass. An emissive material must light neighbours after the bake. Scene-view Albedo / Emissive debug draw modes are NOT supported (EDITOR_VISUALIZATION not compiled).",
  },
  {
    id: "lit-motion-vectors",
    title: "Lit: MotionVectors pass (Unity 6 only) (E1)",
    steps:
      "Lit + 'Motion Vectors pass' on, Unity 6.x. Enable Motion Blur or TAA in the Volume/camera and move the object: blur / stable TAA must follow the object (Rendering Debugger > Motion Vectors if available). On 2022.3 the option must be ignored with a warning in the Problems panel and the pass absent.",
  },
  {
    id: "lit-decals",
    title: "Lit: DBuffer decals (E1)",
    steps:
      "Lit + 'DBuffer decals' on. Enable the Decal Renderer Feature with technique DBuffer, place a Decal Projector over the object: the decal must appear on the surface. No console errors on 2022.3 and 6.3.",
  },
  {
    id: "lit-lod-crossfade",
    title: "Lit: LOD cross-fade (E1)",
    steps:
      "Lit + 'LOD cross-fade' on. Put the mesh in a LOD Group with Fade Mode = Cross Fade and move the camera: dithered cross-fade in the transition, in colour, shadows and depth.",
  },
  {
    id: "instance-id",
    title: "Instance ID node reads unity_InstanceID in instancing variants (E1)",
    steps:
      "Unlit/Lit graph using the Instance ID node in the vertex stage (e.g. offset position by id * 0.1). Draw 10 objects with the same material and GPU Instancing enabled (or via Graphics.DrawMeshInstanced): each instance must get its own id. With instancing disabled the id is 0 and nothing breaks.",
  },
  {
    id: "texture-params",
    title: "Texture parameters in functions use TEXTURE2D_PARAM / TEXTURE2D_ARGS (E4)",
    steps:
      "Use a graph whose Custom Function / Subgraph takes a Texture 2D input and samples it. Import: no errors on 2022.3 and 6.3; the sampled result matches the Preview. Check on a GLES3/Vulkan build target that it still compiles.",
  },
  {
    id: "vfx-flipbook",
    title: "VFX: flipbook with frame blending through custom vertex streams (E2)",
    steps:
      "VFX profile + 'Flipbook frame blending'. Particle System: Texture Sheet Animation (e.g. 4x4), Renderer > Custom Vertex Streams: add exactly the streams in the shader header (Position, Color, UV, UV2, AnimBlend). Frames must cross-fade smoothly. If Unity shows other TEXCOORD semantics than the header, report them: the stream packing is [verify].",
  },
  {
    id: "vfx-camera-fade",
    title: "VFX: camera near / far fade (E2)",
    steps:
      "VFX profile + 'Camera fade'. Move the camera through a particle system: alpha fades from 0 at _CameraNearFadeDistance to 1 at _CameraFarFadeDistance.",
  },
  {
    id: "vfx-distortion",
    title: "VFX: distortion through the opaque texture (E2)",
    steps:
      "VFX profile + 'Distortion', Alpha blend. Enable Opaque Texture in the URP asset. Behind a particle whose Base Color R,G come from a normal-like texture the scene must be refracted (heat haze); alpha 0 = no effect. _DistortionStrength scales it.",
  },
  {
    id: "scene-intrinsics",
    title: "Scene Depth / Scene Color / Scene Normals / additional-light nodes compile and sample (fix after 10e-1)",
    steps:
      "Graph with a Scene Depth node (Raw / Linear01 / Eye) on an Unlit transparent and a Lit shader: it must import without errors. Enable Depth Texture in the URP asset: the value changes with the geometry behind the object. Repeat with Scene Color (Opaque Texture on) and Scene Normals (SSAO Depth-Normals source / a Renderer Feature requesting Normal). Additional-light nodes need Additional Lights = Per Pixel.",
  },
  {
    id: "texture-kinds",
    title: "Texture2DArray / Texture3D / Cubemap properties and sample nodes (E9)",
    steps:
      "Graph with a Texture 2D Array, a Texture 3D and a Cubemap property, each sampled by its Sample node (and the 3-D LUT node). The shader must import with no errors; the material inspector shows an array / 3D / cube slot per property (no Tiling/Offset); assign a Texture2DArray / Texture3D / Cubemap asset and the result matches the Preview. In a function / subgraph with a texture-kind input the TEXTURE*_PARAM / _ARGS macros must compile.",
  },
  {
    id: "sprite-rect",
    title: "Sprite Rect node + KekenikSpriteRect.cs (E5)",
    steps:
      "Graph with a Sprite Rect node on a Sprite profile; export the bundle and copy the .shader AND KekenikSpriteRect.cs. Add the component to a SpriteRenderer using a sprite from an atlas: Local UV output must run 0..1 over the sprite only. Without the component the node returns the full texture. Check the SpriteRenderer still shows its sprite (MaterialPropertyBlock co-existence).",
  },
];
export const MANUAL_CHECK_IDS: ReadonlySet<string> = new Set(MANUAL_CHECKS.map((m) => m.id));
