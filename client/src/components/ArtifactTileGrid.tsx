import { memo, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "./Modal";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { EntityPreviewContent } from "./EntityPreviewModal";
import { NavIcon } from "./NavIcons";
import { useConfirm } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { ITEM_CLASSES, MAGIC_ITEM_RARITIES, itemTypeOptions } from "../compendium";
import type { Artifact, SettingLocation, SettingBeing, SettingCommunity } from "../types";

const classLabels = Object.fromEntries(ITEM_CLASSES.map((c) => [c.value, c.label]));

function monogramTone(type: string): number {
  let hash = 0;
  for (const ch of type) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

function monogramLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function metaLine(a: Artifact): string {
  const parts: string[] = [];
  if (a.item_class) parts.push(classLabels[a.item_class] ?? a.item_class);
  if (a.rarity) parts.push(a.rarity);
  if (a.item_type) parts.push(a.item_type);
  return parts.join(" · ") || "Предмет";
}

type ArtifactGrouping = "alpha" | "item_class" | "rarity";

const rarityOrder = Object.fromEntries(MAGIC_ITEM_RARITIES.map((r, i) => [r, i]));

function groupArtifacts(
  list: Artifact[],
  grouping: ArtifactGrouping,
  dir: "asc" | "desc" = "asc"
): [string, Artifact[]][] {
  const collator = (a: string, b: string) =>
    dir === "asc" ? a.localeCompare(b, "ru") : b.localeCompare(a, "ru");

  if (grouping === "alpha") {
    const map = new Map<string, Artifact[]>();
    for (const a of list) {
      const k = monogramLetter(a.name);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    const keys = [...map.keys()].sort(collator);
    return keys.map((k) => [k, map.get(k)!]);
  }

  if (grouping === "rarity") {
    const map = new Map<string, Artifact[]>();
    for (const a of list) {
      const k = a.rarity || "Без редкости";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    const keys = [...map.keys()].sort((a, b) => {
      const ai = rarityOrder[a] ?? 999;
      const bi = rarityOrder[b] ?? 999;
      return dir === "asc" ? ai - bi : bi - ai;
    });
    return keys.map((k) => [k, map.get(k)!]);
  }

  const map = new Map<string, Artifact[]>();
  for (const a of list) {
    const k = classLabels[a.item_class ?? ""] ?? "Без типа";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(a);
  }
  const keys = [...map.keys()].sort(collator);
  return keys.map((k) => [k, map.get(k)!]);
}

/* ─── Edit Modal ─── */

function ArtifactEditModal({
  artifact,
  onClose,
  onSaved,
}: {
  artifact: Artifact;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(artifact.name);
  const [shortName, setShortName] = useState(artifact.short_name ?? "");
  const [owner, setOwner] = useState(artifact.owner ?? "");
  const [itemClass, setItemClass] = useState(artifact.item_class ?? "");
  const [itemType, setItemType] = useState(artifact.item_type ?? "");
  const [rarity, setRarity] = useState(artifact.rarity ?? "");
  const [requiresAttunement, setRequiresAttunement] = useState(!!artifact.requires_attunement);
  const [saving, setSaving] = useState(false);

  const typeOptions = itemClass ? itemTypeOptions(itemClass) : [];

  async function save() {
    setSaving(true);
    try {
      await api.put(`/artifacts/${artifact.id}`, {
        name,
        short_name: shortName || null,
        owner: owner || null,
        item_class: itemClass || null,
        item_type: itemType || null,
        rarity: rarity || null,
        requires_attunement: requiresAttunement ? 1 : 0,
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="stack" style={{ padding: 16, gap: 12, minWidth: 360 }}>
        <h3 style={{ margin: 0 }}>Редактировать предмет</h3>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Название</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Краткое название</span>
          <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Опционально" />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Владелец (текст)</span>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Имя NPC, группа…" />
        </label>
        <div className="row" style={{ gap: 8 }}>
          <label className="stack" style={{ gap: 4, flex: 1 }}>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Род</span>
            <select value={itemClass} onChange={(e) => { setItemClass(e.target.value); setItemType(""); }}>
              <option value="">—</option>
              {ITEM_CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="stack" style={{ gap: 4, flex: 1 }}>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Тип</span>
            <select value={itemType} onChange={(e) => setItemType(e.target.value)} disabled={!itemClass}>
              <option value="">—</option>
              {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="stack" style={{ gap: 4, flex: 1 }}>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Редкость</span>
            <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
              <option value="">—</option>
              {MAGIC_ITEM_RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="stack" style={{ gap: 4, flex: 1 }}>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Настройка</span>
            <select value={requiresAttunement ? "1" : "0"} onChange={(e) => setRequiresAttunement(e.target.value === "1")}>
              <option value="0">Нет</option>
              <option value="1">Да</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose}>Отмена</button>
          <button className="primary" onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Assign Modal (location + being) ─── */

function ArtifactAssignModal({
  artifact,
  settingId,
  onClose,
  onSaved,
}: {
  artifact: Artifact;
  settingId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const [beings, setBeings] = useState<SettingBeing[]>([]);
  const [communities, setCommunities] = useState<SettingCommunity[]>([]);
  const [locationId, setLocationId] = useState<number | null>(artifact.location?.id ?? null);
  const [ownerType, setOwnerType] = useState<string>(artifact.owner_entity?.type ?? "");
  const [ownerId, setOwnerId] = useState<number | null>(artifact.owner_entity?.id ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const c = new AbortController();
    Promise.all([
      api.get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`, { signal: c.signal }),
      api.get<SettingBeing[]>(`/setting-beings?setting_id=${settingId}`, { signal: c.signal }),
      api.get<SettingCommunity[]>(`/setting-communities?setting_id=${settingId}`, { signal: c.signal }),
    ]).then(([locs, bgs, comms]) => {
      setLocations(locs);
      setBeings(bgs);
      setCommunities(comms);
    }).catch(() => {});
    return () => c.abort();
  }, [settingId]);

  async function save() {
    setSaving(true);
    try {
      await api.put(`/artifacts/${artifact.id}`, {
        location_id: locationId,
        owner_type: ownerType || null,
        owner_id: ownerId,
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="stack" style={{ padding: 16, gap: 12, minWidth: 360 }}>
        <h3 style={{ margin: 0 }}>Привязать «{artifact.name}»</h3>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Локация</span>
          <select value={locationId ?? ""} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Без локации</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Владелец-сущность</span>
          <select
            value={ownerType}
            onChange={(e) => { setOwnerType(e.target.value); setOwnerId(null); }}
          >
            <option value="">Без владельца</option>
            <option value="being">Существо</option>
            <option value="community">Сообщество</option>
          </select>
        </label>
        {ownerType === "being" && (
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Существо</span>
            <select value={ownerId ?? ""} onChange={(e) => setOwnerId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {beings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        {ownerType === "community" && (
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Сообщество</span>
            <select value={ownerId ?? ""} onChange={(e) => setOwnerId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose}>Отмена</button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Tile ─── */

const ArtifactTile = memo(function ArtifactTile({
  artifact,
  onOpenCard,
  onContextMenu,
}: {
  artifact: Artifact;
  onOpenCard: (id: number) => void;
  onContextMenu: (e: React.MouseEvent, artifact: Artifact) => void;
}) {
  const meta = metaLine(artifact);
  const loc = artifact.location?.name ?? "";
  return (
    <article
      className="monster-tile"
      title="ЛКМ — карточка, ПКМ — меню"
    >
      <header className="monster-tile__band">
        <span className="monster-tile__name">{artifact.name || "Без названия"}</span>
      </header>
      <div className="monster-tile__body" onClick={() => onOpenCard(artifact.id)} onContextMenu={(e) => onContextMenu(e, artifact)}>
        {artifact.avatar_image_url ? (
          <img className="monster-tile__portrait" src={artifact.avatar_image_url} alt="" />
        ) : (
          <span
            className="monster-tile__monogram"
            style={{ ["--monogram-tone" as string]: `${monogramTone(meta)}` }}
            aria-hidden="true"
          >
            {monogramLetter(artifact.name)}
          </span>
        )}
        <div className="monster-tile__facts">
          {artifact.name_original && (
            <span className="monster-tile__en">{artifact.name_original}</span>
          )}
          <span className="monster-tile__meta">
            {meta}
            {loc ? ` · ${loc}` : ""}
          </span>
          {artifact.owner_entity && (
            <span className="monster-tile__cr">{artifact.owner_entity.name}</span>
          )}
        </div>
      </div>
      <footer className="monster-tile__actions" onClick={(ev) => ev.stopPropagation()}>
        <button type="button" onClick={() => onOpenCard(artifact.id)}>Карточка</button>
        <Link to={`/artifacts/${artifact.id}`}>Профиль</Link>
      </footer>
    </article>
  );
});

/* ─── Group ─── */

function ArtifactGroup({
  label,
  list,
  forceOpen,
  onOpenCard,
  onContextMenu,
}: {
  label: string;
  list: Artifact[];
  forceOpen: boolean;
  onOpenCard: (id: number) => void;
  onContextMenu: (e: React.MouseEvent, artifact: Artifact) => void;
}) {
  const key = `artifact-group-${label}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== "0");
  return (
    <details
      className="comp-category"
      open={forceOpen || open}
      onToggle={(e) => {
        if (forceOpen) return;
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        localStorage.setItem(key, next ? "1" : "0");
      }}
    >
      <summary className="comp-level-label chevron-summary">
        <NavIcon name="chevron" className="chevron-icon" />
        {label}{" "}
        <span
          className="muted"
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", fontWeight: 400 }}
        >
          · {list.length}
        </span>
      </summary>
      <div className="monster-grid">
        {list.map((a) => (
          <ArtifactTile key={a.id} artifact={a} onOpenCard={onOpenCard} onContextMenu={onContextMenu} />
        ))}
      </div>
    </details>
  );
}

/* ─── Grid ─── */

export function ArtifactTileGrid({
  artifacts,
  grouping,
  searchActive,
  dir = "asc",
  settingId,
  onCreate,
  onRefresh,
}: {
  artifacts: Artifact[];
  grouping: ArtifactGrouping;
  searchActive: boolean;
  dir?: "asc" | "desc";
  settingId: number;
  onCreate?: () => void;
  onRefresh?: () => void;
}) {
  const [cardId, setCardId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Artifact | null>(null);
  const [assigning, setAssigning] = useState<Artifact | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; artifact: Artifact } | null>(null);
  const navigate = useNavigate();
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();

  const groups = useMemo(
    () => groupArtifacts(artifacts, grouping, dir),
    [artifacts, grouping, dir]
  );

  function handleContextMenu(e: React.MouseEvent, artifact: Artifact) {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, artifact });
  }

  async function handleDelete(artifact: Artifact) {
    const ok = await confirm({ message: `Отправить «${artifact.name}» в архив?`, confirmLabel: "Архивировать", danger: true });
    if (!ok) return;
    await deleteWithUndo({
      entityName: artifact.name,
      deleteFn: () => api.del(`/artifacts/${artifact.id}`),
      restoreFn: async () => {
        await api.put(`/artifacts/${artifact.id}/restore`);
        onRefresh?.();
      },
    });
    onRefresh?.();
  }

  const menuItems: ContextMenuItem[] = ctx ? [
    { label: "Редактировать", onClick: () => setEditing(ctx.artifact) },
    { label: "Привязать к локации / существу", onClick: () => setAssigning(ctx.artifact) },
    { label: "Открыть карточку", onClick: () => setCardId(ctx.artifact.id) },
    { label: "Профиль", onClick: () => navigate(`/artifacts/${ctx.artifact.id}`) },
    { label: "Удалить", danger: true, onClick: () => handleDelete(ctx.artifact) },
  ] : [];

  return (
    <div className="stack" style={{ gap: 10 }}>
      {confirmDialog}
      {groups.map(([label, list]) => (
        <ArtifactGroup
          key={label}
          label={label}
          list={list}
          forceOpen={searchActive}
          onOpenCard={setCardId}
          onContextMenu={handleContextMenu}
        />
      ))}
      {onCreate && (
        <div className="monster-grid">
          <article
            className="monster-tile"
            onClick={onCreate}
            title="Создать предмет"
            style={{
              borderStyle: "dashed",
              background: "var(--paper-2)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 140,
            }}
          >
            <span style={{ fontSize: "var(--fs-h1)", color: "var(--muted)" }}>+</span>
          </article>
        </div>
      )}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          title={ctx.artifact.name}
          items={menuItems}
          onClose={() => setCtx(null)}
        />
      )}
      {cardId != null && (
        <Modal onClose={() => setCardId(null)}>
          <EntityPreviewContent type="artifact" id={cardId} onClose={() => setCardId(null)} />
        </Modal>
      )}
      {editing && (
        <ArtifactEditModal
          artifact={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { onRefresh?.(); setEditing(null); }}
        />
      )}
      {assigning && (
        <ArtifactAssignModal
          artifact={assigning}
          settingId={settingId}
          onClose={() => setAssigning(null)}
          onSaved={() => { onRefresh?.(); setAssigning(null); }}
        />
      )}
    </div>
  );
}
