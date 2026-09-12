import { useRef, useState, type ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { EntityTypeChip } from "./EntityTypeChip";

// Каркас карточки сущности.
//
// ЗАЧЕМ. Шестнадцать карточек — Локация, Существо, Артефакт, Сцена, Община,
// Событие, Монстр, Транспорт, Персонаж, Приключение, Сеттинг, Система,
// Кампания, Сессия и две игроцких — верстали одну и ту же шапку вручную, и
// она разошлась: где `<h1>`, где `<h2>`, где `SectionHeading` (который в
// собственном комментарии предназначен спискам разделов, а не карточкам);
// значок вида то перед именем, то после; крошек нет у четырёх самых глубоких
// мест приложения — Кампании, Сеттинга, Системы и Сессии. Это и есть «где
// так, где сяк», на которое жаловался владелец.
//
// СОСТАВ ЗАКРЫТ (решение Q5 разбора 2026-09-12). Сверху вниз:
//
//     крошки → аватар → значок вида → имя <h1> → мета → действия справа
//
// Гнёзд ровно столько. Новое гнездо — не проп «ещё один ReactNode», а
// пересмотр этого списка: иначе каркас за год снова станет шестнадцатью
// разными шапками, только с общим импортом.
//
// ДЕЙСТВИЯ (Q7). В шапке видно ОДНО действие — самое частое. Остальные живут
// под «…». Разрушительное не бывает главным никогда: «Удалить» и
// «Архивировать» идут в меню, а не под палец рядом с именем. Основание —
// CLAUDE.md: у Мастера за столом заняты руки и голова, богатство органов
// управления считается минусом, пока не доказано обратное.
//
// ЗАГРУЗКА (Q12). Пять карточек писали серым абзацем «Загрузка…» вместо всей
// страницы, и раскладка подпрыгивала, когда данные приходили. Каркас рисует
// раму сразу, а тело — скелетом в размер будущего содержимого. Ошибка и
// «не найдено» тоже проходят через каркас, а не через голый абзац.
//
// ВКЛАДКИ. Полоса и её разметка — здесь; состояние — в `useTabState`, который
// держит выбранную вкладку в адресе (переживает перезагрузку, работает с
// «назад», умеет псевдонимы переименованных вкладок). Полоса прокручивается
// вбок, а не переносится по рядам: у Сеттинга десять вкладок, у Кампании
// девять, и порядок должен быть один и тот же на любой ширине.
//
// ПРИНУЖДЕНИЕ. Страница в `pages/` не имеет права на собственный
// `<div className="tabs">` и собственный заголовок страницы — это ловит
// `client/scripts/check-entity-page.mjs`. Барьер не запрещает, а требует
// назвать причину строкой рядом:
//
//     // каркас в обход намеренно — <причина>
//
// Тот же приём, что у шкалы кегля, шага и растровых ассетов: запрет без
// выхода перешагивают молча, метка переводит отступление из нарушения в
// запись.

export interface EntityPageProps {
  /** Крошки. Обязательны даже у хаба — там это одна ступень («Сеттинги ▸
   *  Вотердип»): ответ на «где я» и дорога обратно к списку. */
  crumbs: Crumb[];
  /** Вид сущности для значка — ключ `ENTITY_TYPE_SINGULAR`. */
  entityType: string;
  /** Имя сущности. Пока грузится — пустая строка, каркас покажет скелет. */
  title: string;
  /** Аватар или заглушка со сменой файла — узкое гнездо слева от имени. */
  avatar?: ReactNode;
  /** Значки рядом с именем: вид локации, «Архивировано», ссылка в граф. */
  badges?: ReactNode;
  /** Строка под именем: дата события, подпись, счётчик. */
  meta?: ReactNode;
  /** Единственное действие, видимое в шапке. Разрушительное сюда не кладут. */
  primaryAction?: ReactNode;
  /** Остальные действия — под «…». Пусто — кнопки «…» не будет. */
  actions?: ContextMenuItem[];
  /** Фон-подложка под всей страницей (обложка сеттинга), готовый `url(...)`. */
  backdrop?: string | null;
  /** Полоса вкладок. Нет — страница без вкладок, как Событие. */
  tabs?: readonly string[];
  /** Вкладки, спрятанные под «Ещё» — постепенность, а не переполнение.
   *  Пустому сеттингу показывают четыре вкладки вместо десяти: остальные
   *  нечем наполнить, пока нет ни одной кампании. Полоса от ширины экрана
   *  не зависит никогда — она прокручивается вбок (см. `.tabs` в index.css),
   *  и порядок вкладок один и тот же на любом окне. */
  hiddenTabs?: readonly string[];
  tab?: string;
  onTab?: (t: string) => void;
  /** Данные ещё не пришли: рама рисуется, тело — скелетом. */
  loading?: boolean;
  /** Ошибка загрузки. Показывается вместо тела, с «Повторить». */
  error?: string | null;
  onRetry?: () => void;
  /** Сущности нет (удалена, чужая ссылка) — своё сообщение вместо тела. */
  missing?: boolean;
  /** Модалки, диалоги подтверждения, визарды. Вне потока страницы. */
  overlays?: ReactNode;
  /** Вкладка занимает всю высоту окна (карта локации). */
  fill?: boolean;
  children: ReactNode;
}

export function EntityPage({
  crumbs,
  entityType,
  title,
  avatar,
  badges,
  meta,
  primaryAction,
  actions,
  backdrop,
  tabs,
  hiddenTabs,
  tab,
  onTab,
  loading,
  error,
  onRetry,
  missing,
  overlays,
  fill,
  children,
}: EntityPageProps) {
  // Меню «…» открывается под своей кнопкой, а не там, где щёлкнули: у кнопки
  // в шапке место постоянное, и меню должно появляться там же каждый раз.
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const moreTabsRef = useRef<HTMLButtonElement>(null);
  const [tabsMenuAt, setTabsMenuAt] = useState<{ x: number; y: number } | null>(null);

  // Выбранная вкладка видна в полосе всегда — даже придя из «Ещё». Иначе
  // страница показывает содержимое «Заметок», а в полосе не подсвечено
  // ничего, и человеку неоткуда узнать, где он стоит.
  const openedHidden = tab && hiddenTabs?.includes(tab) ? tab : null;
  const shownTabs = openedHidden ? [...(tabs ?? []), openedHidden] : (tabs ?? []);
  const restTabs = hiddenTabs?.filter((t) => t !== openedHidden) ?? [];

  function openMenu() {
    const r = moreRef.current?.getBoundingClientRect();
    if (r) setMenuAt({ x: r.right, y: r.bottom });
  }

  return (
    <div className={`stack entity-page${fill ? " page-fill" : ""}`}>
      {overlays}

      {backdrop && (
        <div className="campaign-bg-layer cover-photo cover-halftone" aria-hidden="true">
          <div className="cover-art-image" style={{ backgroundImage: backdrop }} />
        </div>
      )}

      <Breadcrumbs items={crumbs} />

      <div className="entity-page__head">
        {avatar && <div className="entity-page__avatar">{avatar}</div>}

        <div className="entity-page__ident">
          <div className="entity-page__title-row">
            <EntityTypeChip type={entityType} />
            {loading && !title ? (
              <span className="entity-page__title-skeleton" aria-hidden="true" />
            ) : (
              <h1>{title}</h1>
            )}
            {badges}
          </div>
          {meta && <div className="entity-page__meta muted">{meta}</div>}
        </div>

        {(primaryAction || (actions && actions.length > 0)) && (
          <div className="entity-page__actions">
            {primaryAction}
            {actions && actions.length > 0 && (
              <button
                ref={moreRef}
                type="button"
                className="entity-page__more"
                aria-label="Ещё действия"
                aria-haspopup="menu"
                onClick={openMenu}
              >
                …
              </button>
            )}
          </div>
        )}
      </div>

      {menuAt && actions && (
        <ContextMenu x={menuAt.x} y={menuAt.y} items={actions} onClose={() => setMenuAt(null)} />
      )}

      {tabs && tabs.length > 0 && (
        <div className="tabs" role="tablist">
          {shownTabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "active" : ""}
              onClick={() => onTab?.(t)}
            >
              {t}
            </button>
          ))}
          {restTabs.length > 0 && (
            // Список спрятанных вкладок идёт тем же меню, что и «…», а не
            // выпадающим блоком внутри полосы. Полоса прокручивается вбок и
            // потому обрезает всё, что торчит из неё вниз: прежний
            // `<details>` в SettingDetailPage раскрывался, но был не виден —
            // дефект жил ровно столько, сколько обе части рядом, и не
            // попадался, потому что виден только у сеттинга без кампаний.
            <button
              ref={moreTabsRef}
              type="button"
              className="entity-page__tabs-more"
              aria-haspopup="menu"
              onClick={() => {
                const r = moreTabsRef.current?.getBoundingClientRect();
                if (r) setTabsMenuAt({ x: r.right, y: r.bottom });
              }}
            >
              Ещё ▾
            </button>
          )}
        </div>
      )}

      {tabsMenuAt && restTabs.length > 0 && (
        <ContextMenu
          x={tabsMenuAt.x}
          y={tabsMenuAt.y}
          items={restTabs.map((t) => ({ label: t, onClick: () => onTab?.(t) }))}
          onClose={() => setTabsMenuAt(null)}
        />
      )}

      {error ? (
        <div className="card entity-page__error">
          <span>Ошибка загрузки: {error}</span>
          {onRetry && (
            <button className="primary" onClick={onRetry}>
              Повторить
            </button>
          )}
        </div>
      ) : missing ? (
        <div className="card entity-page__missing muted">
          Записи нет — её удалили или ссылка ведёт не туда.
        </div>
      ) : loading ? (
        <div className="entity-page__skeleton" aria-live="polite" aria-busy="true">
          <span className="sr-only">Загрузка…</span>
          <div className="entity-page__skeleton-card" />
          <div className="entity-page__skeleton-card entity-page__skeleton-card--short" />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
