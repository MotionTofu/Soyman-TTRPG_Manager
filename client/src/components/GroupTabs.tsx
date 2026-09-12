import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { EntityGroup } from "../types";
import { useAlert } from "../hooks/useConfirm";

// Полоса групп для списков: «Все», группы владельца, «Вне групп», «+».
//
// ЗАЧЕМ. Этого файла было четыре — `CampaignGroupTabs`, `SettingGroupTabs`,
// `SystemGroupTabs`, `PlayerGroupTabs`, 896 строк на всех. После обезличивания
// имён они расходились на четыре вещи, и все четыре — данные, а не устройство:
//
//   1. адрес API (`/setting-groups` против `/system-groups` и прочих);
//   2. `aria-label` полосы;
//   3. одна фраза в диалоге удаления («Сеттинги не будут удалены…»);
//   4. у Кампаний — две добавочные неизменяемые вкладки «Я мастер» / «Я игрок».
//
// Ни одно из четырёх не требует своего файла. Когда требовалось починить
// поведение полосы, чинить приходилось в четырёх местах, и понять, что все
// четыре починены, было нельзя ничем, кроме чтения всех четырёх.
//
// ЧЕТЫРЕ ТАБЛИЦЫ ГРУПП ОСТАЮТСЯ. Схлопывается разметка, а не данные:
// `setting_groups`, `campaign_groups`, `system_groups`, `player_groups` —
// разные таблицы с разными маршрутами, и сводить их в одну здесь нечем и
// незачем. Отсюда `endpoint` пропом.
//
// ГРУППЫ — НЕ ВКЛАДКИ СТРАНИЦЫ. Это полоса внутри списка, и `useTabState` ей
// не годится: имя группы — число в адресе, а набор меняется по ходу (её тут
// же можно завести и удалить). Состояние держит страница-хозяин.

export interface GroupTabsExtra {
  /** Ключ, который уедет в `onTabChange` и вернётся в `activeTab`. */
  id: string;
  label: string;
}

interface Props {
  /** Адрес набора групп: `/setting-groups`, `/campaign-groups`, … */
  endpoint: string;
  /** Подпись полосы для чтения с экрана: «Группы сеттингов». */
  label: string;
  /** Что стоит в диалоге удаления: «Сеттинги не будут удалены — они
   *  останутся в разделе „Все сеттинги“». Фраза целиком, а не одно слово:
   *  склонение и название раздела у каждого вида свои. */
  deleteNote: string;
  /** Неизменяемые вкладки между «Все» и группами: у Кампаний это «Я мастер»
   *  и «Я игрок» — не группы, а взгляд на список (`campaigns.role`). */
  extraTabs?: readonly GroupTabsExtra[];
  activeTab: string | null;
  onTabChange: (tab: string | null) => void;
  onGroupsChanged: () => void;
}

export function GroupTabs({
  endpoint,
  label,
  deleteNote,
  extraTabs,
  activeTab,
  onTabChange,
  onGroupsChanged,
}: Props) {
  const [groups, setGroups] = useState<EntityGroup[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [contextMenu, setContextMenu] = useState<
    { kind: "group"; groupId: number; x: number; y: number } | { kind: "static"; x: number; y: number } | null
  >(null);
  const [renaming, setRenaming] = useState<{ groupId: number; name: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [alertDialog, showAlert] = useAlert();
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  async function loadGroups() {
    try {
      const data = await api.get<EntityGroup[]>(endpoint);
      setGroups(data);
    } catch {
      // silent
    }
  }

  useEffect(() => {
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  useEffect(() => {
    if (creating && inputRef.current) inputRef.current.focus();
  }, [creating]);

  useEffect(() => {
    if (renaming && renameRef.current) renameRef.current.focus();
  }, [renaming]);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.post(endpoint, { name });
      setNewName("");
      setCreating(false);
      await loadGroups();
      onGroupsChanged();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  async function handleRename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    try {
      await api.put(`${endpoint}/${renaming.groupId}`, { name });
      setRenaming(null);
      await loadGroups();
      onGroupsChanged();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  async function handleDelete(groupId: number) {
    try {
      await api.del(`${endpoint}/${groupId}`);
      setDeleteConfirm(null);
      if (activeTab === String(groupId)) onTabChange(null);
      await loadGroups();
      onGroupsChanged();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  function openStaticMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ kind: "static", x: e.clientX, y: e.clientY });
  }

  // Метки отступления от каркаса здесь нет намеренно: барьер
  // `check-entity-page.mjs` смотрит только `src/pages`, а метка, которую никто
  // не читает, врёт про наличие разрешения.
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      <button
        role="tab"
        aria-selected={activeTab === null}
        className={activeTab === null ? "active" : ""}
        onClick={() => onTabChange(null)}
        onContextMenu={openStaticMenu}
      >
        Все
      </button>

      {extraTabs?.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={activeTab === t.id}
          className={activeTab === t.id ? "active" : ""}
          onClick={() => onTabChange(t.id)}
          onContextMenu={openStaticMenu}
        >
          {t.label}
        </button>
      ))}

      {groups.map((g) => (
        <button
          key={g.id}
          role="tab"
          aria-selected={activeTab === String(g.id)}
          className={activeTab === String(g.id) ? "active" : ""}
          onClick={() => onTabChange(String(g.id))}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ kind: "group", groupId: g.id, x: e.clientX, y: e.clientY });
          }}
        >
          {renaming?.groupId === g.id ? (
            <input
              ref={renameRef}
              className="setting-group-tab-rename-input"
              value={renaming.name}
              onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setRenaming(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            g.name
          )}
        </button>
      ))}

      <button
        role="tab"
        aria-selected={activeTab === "ungrouped"}
        className={activeTab === "ungrouped" ? "active" : ""}
        onClick={() => onTabChange("ungrouped")}
        onContextMenu={openStaticMenu}
      >
        Вне групп
      </button>

      <button
        role="tab"
        aria-selected={creating}
        className={creating ? "active" : ""}
        onClick={() => {
          setCreating(!creating);
          setNewName("");
        }}
      >
        +
      </button>

      {creating && (
        <div className="setting-group-create-inline">
          <input
            ref={inputRef}
            className="setting-group-create-input"
            placeholder="Название группы…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <button className="primary small" onClick={handleCreate} disabled={!newName.trim()}>
            Создать
          </button>
          <button className="small" onClick={() => setCreating(false)}>
            Отмена
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="setting-group-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.kind === "static" ? (
            <span
              style={{
                display: "block",
                padding: "6px 12px",
                color: "var(--muted)",
                fontSize: "var(--fs-meta)",
              }}
            >
              Эту вкладку не изменить
            </span>
          ) : (
            <>
              <button
                onClick={() => {
                  const g = groups.find((gr) => gr.id === contextMenu.groupId);
                  if (g) setRenaming({ groupId: g.id, name: g.name });
                  setContextMenu(null);
                }}
              >
                Переименовать
              </button>
              <button
                className="danger"
                onClick={() => {
                  setDeleteConfirm(contextMenu.groupId);
                  setContextMenu(null);
                }}
              >
                Удалить
              </button>
            </>
          )}
        </div>
      )}

      {deleteConfirm !== null && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Удалить группу?</h3>
            <p>{deleteNote}</p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setDeleteConfirm(null)}>Отмена</button>
              <button className="danger" onClick={() => handleDelete(deleteConfirm)}>
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
      {alertDialog}
    </div>
  );
}
