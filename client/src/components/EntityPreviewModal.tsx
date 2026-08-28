import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { fetchEntityDetail } from "../api/resolveEntity";
import { DETAIL_ROUTES } from "../entityTypes";
import { Modal } from "./Modal";
import { EntityTypeChip } from "./EntityTypeChip";
import { MentionText } from "./mentions/MentionText";
import { normalizeDndCreature, DndCreatureView } from "./dnd/DndCreatureForm";
import { CreatureCardLoader, fetchCreatureCard, type CreatureCardPayload } from "./CreatureCard";
import { normalizeDndCharacter, DndCharacterView } from "./dnd/DndCharacterForm";
import type { DndCharacterData, DndCreatureData, Statblock } from "../types";

// Same pattern used everywhere else a file/resource preview needs to know
// if a URL is a directly-embeddable image (ResourceCard.tsx, ResourcesSection.tsx).
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;

interface Props {
  type: string;
  id: number;
  onClose: () => void;
}

export function parseDndStatblock(statblock: Statblock): DndCharacterData | DndCreatureData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(statblock.content || "{}");
  } catch {
    parsed = {};
  }
  return statblock.format === "dnd_character" ? normalizeDndCharacter(parsed) : normalizeDndCreature(parsed);
}

// Shared by the modal below and PreviewDock (the session-pult docking
// panel) — same fetch + body rendering, just without the Modal chrome so
// the caller can place it inline in a card instead of an overlay.
//
// Существо и запись бестиария показываются карточкой существа (шаг 4
// ревизии) — единым быстрым взглядом вместо прежнего мини-статблока,
// который печатал все черты, действия и легендарные подряд.
export function EntityPreviewContent({
  type,
  id,
  onClose,
  profileInNewWindow,
  statblockInline,
  collapsed,
  onToggleCollapse,
}: {
  type: string;
  id: number;
  onClose?: () => void;
  // Док пульта уводит из живой сессии — профиль оттуда открывается новым окном.
  profileInNewWindow?: boolean;
  // Модалка меншена подменяет своё содержимое статблоком вместо второй
  // модалки поверх первой.
  statblockInline?: boolean;
  // Свёрнутость карточки в докстанции: там их несколько в одной колонке.
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  if (type === "being" || type === "compendium_entry") {
    return (
      <CreatureCardPreview
        type={type}
        id={id}
        onClose={onClose}
        profileInNewWindow={profileInNewWindow}
        statblockInline={statblockInline}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
      />
    );
  }
  return (
    <OtherEntityPreview
      type={type}
      id={id}
      onClose={onClose}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
    />
  );
}

export function CreatureCardPreview({
  type,
  id,
  onClose,
  profileInNewWindow,
  statblockInline,
  autoShowStatblock,
  collapsed,
  onToggleCollapse,
}: {
  type: string;
  id: number;
  onClose?: () => void;
  profileInNewWindow?: boolean;
  statblockInline?: boolean;
  // Плитка бестиария открывает статблок отдельной кнопкой, минуя карточку.
  // Существо без статблока при этом остаётся на карточке: она и объясняет,
  // что заполнить, — вместо модалки, которая открылась пустой.
  autoShowStatblock?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [shown, setShown] = useState<CreatureCardPayload | null>(null);
  useEffect(() => {
    if (!autoShowStatblock) return;
    let cancelled = false;
    fetchCreatureCard(type, id)
      .then((d) => {
        if (!cancelled && d.statblock) setShown(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [autoShowStatblock, type, id]);
  if (shown?.statblock) {
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(shown.statblock.content || "{}");
    } catch {
      parsed = {};
    }
    return (
      <div className="stack">
        <button type="button" className="comp-mini" onClick={() => setShown(null)}>
          ← Карточка
        </button>
        <DndCreatureView value={normalizeDndCreature(parsed)} />
      </div>
    );
  }
  return (
    <CreatureCardLoader
      type={type}
      id={id}
      onClose={onClose}
      profileInNewWindow={profileInNewWindow}
      onShowStatblock={statblockInline ? setShown : undefined}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
    />
  );
}

function OtherEntityPreview({
  type,
  id,
  onClose,
  collapsed,
  onToggleCollapse,
}: {
  type: string;
  id: number;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [detail, setDetail] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [statblock, setStatblock] = useState<Statblock | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setStatblock(null);
    fetchEntityDetail(type, id).then((d) => {
      if (!cancelled) setDetail(d);
    });
    if (type === "character") {
      api
        .get<Statblock[]>(`/statblocks?owner_type=${type}&owner_id=${id}`)
        .then((rows) => {
          if (cancelled) return;
          const dnd = rows.find((s) => s.format === "dnd_character" || s.format === "dnd_creature");
          if (dnd) setStatblock(dnd);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  const name = detail ? String(detail.character_name ?? detail.name ?? "") : "";
  const avatar = detail ? ((detail.avatar_image_url ?? detail.thumbnail_image_url) as string | null) : null;

  return (
    <div className="stack">
      {/* Шапка сама и есть переключатель: в докстанции Мастер сворачивает
          карточку на ходу, и цель в 20 px рядом с крестиком — не то, во что
          попадают за столом. */}
      <div
        className={`row${onToggleCollapse ? " preview-head-clickable" : ""}`}
        style={{ justifyContent: "space-between", alignItems: "flex-start" }}
        onClick={onToggleCollapse}
        title={onToggleCollapse ? (collapsed ? "Развернуть" : "Свернуть") : undefined}
      >
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <EntityTypeChip type={type} />
          <strong>{name}</strong>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {onToggleCollapse && <span className="muted">{collapsed ? "+" : "−"}</span>}
          {onClose && (
            <button
              type="button"
              className="comp-mini"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {!collapsed && detail === undefined && <span className="muted">Загрузка…</span>}
      {!collapsed && detail === null && <span className="muted">Не найдено.</span>}

      {!collapsed && detail && (
        <div className="stack">
          {avatar && (
            <img src={avatar} alt="" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: "var(--card-radius)" }} />
          )}

          {type === "location" && (
            <>
              {!!detail.kind && <span className="muted">{String(detail.kind)}</span>}
              <MentionText text={String(detail.description ?? "")} />
            </>
          )}

          {type === "character" &&
            (statblock ? (
              <DndCharacterView
                value={parseDndStatblock(statblock) as DndCharacterData}
                compact
              />
            ) : (
              <>
                <MentionText text={String(detail.current_situation ?? "")} />
                <MentionText text={String(detail.backstory ?? "")} />
              </>
            ))}

          {type === "resource" && (
            <>
              {typeof detail.file_url === "string" && IMAGE_EXT.test(detail.file_url) && (
                <img src={detail.file_url} alt="" style={{ maxWidth: "100%", borderRadius: "var(--card-radius)" }} />
              )}
              <span className="muted">
                {[detail.type, detail.category].filter(Boolean).join(" · ")}
              </span>
              <MentionText text={String(detail.notes ?? "")} />
              {Array.isArray(detail.tags) && detail.tags.length > 0 && (
                <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                  {(detail.tags as string[]).map((t) => (
                    <span key={t} className="badge planned">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {type === "artifact" && (
            <>
              <span className="muted">
                {[detail.owner, detail.power].filter(Boolean).join(" · ")}
              </span>
              <MentionText text={String(detail.history ?? "")} />
              <MentionText text={String(detail.notes ?? "")} />
            </>
          )}
        </div>
      )}

      {!collapsed && DETAIL_ROUTES[type] && (
        <Link to={`${DETAIL_ROUTES[type]}/${id}`} onClick={onClose}>
          Открыть полностью →
        </Link>
      )}
    </div>
  );
}

// The one integration point this feeds today is SectionDropZone — clicking
// an entity row opens this instead of navigating straight away, with a
// "открыть полностью" escape hatch at the bottom for anyone who wants the
// real page. Deliberately scoped to the 5 kinds SectionDropZone actually
// uses (location/being/character/resource/artifact) — other places entities
// are linked (SearchPanel, MentionText, etc.) still navigate directly.
export function EntityPreviewModal({ type, id, onClose }: Props) {
  return (
    <Modal onClose={onClose}>
      <EntityPreviewContent type={type} id={id} onClose={onClose} statblockInline />
    </Modal>
  );
}
