// Значок «у существа есть статблок» — два листа бумаги стопкой. Стоит в
// строке Населения и в строке бестиария компендиума, поэтому живёт отдельно:
// метка одна и та же, и выглядеть в обоих списках должна одинаково.
//
// Верхний лист рисуется целиком, нижний — только выступающей частью: заливки
// у значка нет (он подхватывает currentColor и ложится на любой фон строки),
// и полный прямоугольник просвечивал бы сквозь верхний.
export function StatblockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 60 60"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M42.148,10.689 V1.333 H5.667 V49.187 H15.967" />
      <rect x="15.967" y="10.689" width="36.481" height="47.854" />
      <path
        strokeWidth="3"
        d="M25.839,21.764 H42.577 M25.839,30.332 H42.577 M25.839,38.901 H42.577 M25.839,47.469 H42.577"
      />
    </svg>
  );
}

/** Подпись значка: одна карточка или несколько. */
export function statblockBadgeTitle(count: number): string {
  return count === 1 ? "Есть статблок" : `Статблоков: ${count}`;
}
