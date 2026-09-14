// Общий показ состояний загрузки: ошибка, скелет, пусто.
//
// ЗАЧЕМ. Карточка ошибки с «Повторить» жила в 28 местах, скелет загрузки —
// в 29, с побуквенно одинаковым инлайновым стилем (красная полоса слева,
// пульсация скелета). И далеко за пределами списков — карточки сущностей,
// деревья локаций, экран входа. Самое размноженное в приложении — не
// раскладка, а показ состояний (решение Q32/Q35 разбора 2026-09-12,
// `MainWorks/Каркас_списка_—_решения_2026-09-12.md`).
//
// СОСТАВ. Обёртка плюс те же куски наружу:
//
// - `<Loadable loading error onRetry empty skeleton>` — закрывает тело
// //   целиком там, где ошибка и скелет сторожат одну область (вкладки
// //   «Население», «Бестиарий», «Сообщества» сеттинга). Порядок строгий:
//   ошибка → загрузка → пусто → содержимое.
// - `<LoadErrorCard>` — та же карточка отдельно, для мест, где нужен ровно
//   один кусок. Без `onRetry` кнопки нет: у `LoginScreen` повторять нечего
//   по смыслу, у ошибок формы в модалках («Важные даты», создание сессии)
//   и у «Чарник повреждён» повтор тоже бессмыслен — там свой следующий шаг
//   (править поля, пересоздать чарник). Это не недосмотр.
// - `<ListSkeleton variant>` — форма словом, не числом: «tiles» (плитки),
//   «rows» (строки), «paragraph» (абзац).
// - `<SkeletonBlock height>` — только для мелочи внутри карточек (высоты
//   26/34 и соседи по тем же блокам): такие места не трогаются как форма,
//   точные высоты сохранены, внутрь уехала лишь пульсация.
//
// ЧЕГО ОБЁРТКА НЕ ДЕЛАЕТ. Ошибка-баннер поверх живого содержимого
// (списки кампаний/сеттингов/систем/игроков, «Не удалось обновить
// обитателей») остаётся баннером-куском, а не обёрткой: при transient-ошибке
// обновления данные на месте, и прятать их за карточкой нельзя — Мастер за
// столом с плохим вайфаем теряет рабочую страницу. Замена баннера обёрткой
// здесь — решение, а не правка.
//
// ПРИНУЖДЕНИЕ. Копии узнаются по инлайновому стилю, это ловит
// `client/scripts/check-list.mjs` (шаг 4 задания): своя карточка ошибки и
// свой скелет — по всему `src`, а не только в списках.
import type { ReactNode } from "react";

const PULSE = "search-skeleton-pulse 1.1s ease-in-out infinite alternate";

/** Красная карточка слева. Кнопка «Повторить» — только когда есть onRetry. */
export function LoadErrorCard({
  message,
  onRetry,
  action,
}: {
  /** Текст целиком, с «Не удалось…» впереди: «Не удалось загрузить X: {err}». */
  message: ReactNode;
  /** Повтор загрузки. Нет — кнопки нет (форма входа, ошибка формы, битые данные). */
  onRetry?: () => void;
  /** Своё действие вместо «Повторить» (ссылка «К дневникам» у «не найдено»). */
  action?: ReactNode;
}) {
  return (
    <div
      className="card"
      style={{
        borderLeft: "3px solid var(--status-cancelled)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span>{message}</span>
      {onRetry ? (
        <button className="primary" onClick={onRetry}>
          Повторить
        </button>
      ) : (
        action
      )}
    </div>
  );
}

export type ListSkeletonVariant = "tiles" | "rows" | "paragraph";

/** Скелет тела списков и областей. Форма — словом, счёт — числом. */
export function ListSkeleton({
  variant,
  count,
  label,
  tilesClassName,
}: {
  variant: ListSkeletonVariant;
  /** Сколько блоков. Плитки — 4, строки — 2, у абзаца всегда два. */
  count?: number;
  /** Подпись для скринридера: «Загрузка кампаний». */
  label?: string;
  /** Обёртка плиток. По умолчанию сетка каталога; у Игроков своя. */
  tilesClassName?: string;
}) {
  const busy = { "aria-busy": true as const, "aria-label": label ?? "Загрузка" };
  if (variant === "tiles") {
    const n = count ?? 4;
    return (
      <div className={tilesClassName ?? "grid-cards"} {...busy}>
        {Array.from({ length: n }).map((_, i) => (
          <div
            key={i}
            className="card"
            style={{
              height: 220,
              opacity: 0.45,
              background: "var(--bg-elevated)",
              animation: PULSE,
              animationDelay: `${i * 120}ms`,
            }}
          />
        ))}
      </div>
    );
  }
  if (variant === "rows") {
    const n = count ?? 2;
    return (
      <div className="stack" {...busy}>
        {Array.from({ length: n }).map((_, i) => (
          <div
            key={i}
            className="card"
            style={{
              height: 48,
              opacity: 0.45,
              background: "var(--bg-elevated)",
              animation: PULSE,
              animationDelay: i === 0 ? undefined : `${i * 120}ms`,
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="stack" {...busy}>
      <div
        className="card"
        style={{ height: 140, opacity: 0.45, background: "var(--bg-elevated)", animation: PULSE }}
      />
      <div
        className="card"
        style={{
          height: 220,
          opacity: 0.45,
          background: "var(--bg-elevated)",
          animation: PULSE,
          animationDelay: "120ms",
        }}
      />
    </div>
  );
}

/** Мелочь внутри карточек: точная высота сохранена, пульсация — общая. */
export function SkeletonBlock({ height }: { height: number }) {
  return <div className="search-skeleton-pulse" style={{ height }} />;
}

/**
 * Тело под тремя состояниями. Ошибка заменяет тело целиком — поэтому сюда
 * только области, где ошибка и скелет сторожат одно тело, а не баннеры
 * поверх живого содержимого (см. шапку выше).
 */
export function Loadable({
  loading,
  error,
  errorTitle,
  onRetry,
  empty,
  skeleton,
  children,
}: {
  loading: boolean;
  error: string | null;
  /** Своё начало карточки: «Не удалось загрузить личностей». */
  errorTitle: string;
  onRetry: () => void;
  /** Пустое состояние целиком. Нет (null) — показывается содержимое. */
  empty?: ReactNode;
  skeleton: ReactNode;
  children: ReactNode;
}) {
  if (error)
    return (
      <LoadErrorCard
        message={
          <>
            {errorTitle}: {error}
          </>
        }
        onRetry={onRetry}
      />
    );
  if (loading) return <>{skeleton}</>;
  return <>{empty ?? children}</>;
}
