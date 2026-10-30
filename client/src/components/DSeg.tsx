// Сегмент тушью «Д» (docs/design-system.md §6.6): подразделы внутри вкладки.
// На телефоне ряд не переносится, а прокручивается вбок (блок «Кампании», Q3).
export interface DSegItem<T extends string> {
  id: T;
  label: string;
  /** Счётчик машинописью; 0 и пусто не показываются. */
  count?: number;
}

export function DSeg<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly DSegItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Подпись для чтеца экрана. */
  label: string;
}) {
  return (
    <div className="d-seg d-seg--scroll" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={it.id === value}
          className={it.id === value ? "active" : ""}
          onClick={() => onChange(it.id)}
        >
          {it.label}
          {!!it.count && <b>{it.count}</b>}
        </button>
      ))}
    </div>
  );
}
