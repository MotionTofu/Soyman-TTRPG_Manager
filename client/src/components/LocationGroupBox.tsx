import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { NavIcon } from "./NavIcons";

export interface LocationGroupBoxData extends Record<string, unknown> {
  label: string;
  kind: string;
  count: number;
  branchId: number;
  collapsed: boolean;
  onToggle: (id: number) => void;
}

/** Рамка-контейнер ветки (идея «гроздья»): собирает разросшуюся ветку в один
 * визуальный блок. Не таскается, клики — только шапка; сворачивает ветку целиком. */
export const LocationGroupBox = memo(function LocationGroupBox({
  data,
}: NodeProps<Node<LocationGroupBoxData>>) {
  const d = data;
  return (
    <div className="geography-root-group">
      <div className="geography-root-group__header">
        <NavIcon name="folder" />
        <span className="geography-root-group__label" title={d.label}>
          {d.label}
        </span>
        {d.kind && <span className="geography-root-group__kind">{d.kind}</span>}
        <span className="geography-root-group__count">{d.count}</span>
        <button
          className="nodrag geography-root-group__toggle"
          title={d.collapsed ? "Развернуть ветку" : "Свернуть ветку целиком"}
          aria-label={d.collapsed ? `Развернуть ${d.label}` : `Свернуть ${d.label}`}
          aria-expanded={!d.collapsed}
          onClick={(e) => {
            e.stopPropagation();
            d.onToggle(d.branchId);
          }}
        >
          {d.collapsed ? "+" : "−"}
        </button>
      </div>
    </div>
  );
});
