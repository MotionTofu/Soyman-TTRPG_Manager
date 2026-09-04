import type { DndClassEntry } from "../../types";

/**
 * «Воин [Fighter] — Мистический рыцарь 3» — класс с подклассом и уровнем,
 * при мультиклассе через «/».
 *
 * Отдельным модулем, а не рядом с формой: строку читают и плашка чарника в
 * профиле, и сам лист, а экспорт не-компонента из DndCharacterForm.tsx
 * ломает fast refresh (oxlint react/only-export-components).
 */
export function classAndLevelSummary(classes: DndClassEntry[]): string {
  return classes
    .filter((c) => c.className)
    .map((c) => {
      const parts = [c.className, c.subclassName].filter(Boolean).join(" — ");
      return `${parts} ${c.level}`;
    })
    .join(" / ");
}
