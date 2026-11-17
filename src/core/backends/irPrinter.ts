import type { Backend } from "../compile/backend";
import { printModule } from "../ir/printer";
import { BACKEND_TRAITS } from "../ir/traits";

/** Text IR backend — proves the pipeline end to end and doubles as a debugging view. */
export const irPrinterBackend: Backend = {
  id: "ir",
  traits: BACKEND_TRAITS.ir,
  emit(module, profile) {
    const header = `; Kekenik Shader — IR dump (profile: ${profile.name})\n`;
    return { files: [{ path: "shader.kir", content: header + printModule(module), language: "ir" }], diagnostics: [] };
  },
};
