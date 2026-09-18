// Каркас списка/каталога: полоса вкладок над содержимым.
//
// ЗАЧЕМ. Семь каталогов (Кампании, Сеттинги, Системы, Игроки, Ресурсы,
// Архив, Карты) были согласованы по устройству, но расходились разметкой:
// своя шапка, своя полоса групп, свой тулбар, свои скелет и ошибка в каждом.
// Каркас держит порядок гнёзд одним компонентом.
//
// СОСТАВ ГНЁЗД ЗАКРЫТ. Сверху вниз:
//
//     заголовок → действия и кнопка создания справа
//     полоса: «Все» · неизменяемые · группы · «Вне групп» · «+» новой группы
//     тулбар: поиск · гнездо особого · «N / M» · сброс
//     содержимое
//
// Новое гнездо — пересмотр этого списка, а не проп: иначе каркас за год
// снова станет семью разными страницами с общим импортом.
//
// ИСТОРИЯ РАСКЛАДКИ — чтобы не пробовать то же в третий раз. 2026-09-12
// (Q41–Q49) каталоги перевели на мастер-детейл: слева группы, справа
// предпросмотр только для чтения. 2026-09-18, после первого знакомства на
// живых данных, владелец вернул полосу (Q52–Q59,
// `MainWorks/Каркас_списка_—_решения_2026-09-12.md`; реестр отступлений,
// О-4). Главная причина — предпросмотр оказался лишним шагом: хотел открыть
// сущность, а попал в промежуточный экран; кроме того, панель съедала
// ширину сетки, а группы полосой видны сразу. Мастер-детейл хорош там, где
// правая панель — место работы (Игроки, «Население» сеттинга), а не
// прихожая. Поэтому щелчок по плитке ведёт прямо в карточку.
//
// ЧЕГО КАРКАС НЕ РЕШАЕТ. Чем наполнено тело — дело страницы (Q50: словарь
// тел не закрывается). Крошек нет (Q37). Число у вкладки — только там, где
// страница его передала, а не у всех.
//
// ПРИНУЖДЕНИЕ. `client/scripts/check-list.mjs`: каталог из списка обязан
// идти через каркас, своя `res-toolbar` вне каркаса запрещена, свои скелет
// и карточка ошибки — по всему `src`.
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useAfterWrite, write } from "../data/hooks";
import { ContextMenu } from "./ContextMenu";
import { SectionHeading } from "./SectionHeading";
import { useAlert, useConfirm } from "../hooks/useConfirm";
import type { NavIconName } from "./NavIcons";

export interface ListPageGroup {
  /** Ключ вкладки. У групп владельца — числовой id строкой. */
  id: string;
  label: string;
  /** Число в подписи вкладки. */
  count?: number;
}

export interface ListPageProps {
  /** Ключ иконки заголовка (`campaigns`, `resources`, …). Нет — без привязки. */
  headingSection?: NavIconName;
  /** Имя каталога: «Кампании». */
  title: ReactNode;
  /** Прочие действия справа от заголовка (перед кнопкой создания). */
  actions?: ReactNode;
  /** Подпись кнопки создания в шапке («+ Новая кампания»). Нет `onCreate` — кнопки нет. */
  createLabel?: string;
  onCreate?: () => void;
  /** Подпись первой вкладки. Null — не показывать (Архив: вида «все» нет). */
  allLabel?: string | null;
  /** Подпись вкладки вне групп. Null — не показывать. По умолчанию «Вне
   *  групп» там, где группы настоящие (есть `groupsEndpoint`). */
  ungroupedLabel?: string | null;
  /** Неизменяемые вкладки между «Все» и группами: «Я мастер» / «Я игрок». */
  extraTabs?: readonly { id: string; label: string }[];
  /** Группы или разделы (у Архива — «Сущности» и «Файлы», у Ресурсов —
   *  «Звук», «Аудио-наборы», «Шаблоны»). Нет ни одной вкладки — нет и полосы
   *  (Карты). */
  groups: ListPageGroup[];
  /** Адрес CRUD групп (`/campaign-groups`, …). Нет — вкладки неизменяемые:
   *  без заведения, переименования и удаления. */
  groupsEndpoint?: string;
  /** Фраза в диалог удаления — целиком («Кампании не будут удалены — …»). */
  groupsDeleteNote?: string;
  /** Страница перезачитывает группы и состав после правки групп. */
  onGroupsChanged?: () => void;
  /** Выбранная вкладка: null — «Все», `"ungrouped"` — «Вне групп». */
  activeGroup: string | null;
  onGroupChange: (group: string | null) => void;
  /** Поиск в тулбаре — всегда, со счётчиком и сбросом. */
  search: string;
  onSearch: (q: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;
  /** Счётчик «N / M»: показано / всего. */
  filteredCount: number;
  totalCount: number;
  /** Сброс поиска и фильтров. Кнопка видна, пока `showReset`. */
  onResetSearch: () => void;
  /** Когда виден «Сбросить». По умолчанию — пока строка поиска непуста. */
  showReset?: boolean;
  resetTitle?: string;
  /** Гнездо особого: плашки жанров, фильтр масштаба, сортировка, фильтры. */
  toolbarExtra?: ReactNode;
  toolbarLabel?: string;
  /** Тулбара нет — у вкладки, где искать нечего или поиск свой. */
  hideToolbar?: boolean;
  /** Содержимое: сетка плиток, строки, рабочий экран — что угодно (Q50). */
  children: ReactNode;
}

type GroupMenu =
  | { kind: "group"; groupId: string; x: number; y: number }
  | { kind: "static"; x: number; y: number }
  | null;

export function ListPage({
  headingSection,
  title,
  actions,
  createLabel,
  onCreate,
  allLabel = "Все",
  ungroupedLabel,
  extraTabs,
  groups,
  groupsEndpoint,
  groupsDeleteNote,
  onGroupsChanged,
  activeGroup,
  onGroupChange,
  search,
  onSearch,
  searchPlaceholder,
  searchLabel,
  filteredCount,
  totalCount,
  onResetSearch,
  showReset,
  resetTitle,
  toolbarExtra,
  toolbarLabel,
  hideToolbar,
  children,
}: ListPageProps) {
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupMenu, setGroupMenu] = useState<GroupMenu>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const afterWrite = useAfterWrite();

  useEffect(() => {
    if (creatingGroup) createInputRef.current?.focus();
  }, [creatingGroup]);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  async function handleCreateGroup() {
    if (!groupsEndpoint) return;
    const name = newGroupName.trim();
    if (!name) return;
    try {
      await write.post(groupsEndpoint, { name });
      afterWrite([{ path: groupsEndpoint }]);
      setNewGroupName("");
      setCreatingGroup(false);
      onGroupsChanged?.();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  async function handleRenameGroup() {
    if (!groupsEndpoint || !renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    try {
      await write.put(`${groupsEndpoint}/${renaming.id}`, { name });
      afterWrite([{ path: groupsEndpoint }]);
      setRenaming(null);
      onGroupsChanged?.();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  async function handleDeleteGroup(groupId: string) {
    if (!groupsEndpoint) return;
    const ok = await confirm({
      title: "Удалить группу?",
      message: groupsDeleteNote ?? "Элементы не будут удалены.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      await write.del(`${groupsEndpoint}/${groupId}`);
      afterWrite([{ path: groupsEndpoint }]);
      if (activeGroup === groupId) onGroupChange(null);
      onGroupsChanged?.();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  const showUngrouped = ungroupedLabel ?? (groupsEndpoint ? "Вне групп" : null);
  const groupIds = new Set(groups.map((g) => g.id));

  const tabs: ListPageGroup[] = [
    ...(allLabel != null ? [{ id: "all", label: allLabel }] : []),
    ...(extraTabs ?? []).map((t) => ({ id: t.id, label: t.label })),
    ...groups,
    ...(showUngrouped != null ? [{ id: "ungrouped", label: showUngrouped }] : []),
  ];
  const current = activeGroup ?? "all";

  function openTabMenu(e: MouseEvent, tabId: string) {
    // Меню — только у страниц с настоящими группами: у Архива и Ресурсов
    // вкладки неизменяемые, и объяснять это меню нечего.
    if (!groupsEndpoint) return;
    e.preventDefault();
    if (groupIds.has(tabId)) setGroupMenu({ kind: "group", groupId: tabId, x: e.clientX, y: e.clientY });
    else setGroupMenu({ kind: "static", x: e.clientX, y: e.clientY });
  }

  const resetVisible = showReset ?? search.trim() !== "";

  return (
    <div className="stack list-page">
      <div className="row list-page__head">
        <SectionHeading section={headingSection} compact>
          {title}
        </SectionHeading>
        {(actions || onCreate) && (
          <div className="row" style={{ gap: 8 }}>
            {actions}
            {onCreate && (
              <button className="primary" onClick={onCreate}>
                {createLabel ?? "Создать"}
              </button>
            )}
          </div>
        )}
      </div>

      {tabs.length > 0 && (
        <div className="tabs" role="tablist" aria-label={typeof title === "string" ? title : undefined}>
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={current === t.id}
              className={current === t.id ? "active" : ""}
              onClick={() => onGroupChange(t.id === "all" ? null : t.id)}
              onContextMenu={(e) => openTabMenu(e, t.id)}
            >
              {renaming?.id === t.id ? (
                <input
                  ref={renameInputRef}
                  className="setting-group-tab-rename-input"
                  value={renaming.name}
                  aria-label="Новое имя группы"
                  onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                  onBlur={() => void handleRenameGroup()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleRenameGroup();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  {t.label}
                  {t.count != null && <span className="list-page__tab-count">{t.count}</span>}
                </>
              )}
            </button>
          ))}

          {groupsEndpoint && (
            <button
              role="tab"
              aria-selected={creatingGroup}
              aria-label="Новая группа"
              title="Новая группа"
              className={creatingGroup ? "active" : ""}
              onClick={() => {
                setCreatingGroup(!creatingGroup);
                setNewGroupName("");
              }}
            >
              +
            </button>
          )}

          {groupsEndpoint && creatingGroup && (
            <div className="setting-group-create-inline">
              <input
                ref={createInputRef}
                className="setting-group-create-input"
                placeholder="Название группы…"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreateGroup();
                  if (e.key === "Escape") setCreatingGroup(false);
                }}
              />
              <button className="primary small" onClick={() => void handleCreateGroup()} disabled={!newGroupName.trim()}>
                Создать
              </button>
              <button className="small" onClick={() => setCreatingGroup(false)}>
                Отмена
              </button>
            </div>
          )}
        </div>
      )}

      {!hideToolbar && (
        <div className="res-toolbar" aria-label={toolbarLabel ?? "Поиск и фильтры"}>
          <input
            className="res-toolbar__search"
            placeholder={searchPlaceholder ?? "Поиск…"}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            aria-label={searchLabel ?? "Поиск"}
          />
          {toolbarExtra}
          <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>
            {filteredCount} / {totalCount}
          </span>
          {resetVisible && (
            <button type="button" onClick={onResetSearch} title={resetTitle ?? "Сбросить поиск"} style={{ fontSize: "var(--fs-meta)", padding: "2px 8px", height: 26 }}>
              Сбросить
            </button>
          )}
        </div>
      )}

      <div className="list-page__content">{children}</div>

      {groupMenu && (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          title={groupMenu.kind === "static" ? "Эту вкладку не изменить" : undefined}
          items={
            groupMenu.kind === "static"
              ? []
              : [
                  {
                    label: "Переименовать",
                    onClick: () => {
                      const g = groups.find((gr) => gr.id === groupMenu.groupId);
                      if (g) setRenaming({ id: g.id, name: g.label });
                    },
                  },
                  {
                    label: "Удалить",
                    danger: true,
                    onClick: () => void handleDeleteGroup(groupMenu.groupId),
                  },
                ]
          }
          onClose={() => setGroupMenu(null)}
        />
      )}
      {confirmDialog}
      {alertDialog}
    </div>
  );
}
