import { Badge, Checkbox } from "@/ui";
import { type Graph, defaultProfileRegistry, masterEntries } from "@/core";
import { setMasterBlockVisible } from "@/ui/graph/masterActions";
import { Field, Section } from "./fields";

/** Graph Settings → Master Stack: the same add / remove (and inactive-state) model as the canvas `graph.master` context menu. */
export function MasterStackSection({ graph }: { graph: Graph }) {
  const profile = defaultProfileRegistry.get(graph.profileId);
  if (!profile || profile.masterBlocks.length === 0) return null;
  const entries = masterEntries(graph, profile);
  const contexts = [...new Set(entries.map((e) => e.context))];
  return (
    <>
      {contexts.map((context) => (
        <Section key={context} title={`Master Stack · ${context}`}>
          {entries
            .filter((e) => e.context === context)
            .map((e) => (
              <Field
                key={e.block.id}
                label={e.block.label}
                hint={
                  e.block.required
                    ? "Required block"
                    : e.active
                      ? "Optional block: add or remove it from the Master Output"
                      : "Optional block, currently inactive: its option is off in Graph Settings (the connection is kept)"
                }
              >
                <Checkbox
                  label=""
                  aria-label={`${e.block.label} block`}
                  checked={!e.hidden || e.connected}
                  disabled={e.block.required}
                  onChange={(c) => void setMasterBlockVisible(e.block.id, c)}
                />
                {e.block.required ? <Badge>required</Badge> : !e.active ? <Badge>inactive</Badge> : null}
              </Field>
            ))}
        </Section>
      ))}
    </>
  );
}
