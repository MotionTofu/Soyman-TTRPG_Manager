import type { CSSProperties, ReactNode } from "react";

// Число внутри силуэта кости — приём дизайн-системы §6.5, взятый с макета
// карты персонажа (гриллинг 2026-09-04).
//
// Почему не общий components/Dice.tsx: тот компонент владелец забраковал
// дважды. Разница не в идее, а в отделке — внутренние рёбра-фасетки и точки
// по углам превращали ряд характеристик в груду. Здесь силуэт голый, число
// моноширинное, а смысл (владение, потраченность) показан цветом кромки, а не
// значком рядом.
//
// Пропорция — правильный шестиугольник: при высоте H полуширина равна
// H/2·√3/2. Кость, растянутая под ширину колонки, перестаёт читаться как та же
// форма, что на соседней карте, — ровно на этом прошлая попытка и сыпалась.

/** Крупная кость: триада КЗ / хиты / пассивное восприятие. */
export const DIE_LG_VIEWBOX = "0 0 60 69";
export const DIE_LG_OUTLINE = "M30 2 L58.2 18.25 L58.2 50.75 L30 67 L1.8 50.75 L1.8 18.25 Z";

/** Мелкая кость: ряд характеристик. */
export const DIE_SM_VIEWBOX = "0 0 46 53";
export const DIE_SM_OUTLINE = "M23 2 L44.2 14.25 L44.2 38.75 L23 51 L1.8 38.75 L1.8 14.25 Z";
/** Верхние рёбра — ими показывается владение спасброском. */
export const DIE_SM_EDGE = "M23 2 L44.2 14.25 L44.2 38.75";

export function DndDie({
  size = "sm",
  filled,
  accentColor,
  edge,
  className,
  style,
  children,
}: {
  size?: "sm" | "lg";
  /** Заливка цветом класса — для того, что тратится (хиты). */
  filled?: boolean;
  accentColor?: string;
  /** Подсветить верхние рёбра цветом класса (владение спасброском). */
  edge?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const lg = size === "lg";
  return (
    <span className={`dnd-die dnd-die-${size}${filled ? " is-filled" : ""}${className ? ` ${className}` : ""}`} style={style}>
      <svg viewBox={lg ? DIE_LG_VIEWBOX : DIE_SM_VIEWBOX} aria-hidden="true">
        <path
          className="dnd-die-outline"
          d={lg ? DIE_LG_OUTLINE : DIE_SM_OUTLINE}
          style={filled && accentColor ? { fill: accentColor, stroke: accentColor } : undefined}
        />
        {edge && !lg && (
          <path className="dnd-die-edge" d={DIE_SM_EDGE} style={accentColor ? { stroke: accentColor } : undefined} />
        )}
      </svg>
      <span className="dnd-die-content">{children}</span>
    </span>
  );
}
