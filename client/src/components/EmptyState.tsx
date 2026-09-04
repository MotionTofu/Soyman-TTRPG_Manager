// Пустое состояние для основных разделов: картинка + слоган Display-шрифтом +
// одна кнопка вместо серого «Пока нет ...». См. docs/design-system-punk-zine.md
// §8 («Маскот + слоган + одна кнопка. Не „нет данных“») и §10.3.
//
// Картинку даёт маскот SoyMan, а не абстрактные марки ZineGraphics, как было
// раньше: марки остались, но теперь работают жанровыми иконками
// (genre-chip-icon), а роль лица приложения — за маскотом.
//
// Настоящая пользовательская картинка (аватар, обложка кампании) сюда не
// относится — там остаётся честная заглушка загрузки.
import type { ReactNode } from "react";
import { SoyMan } from "./SoyMan";

export type EmptyStateKind =
  /** Сущность ещё не создана: «Бестиарий пуст», «Команда ещё не собрана». Маскот ждёт. */
  | "primary"
  /**
   * Поиск, фильтр или пояснение: «Ничего по „гоблин“», «Только для мастера».
   * Картинки нет вовсе — Мастер здесь не знакомится с разделом, а ищет,
   * и маскот на каждой неудачной букве быстро начинает раздражать.
   */
  | "search"
  /** Не найдено или не загрузилось: «Персонаж не найден», «Ошибка загрузки». */
  | "error";

export function EmptyState({
  kind = "primary",
  title,
  hint,
  action,
}: {
  kind?: EmptyStateKind;
  /** Короткий слоган Display-голосом — это заголовок, а не подпись «нет данных». */
  title: string;
  /** Необязательная строка пояснения под слоганом. */
  hint?: string;
  /** Единственное разрешённое действие (например, «Создать первый …»). */
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {kind !== "search" && (
        // decorative: заголовок и подсказка рядом говорят то же самое,
        // дублировать их для скринридера незачем.
        <SoyMan state={kind === "error" ? "error" : "waiting"} size="md" className="empty-state-mascot" decorative />
      )}
      <h2 className="empty-state-title">{title}</h2>
      {hint && <p className="empty-state-hint muted">{hint}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
