import { Eye, EyeOff, Star, Copy } from "lucide-react";
import { copyText } from "@/ui/controls/clipboard";
import { problemsText } from "@/ui/graph/panels/ProblemsPanel";
import { useNodePrefs } from "@/ui/graph/prefs";
import { useGraphs } from "@/ui/graph/graphStore";
import { registerPanelExtras } from "../contextmenu/panelExtras";

/** Body-menu extras of the library and problems panels (real actions only). */
export function registerGraphPanelExtras(): void {
  registerPanelExtras("library", () => {
    const p = useNodePrefs.getState();
    return [
      { label: "Collapse All Categories", run: () => p.collapseAll() },
      {
        label: "Show Favorites Only",
        icon: p.favoritesOnly ? Eye : EyeOff,
        type: "checkbox",
        checked: p.favoritesOnly,
        run: () => p.setFavoritesOnly(!p.favoritesOnly),
      },
      { label: `${p.favorites.length} favorite(s)`, icon: Star, disabled: true },
    ];
  });
  registerPanelExtras("problems", () => {
    const list = useGraphs.getState().analysis?.diagnostics ?? [];
    return [
      {
        label: "Copy Problems",
        icon: Copy,
        disabled: list.length === 0,
        disabledReason: "No problems to copy",
        run: () => void copyText(problemsText(list)),
      },
    ];
  });
}
