import { AlertTriangle, Check, XCircle } from "lucide-react";
import { type NameCheck, TARGET_LABEL } from "@/core";

/** Per-target result of the reference-name validation: the spelling each engine will receive + a status icon + the reasons. */
export function NameChecks({ check }: { check: NameCheck }) {
  return (
    <div className="kk-bb-names" data-testid="name-checks" data-status={check.status}>
      {check.targets.map((t) => {
        const Icon = t.status === "error" ? XCircle : t.status === "warn" ? AlertTriangle : Check;
        return (
          <div
            key={t.target}
            className="kk-bb-names__row"
            data-target={t.target}
            data-status={t.status}
            title={t.issues.join("\n") || "OK"}
          >
            <Icon size={12} />
            <span className="kk-bb-names__t">{TARGET_LABEL[t.target]}</span>
            <code className="kk-bb-names__n">{t.derived}</code>
          </div>
        );
      })}
      {check.targets.flatMap((t) => t.issues).length > 0 && (
        <ul className="kk-bb-names__issues">
          {[...new Set(check.targets.flatMap((t) => t.issues))].map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
