import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { chapterWord, sceneWord } from "../sceneKinds";
import { AdventureWizard } from "./AdventureWizard";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import type { StoryArc } from "../types";
import { NavIcon } from "./NavIcons";
import { useConfirm, usePrompt } from "../hooks/useConfirm";
import { useLongPress } from "../hooks/useLongPress";
import { useUndoDelete } from "../hooks/useUndoDelete";

// "Приключения" — the index of a setting's prepared story blocks. Everything
// inside one (chapters, scenes, milestones, secrets) lives on the adventure's
// own profile page, so this stays a short list instead of an endless scroll.
// Rendered on the setting profile only: a campaign shows the adventures it is
// linked to in its own sections instead.
export function AdventuresTab({
  settingId,
  campaignId,
}: {
  settingId: number;
  campaignId?: number;
}) {
  const [confirmDialog, confirm] = useConfirm();
  const [promptDialog, promptText] = usePrompt();
  const { deleteWithUndo } = useUndoDelete();
  const navigate = useNavigate();
  const [arcs, setArcs] = useState<StoryArc[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; arc: StoryArc } | null>(null);

  function refresh() {
    api.get<StoryArc[]>(`/story/arcs?setting_id=${settingId}`).then(setArcs);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [settingId]);

  async function archive(arc: StoryArc) {
    if (!(await confirm({ message: `Отправить «${arc.name}» в архив вместе с главами и сценами?`, confirmLabel: "Архивировать", danger: true })))
      return;
    // Отмена возвращает одну строку приключения: главы и сцены своей отметки
    // не получали, они просто перестают находиться вместе с ним.
    await deleteWithUndo({
      entityName: arc.name,
      deleteFn: async () => { await api.del(`/story/arcs/${arc.id}`); refresh(); },
      restoreFn: async () => { await api.put(`/story/arcs/${arc.id}/restore`, {}); refresh(); },
    });
  }

  async function rename(arc: StoryArc) {
    const name = await promptText({ title: "Переименовать приключение", message: "Название приключения", defaultValue: arc.name });
    if (!name?.trim() || name.trim() === arc.name) return;
    await api.put(`/story/arcs/${arc.id}`, { name: name.trim() });
    refresh();
  }

  // Один общий обработчик на весь список: строка отдаёт своё приключение
  // аргументом, а не получает собственный колбэк.
  const openMenu = useCallback((arc: StoryArc, at: { clientX: number; clientY: number }) => {
    setMenu({ x: at.clientX, y: at.clientY, arc });
  }, []);

  // Only top-level adventures are listed; chapters belong to the profile.
  const adventures = arcs.filter((a) => a.parent_id == null);

  async function reorder(draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const ids = adventures.map((a) => a.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const order = new Map(ids.map((id, i) => [id, i]));
    setArcs((prev) => [...prev].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));
    await api.put("/story/arcs/reorder", { order: ids });
    refresh();
  }

  // Внутри кампании список показывает приключения сеттинга только для чтения:
  // переименование и архивация отсюда тронули бы оригинал и все остальные
  // кампании разом. Стандартное приключение сервер архивировать и не даст.
  const editable = !campaignId && menu?.arc.is_default !== 1;
  const menuItems: ContextMenuItem[] = menu
    ? [
        { label: "Открыть", onClick: () => navigate(`/adventures/${menu.arc.id}${campaignId ? `?campaign=${campaignId}` : ""}`) },
        ...(editable
          ? [
              { label: "Переименовать", onClick: () => rename(menu.arc) },
              { label: "Архивировать", danger: true, onClick: () => archive(menu.arc) },
            ]
          : []),
      ]
    : [];

  return (
    <div className="stack">
      {confirmDialog}
      {promptDialog}
      {!campaignId && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="primary" onClick={() => setWizardOpen(true)}>
            + Приключение
          </button>
        </div>
      )}

      <p className="muted">
        Приключение — блок подготовленного сюжета внутри сеттинга (книга, ваншот, арка). Внутри
        него главы, сцены, вехи, тайны и зацепки.{" "}
        {campaignId
          ? "Кампания видит приключения сеттинга: правка сцены создаёт копию только для этой кампании, оригинал не меняется."
          : "Кампании наследуют эти приключения и могут править сцены у себя, не трогая оригинал."}
      </p>

      <div className="entity-row-list">
        {adventures.map((a) => (
          <AdventureRow
            key={a.id}
            arc={a}
            draggable={!campaignId}
            onDragStart={() => setDragId(a.id)}
            onDrop={() => dragId != null && reorder(dragId, a.id)}
            onMenu={openMenu}
          >
            <Link
              to={`/adventures/${a.id}${campaignId ? `?campaign=${campaignId}` : ""}`}
              className="entity-row-name"
            >
              {a.name}
            </Link>
            <span className="muted">
              {!!a.chapter_count && `${a.chapter_count} ${chapterWord(a.chapter_count)} · `}
              {a.scene_count} {sceneWord(a.scene_count)}
              {a.recommended_level && ` · ${a.recommended_level}`}
            </span>
            {a.is_default === 1 && <span className="badge tag">стандартное</span>}
            {!campaignId && a.is_default !== 1 && (
              <span className="entity-row-actions">
                <button className="danger" onClick={() => archive(a)}>
                  <NavIcon name="archive" /> Архивировать
                </button>
              </span>
            )}
          </AdventureRow>
        ))}
        {adventures.length === 0 && <p className="muted">Приключений пока нет.</p>}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} title={menu.arc.name} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {wizardOpen && (
        <AdventureWizard
          settingId={settingId}
          campaignId={campaignId}
          onClose={() => setWizardOpen(false)}
          onCreated={() => refresh()}
        />
      )}
    </div>
  );
}

// Строка приключения. Отдельным компонентом — только чтобы у неё был свой
// `useLongPress`: хук нельзя звать в `map`, а долгое зажатие нужно каждой
// строке, потому что на планшете правой кнопки нет.
function AdventureRow({
  arc,
  draggable,
  onDragStart,
  onDrop,
  onMenu,
  children,
}: {
  arc: StoryArc;
  draggable: boolean;
  onDragStart: () => void;
  onDrop: () => void;
  onMenu: (arc: StoryArc, at: { clientX: number; clientY: number }) => void;
  children: ReactNode;
}) {
  const longPress = useLongPress(useCallback((at) => onMenu(arc, at), [onMenu, arc]));
  return (
    <div
      className="entity-row"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(arc, { clientX: e.clientX, clientY: e.clientY });
      }}
      {...longPress}
    >
      {children}
    </div>
  );
}
