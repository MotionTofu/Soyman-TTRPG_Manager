import { memo } from "react";
import type { EdgeProps } from "@xyflow/react";

/** Ребро-коллектор (идея «метро»): все рёбра одного родителя идут через общую
 * шину — визуально один ствол вместо веера кривых. Углы острые (§1.1).
 * data.axis: "vertical" (top-down/bottom-up) | "horizontal" (left-right). */
export const CollectorEdge = memo(function CollectorEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  data,
}: EdgeProps) {
  const d = (data ?? {}) as { axis?: string };
  const horizontal = d.axis === "horizontal";
  let path: string;
  if (horizontal) {
    const bus = sourceX + (targetX >= sourceX ? 34 : -34);
    path = `M ${sourceX} ${sourceY} L ${bus} ${sourceY} L ${bus} ${targetY} L ${targetX} ${targetY}`;
  } else {
    const bus = sourceY + (targetY >= sourceY ? 34 : -34);
    path = `M ${sourceX} ${sourceY} L ${sourceX} ${bus} L ${targetX} ${bus} L ${targetX} ${targetY}`;
  }
  return (
    <path
      d={path}
      fill="none"
      stroke="var(--line)"
      strokeWidth={1}
      style={style}
      className="geography-root__collector"
    />
  );
});
