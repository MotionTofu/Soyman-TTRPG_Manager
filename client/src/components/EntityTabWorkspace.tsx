// Универсальный Master–Detail для содержимого таба сущности.
//
// Иерархия (концепция интерфейса):
//   верхний таб-бар → выбирает область работы (домен),
//   левая панель    → выбирает объект внутри области,
//   правая панель   → полноценно работает с выбранным объектом.
//
// Компонент не знает про конкретную сущность: caller собирает `sections`
// под свой таб (у «Информации о локации» это Основное/Статьи/Изображения,
// у другого таба набор будет своим). Табы без нескольких самостоятельных
// объектов этот компонент не используют — там вся ширина отдаётся списку.
//
// Правила:
// - левая панель — только содержимое текущего таба, не дерево сущности;
// - категории раскрываются/сворачиваются, показывают счётчик;
// - выбранный объект подсвечен инверсией;
// - независимый скролл: навигация sticky со своим overflow, на мобильном
//   панели складываются в одну колонку.
import { Fragment, useState, type ReactNode } from "react";
import { NavIcon, type NavIconName } from "./NavIcons";
import { DSeg } from "./DSeg";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { ContextMenuItem } from "./ContextMenu";
import { entityMark, openEntityMenu, type EntityRef } from "../pageMenu";

export interface WorkspaceNavItem {
  id: string;
  label: string;
  hint?: string;
  /** Число справа, как у категории. */
  count?: number;
  /** Точка «мы здесь» — текущее приключение кампании и т. п. */
  current?: boolean;
  /** Служебный пункт — бледнее остальных. */
  dim?: boolean;
  /** Пункт — сущность: общий ПКМ (§6.12) с местным блоком `menu`. */
  entity?: EntityRef;
  menu?: ContextMenuItem[];
}

export interface WorkspaceSection {
  id: string;
  label: string;
  /** Счётчик справа от названия (количество объектов). */
  count?: number;
  /** Знак перед названием. */
  icon?: NavIconName;
  /** Элементы категории. Нет — одиночный пункт (как «Основное»). */
  items?: WorkspaceNavItem[];
  /** Подзаголовок над категорией; повторяется у соседних — пишется один раз. */
  group?: string;
  /** Под пунктами категории — её действие («+ Приключение»). */
  footer?: ReactNode;
}

export interface WorkspaceSelection {
  section: string;
  item?: string;
}

export function EntityTabWorkspace({
  sections,
  selection,
  onSelect,
  children,
  navFooter,
  workspaceKey,
  sectionOverview = false,
  phoneSelect = false,
  seg = false,
  plates = false,
}: {
  sections: WorkspaceSection[];
  selection: WorkspaceSelection;
  onSelect: (sel: WorkspaceSelection) => void;
  /** Рабочая область справа — редактор выбранного объекта. */
  children: ReactNode;
  /** Контекстная кнопка внизу навигации («+ Добавить статью»). */
  navFooter?: ReactNode;
  /** Ключ для сброса скролла/состояния при смене сущности. */
  workspaceKey?: string | number;
  /** Заглавие категории открывает её сводку, включая уже выбранную категорию. */
  sectionOverview?: boolean;
  /** На телефоне навигация — один выпадающий список над рабочей областью. */
  phoneSelect?: boolean;
  /** Вид «Д»: разделы без пунктов — сегментом тушью над рабочей областью,
   *  без колонки слева (блок «Кампании», Q3). */
  seg?: boolean;
  /** Вид «Д» колонки (макеты Camp-Story/World): категория с пунктами и
   *  подзаголовок группы — плашками, пункты раскрыты всегда, выбранный —
   *  кромкой слева. */
  plates?: boolean;
}) {
  // Раскрытые категории. По умолчанию раскрыта та, где лежит выбор, —
  // остальное свернуто, чтобы панель оставалась компактной при десятках
  // элементов.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([selection.section]));
  // Элемент выбран снаружи (caller сам открыл, например, первую статью) —
  // его категория раскрывается, как при выборе щелчком.
  const selKey = selection.item != null ? `${selection.section}/${selection.item}` : null;
  const [seenSelKey, setSeenSelKey] = useState(selKey);
  if (selKey !== seenSelKey) {
    setSeenSelKey(selKey);
    if (selKey && !expanded.has(selection.section)) setExpanded(new Set(expanded).add(selection.section));
  }

  function toggle(sectionId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function pick(sectionId: string, itemId?: string) {
    setExpanded((prev) => (itemId ? new Set(prev).add(sectionId) : prev));
    onSelect({ section: sectionId, item: itemId });
  }

  if (seg) {
    return (
      <div className="entity-tab-workspace--seg" key={workspaceKey}>
        <DSeg label="Разделы вкладки" items={sections} value={selection.section} onChange={(id) => pick(id)} />
        {children}
      </div>
    );
  }

  return (
    <div
      className={`entity-tab-workspace${phoneSelect ? " entity-tab-workspace--phone-select" : ""}${plates ? " entity-tab-workspace--plates" : ""}`}
      key={workspaceKey}
    >
      <nav className="entity-tab-workspace__nav card" aria-label="Навигация внутри таба">
        {phoneSelect && (
          <select
            className="etw-nav-select"
            aria-label="Раздел"
            value={selection.item != null ? `${selection.section}/${selection.item}` : selection.section}
            onChange={(e) => {
              const [section, item] = e.target.value.split("/");
              pick(section, item);
            }}
          >
            {sections.map((s) =>
              s.items ? (
                <optgroup key={s.id} label={s.label}>
                  <option value={s.id} hidden>
                    {s.label}
                  </option>
                  {s.items.map((item) => (
                    <option key={item.id} value={`${s.id}/${item.id}`}>
                      {item.current ? `● ${item.label}` : item.label}
                    </option>
                  ))}
                </optgroup>
              ) : (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              )
            )}
          </select>
        )}
        {/* На телефоне список свёрнут в выбор — кнопки под разделами
            («+ Приключение») встают рядом с ним (макет Camp-Story-Phone). */}
        {phoneSelect && sections.some((s) => s.footer) && (
          <div className="etw-nav-phone-acts">
            {sections.map((s) => s.footer && <Fragment key={s.id}>{s.footer}</Fragment>)}
          </div>
        )}
        <div className="etw-nav-list">
          {sections.map((s, i) => {
            const groupTitle = s.group && s.group !== sections[i - 1]?.group ? s.group : null;
            const isActiveSection = selection.section === s.id && (!s.items || (sectionOverview && !selection.item));
            const isOpen = s.items ? expanded.has(s.id) : false;
            return (
              <div key={s.id} className="etw-nav-section">
                {groupTitle && <span className={plates ? "d-plate" : "etw-nav-group"}>{groupTitle}</span>}
                {plates && s.items ? (
                  <h3 className="d-plate">
                    {s.label}
                    {!!s.count && <span className="etw-plate-count">{s.count}</span>}
                  </h3>
                ) : (
                <button
                  type="button"
                  className={`etw-nav-header${isActiveSection ? " is-selected" : ""}`}
                  onClick={() =>
                    s.items ? (toggle(s.id), (sectionOverview || selection.section !== s.id) && pick(s.id)) : pick(s.id)
                  }
                  aria-expanded={s.items ? isOpen : undefined}
                >
                  {s.items && (
                    <span className="etw-nav-chevron" aria-hidden="true">
                      {isOpen ? "▾" : "▸"}
                    </span>
                  )}
                  {s.icon && <NavIcon name={s.icon} />}
                  <span className="etw-nav-label">{s.label}</span>
                  {s.count != null && s.count > 0 && (
                    <span className="etw-nav-count" aria-label={`Всего: ${s.count}`}>
                      {s.count}
                    </span>
                  )}
                </button>
                )}
                {s.items && (isOpen || plates) && (
                  <div className="etw-nav-items">
                    {s.items.length === 0 && <span className="muted etw-nav-empty">Пока пусто</span>}
                    {s.items.map((item) => {
                      const selected = selection.section === s.id && selection.item === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`etw-nav-item${selected ? " is-selected" : ""}${item.dim ? " is-dim" : ""}`}
                          onClick={() => pick(s.id, item.id)}
                          {...(item.entity && {
                            ...entityMark(item.entity.type, item.entity.id, item.entity.name),
                            onContextMenu: (e: ReactMouseEvent) => {
                              if (e.shiftKey) return;
                              e.preventDefault();
                              openEntityMenu(item.entity!, e.clientX, e.clientY, item.menu ?? []);
                            },
                          })}
                          title={item.hint ?? item.label}
                          aria-current={selected ? "true" : undefined}
                        >
                          <span className="etw-nav-item-label">{item.label}</span>
                          {item.current && <span className="etw-nav-dot" aria-label="текущее" />}
                          {item.count != null && <span className="etw-nav-item-count">{item.count}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {s.footer && <div className="etw-nav-sfooter">{s.footer}</div>}
              </div>
            );
          })}
        </div>
        {navFooter && <div className="etw-nav-footer">{navFooter}</div>}
      </nav>
      <div className="entity-tab-workspace__detail">{children}</div>
    </div>
  );
}
