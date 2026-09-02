// Настройки пульта сессии. Тот же localStorage-приём, что у financePrivacy.ts
// и thumbnailStyles.ts: это предпочтение Мастера на этой машине, а не свойство
// данных.
//
// Пока настройка одна — что делать после завершения игры из пульта. Умолчание
// «в плашку»: завершают игру в момент, когда за столом ещё шумно и все
// расходятся, и окно с деньгами там поперёк. Плашка неразобранных на Главной
// не даст об этом забыть.
const KEY = "rpgManagerPultFinishAction";

export type PultFinishAction = "banner" | "modal";

export function loadPultFinishAction(): PultFinishAction {
  try {
    return localStorage.getItem(KEY) === "modal" ? "modal" : "banner";
  } catch {
    return "banner";
  }
}

export function savePultFinishAction(action: PultFinishAction): void {
  try {
    if (action === "modal") localStorage.setItem(KEY, "modal");
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
