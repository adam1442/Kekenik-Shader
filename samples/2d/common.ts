import { type Property, makeProperty } from "@/core";

/** Unity URP profile every 2D sample is authored for (Godot target = `godot.canvasitem`, reached through `switchProfile`). */
export const SPRITE_PROFILE = "unity.urp.sprite-unlit";
export const SPRITE_PROP_ID = "locked_sprite_texture";

/**
 * The profile's locked `_MainTex` property. The sample binds its own procedural sprite to it; in the Preview (2D mode) that texture is
 * what is drawn, in Unity the SpriteRenderer replaces it with the real sprite, in Godot it is the node's TEXTURE.
 */
export const spriteTexProp = (): Property =>
  makeProperty(SPRITE_PROP_ID, "Sprite Texture", "texture2D", {
    referenceName: "_MainTex", textureDefault: "white", category: "Sprite",
    tooltip: "The sprite itself. Bound automatically by the SpriteRenderer (Unity) / the node's texture (Godot); locked, not exported as a uniform.",
  });
