import { memo } from "react";
import { Link } from "react-router-dom";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { NavIcon } from "./NavIcons";
import { ROOT_NODE_W } from "../geographyRootLayout";

export interface LocationRootNodeData extends Record<string, unknown> {
  locationId: number;
  name: string;
  kind: string;
  childCount: number;
  collapsed: boolean;
  hasMap: boolean;
  /** Совпадение с поисковым запросом — координатная отметка, не акцент. */
  match: boolean;
  /** Нет описания — долг мастера, подсвечивается приглушённо-красным. */
  noDesc: boolean;
  /** Шаг вложенности: сколько уровней вниз видно; null — всё. */
  depthSteps: number | null;
  onToggle: (id: number) => void;
  onCreateChild: (id: number) => void;
}

/** Карточка ноды древа: инверсная шапка (§1.4) + голоса Label/Data (§1.5).
 * Ноль радиусов (§1.1), ноль теней (§1.2), бордер var(--line) (§1.3),
 * иконка NavIcon вместо эмодзи (тип — формой, §1.7). */
export const LocationRootNode = memo(function LocationRootNode({
  data,
  selected,
}: NodeProps<Node<LocationRootNodeData>>) {
  const d = data;
  return (
    <div
      className="geography-root-node"
      style={{
        width: ROOT_NODE_W,
        border: "var(--card-border-width) solid var(--line)",
        borderTop: d.match ? "3px solid var(--accent)" : "var(--card-border-width) solid var(--line)",
        borderRadius: 0,
        background: "var(--paper-2)",
        backgroundImage: "var(--card-body-texture)",
        boxShadow: "none",
        outline: selected ? "2px solid var(--ink)" : "none",
        outlineOffset: 2,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ opacity: 0.6, borderRadius: 0, background: "var(--ink)" }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0.6, borderRadius: 0, background: "var(--ink)" }}
      />
      <div className="geography-root-node__header">
        <NavIcon name={d.childCount > 0 ? "folder" : "map"} />
        <Link
          to={`/locations/${d.locationId}`}
          className="nodrag geography-root-node__name"
          title={d.name}
          onClick={(e) => e.stopPropagation()}
        >
          {d.name}
        </Link>
        {d.childCount > 0 && (
          <button
            className="nodrag geography-root-node__toggle"
            title={d.collapsed ? "Развернуть ветку" : "Свернуть ветку"}
            aria-label={d.collapsed ? `Развернуть ветку (${d.childCount})` : "Свернуть ветку"}
            aria-expanded={!d.collapsed}
            onClick={(e) => {
              e.stopPropagation();
              d.onToggle(d.locationId);
            }}
          >
            {d.collapsed ? `+${d.childCount}` : "−"}
          </button>
        )}
        <button
          className="nodrag geography-root-node__add"
          title="Создать вложенную локацию"
          aria-label={`Создать вложенную в «${d.name}»`}
          onClick={(e) => {
            e.stopPropagation();
            d.onCreateChild(d.locationId);
          }}
        >
          <NavIcon name="plus" />
        </button>
      </div>
      {(d.kind || d.hasMap || d.noDesc || d.depthSteps != null) && (
        <div className="geography-root-node__meta">
          <span className="geography-root-node__kind">{d.kind || "—"}</span>
          {d.hasMap && (
            <span className="geography-root-node__map" title="Есть карта">
              <NavIcon name="map" /> карта
            </span>
          )}
          {d.noDesc && <span className="geography-root-node__nodesc">без описания</span>}
          {d.depthSteps != null && (
            <span className="geography-root-node__gap" title="Видно уровней вниз">
              {d.depthSteps} ур.
            </span>
          )}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0.6, borderRadius: 0, background: "var(--ink)" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0.6, borderRadius: 0, background: "var(--ink)" }}
      />
    </div>
  );
});
