import { useState } from "react";
import { useUnloadTargets } from "../unloadTargets";
import type { SearchResult } from "../types";

// «В бой» в строке панели (рестайл «Д»: мечи в 14px читались лопатами): существо уезжает в трекер инициативы одним
// щелчком. Перетаскивание остаётся — оно быстрее, когда рука уже на мыши, — но
// за столом тянуть через полстраницы в узкую колонку это лишний точный жест,
// а руки у Мастера заняты.
//
// Ничего своего кнопка не умеет: она находит трекер среди целей выгрузки
// (unloadTargets.tsx) и отдаёт ему сущность так же, как это делает «Мешок».
// Иначе пришлось бы во второй раз написать разбор статблока, бросок хитов и
// выдачу прозвищ одинаковым гоблинам.

export function ToInitiativeButton({ item }: { item: SearchResult }) {
  const targets = useUnloadTargets();
  const [sent, setSent] = useState(false);
  const tracker = targets.find((t) => t.label === "Инициатива" && t.accepts(item));
  if (!tracker) return null;

  return (
    <button
      type="button"
      className={`to-init${sent ? " is-sent" : ""}`}
      title={sent ? "Уже в трекере — можно ещё раз" : "В трекер инициативы"}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await tracker.drop(item);
        setSent(true);
      }}
    >
      {sent ? "✓ В бою" : "В бой"}
    </button>
  );
}
