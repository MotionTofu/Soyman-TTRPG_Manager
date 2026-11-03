import { createContext, useContext, type ComponentType } from "react";
import type { Node, NodeProps } from "@xyflow/react";

export const CanvasNodeMenuContext = createContext<((id: string, x: number, y: number) => void) | null>(null);

/** Все виды узлов вызывают тот же обработчик, что ПКМ и Menu/Shift+F10. */
export function withCanvasNodeMenu<T extends Record<string, unknown>>(View: ComponentType<NodeProps<Node<T>>>) {
  return function CanvasNodeWithMenu(props: NodeProps<Node<T>>) {
    const open = useContext(CanvasNodeMenuContext);
    const name = String(props.data.name || props.data.title || props.data.text || props.data.fromLabel || (props.type === "route" ? "Маршрут" : props.type === "image" ? "Картинка" : "Объект"));
    return <>
      <View {...props} />
      {open && <button type="button" className="nodrag nopan canvas-node-actions" aria-label={`Действия: ${name}`} aria-haspopup="menu"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          open(props.id, rect.left, rect.bottom);
        }}>⋯</button>}
    </>;
  };
}
