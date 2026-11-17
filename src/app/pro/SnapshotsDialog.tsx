import { useCallback, useEffect, useState } from "react";
import { Camera, RotateCcw, Trash2 } from "lucide-react";
import { parseKShader, serializeGraph } from "@/core";
import { Badge, Button, EmptyState, IconButton, Modal, ScrollArea, toast } from "@/ui";
import { getRootDoc, openDoc } from "@/ui/graph/graphStore";
import { type Snapshot, snapshots } from "@/app/project/snapshotStore";
import { useProUi } from "./proState";

/** Take a manual snapshot of the active graph (local history). */
export async function takeSnapshot(label = "Manual snapshot"): Promise<boolean> {
  const d = getRootDoc();
  if (!d) return false;
  const s = await snapshots.add(
    d.graph.name || "Untitled",
    label,
    serializeGraph(d.graph),
    Object.keys(d.graph.nodes).length,
  );
  toast.show({ title: s ? "Snapshot saved" : "Nothing changed since the last snapshot", kind: s ? "success" : "info" });
  return !!s;
}

/** Restore = open the snapshot in a NEW tab (never overwrites the current graph). */
function restoreSnapshot(s: Snapshot): boolean {
  try {
    openDoc(parseKShader(s.text).graph, { fit: true });
    return true;
  } catch (e) {
    toast.show({ title: "Could not restore", description: (e as Error).message, kind: "danger" });
    return false;
  }
}

/** Local snapshot history of the active project. */
export function SnapshotsDialog() {
  const open = useProUi((s) => s.snapshotsOpen);
  const close = () => useProUi.getState().set({ snapshotsOpen: false });
  const [list, setList] = useState<Snapshot[]>([]);
  const project = getRootDoc()?.graph.name || "Untitled";
  const refresh = useCallback(
    () => void snapshots.list(open ? getRootDoc()?.graph.name || "Untitled" : undefined).then(setList),
    [open],
  );
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);
  return (
    <Modal
      open={open}
      onClose={close}
      title={`Snapshot history — ${project}`}
      width={560}
      footer={
        <>
          <Button icon={Camera} onClick={() => void takeSnapshot().then(refresh)}>
            Snapshot now
          </Button>
          <Button variant="primary" onClick={close}>
            Close
          </Button>
        </>
      }
    >
      <div className="kk-pro" style={{ padding: 0 }} data-kk="snapshots">
        {list.length === 0 ? (
          <EmptyState
            title="No snapshots yet"
            description="Autosave and every save add a snapshot; you can also take one manually."
          />
        ) : (
          <ScrollArea style={{ maxHeight: 320 }}>
            {list.map((s) => (
              <div
                key={s.id}
                className="kk-pro__row"
                style={{ gridTemplateColumns: "1fr auto auto auto" }}
                data-snapshot={s.id}
              >
                <span>
                  {new Date(s.time).toLocaleString()} <Badge>{s.label}</Badge>{" "}
                  <span className="kk-pro__muted">{s.nodes} nodes</span>
                </span>
                <span />
                <IconButton
                  icon={RotateCcw}
                  size="sm"
                  label="Restore in a new tab"
                  onClick={() => {
                    if (restoreSnapshot(s)) close();
                  }}
                />
                <IconButton
                  icon={Trash2}
                  size="sm"
                  label="Delete snapshot"
                  onClick={() => void snapshots.remove(s.id).then(refresh)}
                />
              </div>
            ))}
          </ScrollArea>
        )}
        <div className="kk-pro__muted">
          Snapshots live in this browser (IndexedDB, or memory when storage is blocked). Keep a .kshader file for
          anything important.
        </div>
      </div>
    </Modal>
  );
}
