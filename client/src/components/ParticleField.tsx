import { useState } from "react";

// Зинная россыпь — декоративный слой позади заголовков, логотипа навигации и
// заголовка панели поиска (§5.6: 2–3 зинных маркера на экран).
//
// Раньше это было поле круглых точек с box-shadow-свечением и бесконечной
// пульсацией прозрачности 0.2 → 0.65 на 12–24 секунды. Дизайн-ревизия убрала
// всё три: кругов в системе нет (§6.2 — круглые только аватары и центральная
// кнопка таб-бара), теней и свечений нет вообще (§3.2 — глубина через
// инверсию и обводку), «дышащие» свечения и плавные пульсации запрещены (§9).
// Намерение — оживить заголовок — верное, поэтому слой остался; сменилась
// только форма: рубленые метки в --muted, статично.
//
// Форма кодирует смысл ровно постольку, поскольку его тут нет: три вида
// чередуются, чтобы россыпь не выглядела штампованной сеткой. Цвет один.
type MarkKind = "square" | "cross" | "star";

interface Mark {
  key: number;
  left: number;
  top: number;
  size: number;
  angle: number;
  opacity: number;
  kind: MarkKind;
}

const KINDS: MarkKind[] = ["square", "cross", "star"];

function generateMarks(count: number): Mark[] {
  return Array.from({ length: count }, (_, i) => ({
    key: i,
    left: Math.round(4 + Math.random() * 92),
    top: Math.round(6 + Math.random() * 88),
    // Мельче прежних точек: маркер, а не элемент композиции.
    size: Number((5 + Math.random() * 5).toFixed(1)),
    // Наклон в пределах, разрешённых §5.5 для наклеек и бейджей.
    angle: Math.round(-24 + Math.random() * 48),
    // Потолок 0.4 — §5.6 держит зинные маркеры в --muted или на 40 %.
    opacity: Number((0.22 + Math.random() * 0.18).toFixed(2)),
    // Круговой перебор, а не случайный выбор: при 6 метках случайность
    // регулярно выдаёт три одинаковых подряд, и россыпь читается как брак.
    kind: KINDS[i % KINDS.length],
  }));
}

function MarkShape({ kind }: { kind: MarkKind }) {
  switch (kind) {
    case "cross":
      return (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      );
    case "star":
      // Звёздочка-анархия из §5.6 — пятиконечная, залитая.
      return (
        <svg viewBox="0 0 14 14" fill="currentColor">
          <path d="M7 0l1.7 4.6L13.5 5l-3.6 3 1.3 4.7L7 10.2 2.8 12.7 4.1 8 .5 5l4.8-.4z" />
        </svg>
      );
    case "square":
    default:
      return <svg viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="10" /></svg>;
  }
}

interface Props {
  count?: number;
  className?: string;
}

export function ParticleField({ count = 8, className = "" }: Props) {
  // Lazy initializer runs exactly once per component instance (mount), not
  // on every render — equivalent to useMemo(() => ..., []) but without an
  // unused setter warning.
  const [marks] = useState(() => generateMarks(count));
  return (
    <div className={`particle-field ${className}`} aria-hidden="true">
      {marks.map((m) => (
        <span
          key={m.key}
          className={`particle-field-mark particle-field-mark-${m.kind}`}
          style={{
            left: `${m.left}%`,
            top: `${m.top}%`,
            width: `${m.size}px`,
            height: `${m.size}px`,
            opacity: m.opacity,
            transform: `rotate(${m.angle}deg)`,
          }}
        >
          <MarkShape kind={m.kind} />
        </span>
      ))}
    </div>
  );
}
