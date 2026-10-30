import { useEffect, useRef, useState, type MouseEventHandler, type ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { EntityTypeChip } from "./EntityTypeChip";
import { ListSkeleton, LoadErrorCard } from "./Loadable";
import { NavIcon, type NavIconName } from "./NavIcons";

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
// Пересмотр 2026-09-18 (F-51, разбор Q60–Q64): у полосы вкладок — необязательный
// «+» в конце (`onAddTab`), как у групп в каталогах. Первым им пользуется
// дневник игрока: вкладки там заводит сам игрок, и пустую — тоже. Это
// кнопка, а не гнездо под произвольную разметку.
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
// Ошибка и скелет — общие (`Loadable.tsx`): у показа состояний одна
// реализация на всё приложение, а не своя в каждом каркасе.
//
// ЧЕГО КАРКАС НЕ РЕШАЕТ. Чем наполнено тело вкладки — дело страницы. Такое
// правило было («список, мастер-детейл или форма») и снято 2026-09-12: его
// нечем принудить. Гнездо проверяется тем, что им воспользовались; «это
// список или форма» — суждение, которого ни компонент, ни барьер выразить не
// могут, и за неделю оно набрало три отступления с причиной у одного только
// Сеттинга. Гнёзда — про то, ГДЕ ЧТО ЛЕЖИТ, и закрывать их правильно; тело —
// про то, ЧЕМ НАПОЛНЕНО, и зависит от материала, которого заранее не знаешь.
// Если тянет закрыть словарь тел заново — сперва прочтите
// MainWorks/Реестр_отступлений.md, О-3: это уже пробовали дважды.
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

/** Вкладка, у которой подпись не совпадает с ключом: у Системы вкладки —
 *  разделы справочника, ключ числовой, а подпись — имя раздела. Там, где
 *  подпись и есть ключ, вкладка задаётся строкой. */
export interface EntityPageTab {
  id: string;
  label?: string;
  /** Знак перед подписью язычка (профиль кампании, 2026-10-23). */
  icon?: NavIconName;
  /** Счётчик на ярлыке машинописью (макет «Д»). */
  count?: number;
}

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
  /** Контекстное меню имени и метаданных (например, состояние в кампании). */
  onIdentContextMenu?: MouseEventHandler<HTMLDivElement>;
  /** Строка под именем: дата события, подпись, счётчик. */
  meta?: ReactNode;
  /** Единственное действие, видимое в шапке. Разрушительное сюда не кладут. */
  primaryAction?: ReactNode;
  /** Остальные действия — под «…». Пусто — кнопки «…» не будет. */
  actions?: ContextMenuItem[];
  /** Фон-подложка под всей страницей (обложка сеттинга), готовый `url(...)`. */
  backdrop?: string | null;
  /** Полоса вкладок. Нет — страница без вкладок, как Событие.
   *  Строка — вкладка, чья подпись и есть ключ; объект — когда они разные. */
  tabs?: readonly (string | EntityPageTab)[];
  /** Вкладки, спрятанные под «Ещё» — постепенность, а не переполнение.
   *  Пустому сеттингу показывают четыре вкладки вместо десяти: остальные
   *  нечем наполнить, пока нет ни одной кампании. Полоса от ширины экрана
   *  не зависит никогда — она прокручивается вбок (см. `.tabs` в index.css),
   *  и порядок вкладок один и тот же на любом окне. */
  hiddenTabs?: readonly string[];
  /** Подпись справа у пункта «Ещё» — счётчик или «должны 2». */
  hiddenTabHints?: Partial<Record<string, string>>;
  /** «+» в конце полосы — завести вкладку. Нет — кнопки нет. */
  onAddTab?: () => void;
  /** Подсказка к «+»: что именно он заводит. */
  addTabLabel?: string;
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
  /** Вид «на бумаге» (разбор профилей 2026-10-01, Q9): вкладки — язычки,
   *  тело — лист (paper.css). Это вид, а не гнездо: состав шапки тот же,
   *  только имя со значками стоит первой строкой листа первой вкладки, без
   *  значка вида, а «…» — язычком справа на полосе.
   *  Пилот — профиль существа; остальные карточки переходят своими раундами. */
  paper?: boolean;
  /** Вид «Д» без бумаги: заголовок над ярлыками, тело — лист в тушь-рамке
   *  (d-system.css, .d-tabs/.d-sheet). Макеты Roll-* разделов систем. */
  sheet?: boolean;
  /** На бумаге имя со значками — над ярлыками на всех вкладках, а не на
   *  листе первой (сессия, макет Roll-Prep, Q1 2026-10-29). */
  titleAbove?: boolean;
  /** На бумаге не ставить имя первой строкой листа: вкладка рисует свою
   *  голову (профиль кампании глазами игрока, макет Camp-Player-Overview). */
  hideIdent?: boolean;
  children: ReactNode;
}

export function EntityPage({
  crumbs,
  entityType,
  title,
  avatar,
  badges,
  onIdentContextMenu,
  meta,
  primaryAction,
  actions,
  backdrop,
  tabs,
  hiddenTabs,
  hiddenTabHints,
  onAddTab,
  addTabLabel,
  tab,
  onTab,
  loading,
  error,
  onRetry,
  missing,
  overlays,
  fill,
  paper,
  sheet,
  titleAbove,
  hideIdent,
  children,
}: EntityPageProps) {
  // Меню «…» открывается под своей кнопкой, а не там, где щёлкнули: у кнопки
  // в шапке место постоянное, и меню должно появляться там же каждый раз.
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const nav = tabsRef.current;
    if (!nav) return;
    function revealTab() {
      const selected = nav!.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!selected) return;
      const n = nav!.getBoundingClientRect(), t = selected.getBoundingClientRect();
      if (t.left < n.left) nav!.scrollLeft -= n.left - t.left;
      else if (t.right > n.right) nav!.scrollLeft += t.right - n.right;
    }
    revealTab();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(revealTab) : null;
    observer?.observe(nav);
    for (const button of nav.querySelectorAll("button")) observer?.observe(button);
    return () => observer?.disconnect();
  }, [tab]);
  const moreTabsRef = useRef<HTMLButtonElement>(null);
  const [tabsMenuAt, setTabsMenuAt] = useState<{ x: number; y: number } | null>(
    null,
  );

  // Выбранная вкладка видна в полосе всегда — даже придя из «Ещё». Иначе
  // страница показывает содержимое «Заметок», а в полосе не подсвечено
  // ничего, и человеку неоткуда узнать, где он стоит.
  const openedHidden = tab && hiddenTabs?.includes(tab) ? tab : null;
  const shownTabs: EntityPageTab[] = [
    ...(tabs ?? []).map((t) => (typeof t === "string" ? { id: t } : t)),
    ...(openedHidden ? [{ id: openedHidden }] : []),
  ];
  const restTabs = hiddenTabs?.filter((t) => t !== openedHidden) ?? [];

  function openMenu() {
    const r = moreRef.current?.getBoundingClientRect();
    if (r) setMenuAt({ x: r.right, y: r.bottom });
  }

  const ident = (
    <div className="entity-page__ident" onContextMenu={onIdentContextMenu}>
      <div className="entity-page__title-row">
        {!paper && <EntityTypeChip type={entityType} />}
        {loading && !title ? (
          <span className="entity-page__title-skeleton" aria-hidden="true" />
        ) : (
          <h1>{title}</h1>
        )}
        {badges}
      </div>
      {meta && <div className="entity-page__meta muted">{meta}</div>}
    </div>
  );
  const more = actions && actions.length > 0 && (
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
  );
  // На бумаге имя — первая строка листа первой вкладки, а «…» — язычок у
  // правого края полосы (владелец, 2026-10-01). Значка вида на бумаге нет, а
  // на остальных вкладках нет и имени: оно в крошках, и Мастер помнит, чей
  // профиль открыл.
  const moreInTabs = paper && !!tabs?.length;

  const tabStrip = tabs && tabs.length > 0 && (
    <div ref={tabsRef} className={sheet ? "tabs d-tabs" : "tabs"} role="tablist">
      {shownTabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          className={tab === t.id ? "active" : ""}
          onClick={() => onTab?.(t.id)}
        >
          {t.icon && <NavIcon name={t.icon} />}
          {t.label ?? t.id}
          {t.count !== undefined && <b>{t.count}</b>}
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
      {onAddTab && (
        <button
          type="button"
          aria-label={addTabLabel ?? "Новая вкладка"}
          title={addTabLabel ?? "Новая вкладка"}
          onClick={onAddTab}
        >
          +
        </button>
      )}
      {moreInTabs && more}
    </div>
    );

  return (
    <div
      className={`stack entity-page${fill ? " page-fill" : ""}${paper ? " entity-page--paper" : ""}`}
      data-entity-type={entityType}
    >
      {overlays}

      {backdrop && (
        <div
          className="campaign-bg-layer cover-photo cover-halftone"
          aria-hidden="true"
        >
          <div
            className="cover-art-image"
            style={{ backgroundImage: backdrop }}
          />
        </div>
      )}

      <Breadcrumbs items={crumbs} />

      {(!paper || titleAbove || avatar || primaryAction || (more && !moreInTabs)) && (
        <div className="entity-page__head">
          {avatar && <div className="entity-page__avatar">{avatar}</div>}

          {/* Вид «лист»: на первой вкладке название стоит на самом листе
              (герой обзора), над ярлыками его нет — макет «Д». */}
          {(titleAbove || (!paper && !(sheet && tab === shownTabs[0]?.id))) && ident}

          {(primaryAction || (more && !moreInTabs)) && (
            <div className="entity-page__actions">
              {primaryAction}
              {!moreInTabs && more}
            </div>
          )}
        </div>
      )}

      {menuAt && actions && (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          items={actions}
          onClose={() => setMenuAt(null)}
        />
      )}

      {!sheet && tabStrip}

      {tabsMenuAt && restTabs.length > 0 && (
        <ContextMenu
          x={tabsMenuAt.x}
          y={tabsMenuAt.y}
          items={restTabs.map((t) => ({ label: t, hint: hiddenTabHints?.[t], onClick: () => onTab?.(t) }))}
          onClose={() => setTabsMenuAt(null)}
        />
      )}

      {sheet ? (
        // Ярлыки и лист — одним блоком: зазор колонки .stack не должен
        // отрывать ярлыки от листа.
        <div className="d-tabbed">
          {tabStrip}
          <div className="d-sheet">
            {error ? (
              <LoadErrorCard message={<>Ошибка загрузки: {error}</>} onRetry={onRetry} />
            ) : loading ? (
              <ListSkeleton variant="paragraph" label="Загрузка" />
            ) : (
              children
            )}
          </div>
        </div>
      ) : error ? (
        <LoadErrorCard
          message={<>Ошибка загрузки: {error}</>}
          onRetry={onRetry}
        />
      ) : missing ? (
        <div className="card entity-page__missing muted">
          Записи нет — её удалили или ссылка ведёт не туда.
        </div>
      ) : loading ? (
        <ListSkeleton variant="paragraph" label="Загрузка" />
      ) : paper ? (
        <div className="paper-sheet paper-scope">
          {!titleAbove && !hideIdent && (!shownTabs.length || tab === shownTabs[0].id) && ident}
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
