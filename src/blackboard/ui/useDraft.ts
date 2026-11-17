import { useState } from "react";

/**
 * Local draft for controls whose live `onChange` must not hit the graph: the store receives ONE value per gesture
 * (`onCommit`), which maps 1:1 to an undo step.
 */
export function useDraft<T>(stored: T, commit: (v: T) => void) {
  const [draft, setDraft] = useState<T | null>(null);
  return {
    value: draft ?? stored,
    onChange: (v: T) => setDraft(v),
    onCommit: (v: T) => {
      setDraft(null);
      commit(v);
    },
    onCancel: () => setDraft(null),
  };
}
