// Каркас списка/каталога: мастер-детейл.
//
// ЗАЧЕМ. Шесть главных каталогов были согласованы по устройству
// (шапка → полоса групп → тулбар → скелет → ошибка → пустые → сетка),
// но расходились разметкой. Пересмотр Q41–Q50 (2026-09-12,
// `MainWorks/Каркас_списка_—_решения_2026-09-12.md`, ниже черты) заменил
// полосу групп мастер-детейлом: слева навигация и категоризация, справа
// предпросмотр. Приём уже был самым распространённым в приложении
// (`EntityTabWorkspace` — 19 мест, «Население» сеттинга, колонки Миллера).
//
// СОСТАВ ГНЁЗД ЗАКРЫТ. Сверху вниз:
//
//     заголовок → действия справа
//     левая панель: «Все» · особое · группы со счётчиками · «Вне групп»
//       · создание внизу
//     правая панель: тулбар (поиск · «N / M» · сброс · гнездо особого)
//       · содержимое ИЛИ предпросмотр
//
// Новое гнездо — пересмотр этого списка, а не проп: иначе каркас за год
// снова станет семью разными страницами с общим импортом.
//
// БЕРЁТСЯ ГОТОВОЕ. Левая панель — `EntityTabWorkspace` (те же классы и
// поведение, не копия): категории, счётчики, раскрытие, подвал для кнопки.
// Начинка групп — из `GroupTabs`: заведение, переименование, удаление с
// меню и диалогом. Полосы `GroupTabs` поверх списка больше нет.
//
// ПРЕДПРОСМОТР (Q41, Q46, Q48). Только чтение: правка остаётся на карточке
// сущности, иначе она перестаёт быть местом работы. Заменяет содержимое,
// третьей колонкой не встаёт. Состав — лицо, сводка, связи, ровно три
// действия, разрушительное под «…». Связи дороже описания: ради них
// сущности и заводят. Состав собирает страница-хозяин, каркас даёт место,
// кнопку «Назад к списку» и поведение на узком экране.
//
// СОЗДАНИЕ (Q47). Кнопка внизу левой панели, под выбранной категорией —
// отвечает на «создать ГДЕ». После создания новое становится выбранным
// (страница ставит выбор сама) — открывается его предпросмотр.
//
// УЗКИЙ ЭКРАН (Q43). Два экрана, а не две панели: список → тап →
// предпросмотр на весь экран → «назад» к списку. Предпросмотр —
// фиксированный оверлей со своим скроллом: список под ним не
// размонтируется и не прокручивается, место сохраняется само.
//
// ЧЕГО КАРКАС НЕ РЕШАЕТ. Чем наполнено тело и предпросмотр — дело
// страницы (Q50: словарь тел не закрывается). Крошек нет (Q37). Гнезда
// счётчика у вкладок страницы нет: счётчики Архива живут в `count`
// левой навигации (Q49).
//
// ПРИНУЖДЕНИЕ. `client/scripts/check-list.mjs`: своя `res-toolbar` вне
// каркаса, свой `SectionHeading` уровня страницы вне каркаса,
// `*ListPage.tsx` без каркаса, свои состояния по всему `src`.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAfterWrite, write } from "../data/hooks";
import { ContextMenu } from "./ContextMenu";
import { EntityTabWorkspace, type WorkspaceSection } from "./EntityTabWorkspace";
import { SectionHeading } from "./SectionHeading";
import { useAlert, useConfirm } from "../hooks/useConfirm";
import type { NavIconName } from "./NavIcons";

export interface ListPageGroup {
  /** Ключ раздела. У групп владельца — числовой id строкой. */
  id: string;
  label: string;
  /** Счётчик справа. У Архива сюда переезжают счётчики вкладок (Q49). */
  count?: number;
}

export interface ListPageProps {
  /** Ключ иконки заголовка (`campaigns`, `resources`, …). Нет — без привязки. */
  headingSection?: NavIconName;
  /** Имя каталога: «Кампании». */
  title: ReactNode;
  /** Действия справа от заголовка. */
  actions?: ReactNode;
  /** Подпись первого пункта. Null — не показывать (Архив: вида «все» нет). */
  allLabel?: string | null;
  /** Подпись пункта вне групп. Null — не показывать. По умолчанию «Вне
   *  групп» там, где группы настоящие (есть `groupsEndpoint`). */
  ungroupedLabel?: string | null;
  /** Неизменяемые вкладки между «Все» и группами: «Я мастер» / «Я игрок». */
  extraTabs?: readonly { id: string; label: string }[];
  /** Группы или разделы (у Архива — «Сущности» и «Файлы» со счётчиками). */
  groups: ListPageGroup[];
  /** Адрес CRUD групп (`/campaign-groups`, …). Нет — разделы неизменяемые:
   *  без заведения, переименования и удаления. */
  groupsEndpoint?: string;
  /** Фраза в диалог удаления — целиком («Кампании не будут удалены — …»).
   *  Обязательна вместе с `groupsEndpoint`. */
  groupsDeleteNote?: string;
  /** Страница перезачитывает группы и состав после CRUD групп. */
  onGroupsChanged?: () => void;
  /** Подпись кнопки создания («+ Новая кампания»). Нет `onCreate` — кнопки нет. */
  createLabel?: string;
  onCreate?: () => void;
  /** Выбранный раздел: null — «Все», `"ungrouped"` — «Вне групп». */
  activeGroup: string | null;
  onGroupChange: (group: string | null) => void;
  /** Поиск в тулбаре — всегда, со счётчиком и сбросом (решение 4). */
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
  /** Содержимое правой панели: сетка плиток, строки, группы — что угодно (Q50). */
  children: ReactNode;
  /** Выбранный объект. `selectedId != null` + заданный `preview` — вместо
   *  содержимого предпросмотр. После создания страница ставит сюда новое. */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Предпросмотр: лицо, сводка, связи, три действия (Q48). Только чтение. */
  preview?: ReactNode;
  previewBackLabel?: string;
}

type GroupMenu =
  | { kind: "group"; groupId: string; x: number; y: number }
  | { kind: "static"; x: number; y: number }
  | null;

export function ListPage({
  headingSection,
  title,
  actions,
  allLabel = "Все",
  ungroupedLabel,
  extraTabs,
  groups,
  groupsEndpoint,
  groupsDeleteNote,
  onGroupsChanged,
  createLabel,
  onCreate,
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
  children,
  selectedId,
  onSelect,
  preview,
  previewBackLabel,
}: ListPageProps) {
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();

  // Начинка групп — из `GroupTabs`, переехавшая в левую панель (Q45).
  // Список групп даёт страница (ей же нужны состав и счётчики), здесь
  // только операции и их состояние.
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupMenu, setGroupMenu] = useState<GroupMenu>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const afterWrite = useAfterWrite();
  const renameInputRef = useRef<HTMLInputElement>(null);

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

  const sections: WorkspaceSection[] = [
    ...(allLabel != null ? [{ id: "all", label: allLabel }] : []),
    ...(extraTabs ?? []).map((t) => ({ id: t.id, label: t.label })),
    ...groups,
    ...(showUngrouped != null ? [{ id: "ungrouped", label: showUngrouped }] : []),
  ];

  function renderSectionLabel(section: WorkspaceSection): ReactNode {
    if (renaming && renaming.id === section.id) {
      return (
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
      );
    }
    return <span className="etw-nav-label">{section.label}</span>;
  }

  function handleSectionContextMenu(sectionId: string, x: number, y: number) {
    if (groupsEndpoint && groupIds.has(sectionId)) {
      setGroupMenu({ kind: "group", groupId: sectionId, x, y });
    } else {
      setGroupMenu({ kind: "static", x, y });
    }
  }

  const isPreview = preview != null && selectedId != null;
  const resetVisible = showReset ?? search.trim() !== "";

  return (
    <div className={`stack list-page${isPreview ? " is-preview" : ""}`}>
      <div className="row list-page__head" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <SectionHeading section={headingSection} compact>
          {title}
        </SectionHeading>
        {actions}
      </div>

      <EntityTabWorkspace
        sections={sections}
        selection={{ section: activeGroup ?? "all" }}
        onSelect={(next) => onGroupChange(next.section === "all" ? null : next.section)}
        renderSectionLabel={renderSectionLabel}
        onSectionContextMenu={handleSectionContextMenu}
        navFooter={
          <>
            {onCreate && (
              <button className="primary" onClick={onCreate} style={{ alignSelf: "flex-start" }}>
                {createLabel ?? "Создать"}
              </button>
            )}
            {groupsEndpoint && !creatingGroup && (
              <button onClick={() => { setCreatingGroup(true); setNewGroupName(""); }} style={{ alignSelf: "flex-start" }}>
                + Новая группа
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
          </>
        }
      >
        <div className="stack">
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

          <div className="list-page__content">{children}</div>

          {isPreview && (
            <div className="list-page__preview">
              <div className="row" style={{ marginBottom: "var(--sp-4)" }}>
                <button type="button" onClick={() => onSelect?.(null)}>
                  {previewBackLabel ?? "Назад к списку"}
                </button>
              </div>
              {preview}
            </div>
          )}
        </div>
      </EntityTabWorkspace>

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
