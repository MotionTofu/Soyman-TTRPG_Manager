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
import { useState, type ReactNode } from "react";

export interface WorkspaceNavItem {
  id: string;
  label: string;
  hint?: string;
}

export interface WorkspaceSection {
  id: string;
  label: string;
  /** Счётчик справа от названия (количество объектов). */
  count?: number;
  /** Элементы категории. Нет — одиночный пункт (как «Основное»). */
  items?: WorkspaceNavItem[];
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
}) {
  // Раскрытые категории. По умолчанию раскрыта та, где лежит выбор, —
  // остальное свернуто, чтобы панель оставалась компактной при десятках
  // элементов.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([selection.section]));

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

  return (
    <div className="entity-tab-workspace" key={workspaceKey}>
      <nav className="entity-tab-workspace__nav card" aria-label="Навигация внутри таба">
        <div className="etw-nav-list">
          {sections.map((s) => {
            const isActiveSection = selection.section === s.id && !s.items;
            const isOpen = s.items ? expanded.has(s.id) : false;
            return (
              <div key={s.id} className="etw-nav-section">
                <button
                  type="button"
                  className={`etw-nav-header${isActiveSection ? " is-selected" : ""}`}
                  onClick={() =>
                    s.items ? (toggle(s.id), selection.section !== s.id && pick(s.id)) : pick(s.id)
                  }
                  aria-expanded={s.items ? isOpen : undefined}
                >
                  {s.items && (
                    <span className="etw-nav-chevron" aria-hidden="true">
                      {isOpen ? "▾" : "▸"}
                    </span>
                  )}
                  <span className="etw-nav-label">{s.label}</span>
                  {s.count != null && s.count > 0 && (
                    <span className="etw-nav-count" aria-label={`Всего: ${s.count}`}>
                      {s.count}
                    </span>
                  )}
                </button>
                {s.items && isOpen && (
                  <div className="etw-nav-items">
                    {s.items.length === 0 && <span className="muted etw-nav-empty">Пока пусто</span>}
                    {s.items.map((item) => {
                      const selected = selection.section === s.id && selection.item === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`etw-nav-item${selected ? " is-selected" : ""}`}
                          onClick={() => pick(s.id, item.id)}
                          title={item.hint ?? item.label}
                          aria-current={selected ? "true" : undefined}
                        >
                          <span className="etw-nav-item-label">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
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
