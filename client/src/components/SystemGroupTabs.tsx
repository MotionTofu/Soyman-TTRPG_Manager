import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { SystemGroup } from "../types";
import { useAlert } from "../hooks/useConfirm";

interface SystemGroupTabsProps {
  activeTab: string | null;
  onTabChange: (tab: string | null) => void;
  onGroupsChanged: () => void;
}

export function SystemGroupTabs({ activeTab, onTabChange, onGroupsChanged }: SystemGroupTabsProps) {
  const [groups, setGroups] = useState<SystemGroup[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ kind: "group"; groupId: number; x: number; y: number } | { kind: "static"; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ groupId: number; name: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [alertDialog, showAlert] = useAlert();
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  async function loadGroups() {
    try {
      const data = await api.get<SystemGroup[]>("/system-groups");
      setGroups(data);
    } catch {
      // silent
    }
  }

  useEffect(() => { loadGroups(); }, []);

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
      await api.post("/system-groups", { name });
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
      await api.put(`/system-groups/${renaming.groupId}`, { name });
      setRenaming(null);
      await loadGroups();
      onGroupsChanged();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  async function handleDelete(groupId: number) {
    try {
      await api.del(`/system-groups/${groupId}`);
      setDeleteConfirm(null);
      if (activeTab === String(groupId)) onTabChange(null);
      await loadGroups();
      onGroupsChanged();
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="tabs" role="tablist" aria-label="Группы систем">
      <button
        role="tab"
        aria-selected={activeTab === null}
        className={activeTab === null ? "active" : ""}
        onClick={() => onTabChange(null)}
        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ kind: "static", x: e.clientX, y: e.clientY }); }}
      >
        Все
      </button>

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
        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ kind: "static", x: e.clientX, y: e.clientY }); }}
      >
        Вне групп
      </button>

      <button
        role="tab"
        aria-selected={creating}
        className={creating ? "active" : ""}
        onClick={() => { setCreating(!creating); setNewName(""); }}
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
          <button className="small" onClick={() => setCreating(false)}>Отмена</button>
        </div>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="setting-group-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.kind === "static" ? (
            <span style={{ display: "block", padding: "6px 12px", color: "var(--muted)", fontSize: "var(--fs-body)" }}>
              Эту вкладку не изменить
            </span>
          ) : (
            <>
              <button onClick={() => {
                const g = groups.find((gr) => gr.id === contextMenu.groupId);
                if (g) setRenaming({ groupId: g.id, name: g.name });
                setContextMenu(null);
              }}>
                Переименовать
              </button>
              <button className="danger" onClick={() => {
                setDeleteConfirm(contextMenu.groupId);
                setContextMenu(null);
              }}>
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
            <p>Системы не будут удалены — они останутся в разделе «Все системы».</p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setDeleteConfirm(null)}>Отмена</button>
              <button className="danger" onClick={() => handleDelete(deleteConfirm)}>Удалить</button>
            </div>
          </div>
        </div>
      )}
      {alertDialog}
    </div>
  );
}
