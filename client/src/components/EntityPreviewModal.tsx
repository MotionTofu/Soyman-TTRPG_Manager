import { useState, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { entityLabel } from "../api/resolveEntity";
import { useCurrentUser } from "../api/currentUser";
import { addToBag, isBagItemType, removeItemsFromBag, useBag, type BagItem } from "../bag";
import { creatureCardQuery } from "../data/creatureCard";
import { isEntityKind } from "../data/entities";
import { useEntity, useResource } from "../data/hooks";
import { DETAIL_ROUTES, ENTITY_TYPE_SINGULAR } from "../entityTypes";
import { Modal } from "./Modal";
import { EntityTypeChip } from "./EntityTypeChip";
import { NavIcon } from "./NavIcons";
import { TypeGlyph } from "./TypeGlyph";
import { profileStyle } from "./profiles/ProfileParts";
import { MentionText } from "./mentions/MentionText";
import { normalizeDndCreature, DndCreatureView } from "./dnd/DndCreatureForm";
import { CreatureCard, CreatureCardLoader, type CreatureCardPayload } from "./CreatureCard";
import { ArtifactCard, ArtifactCardLoader } from "./ArtifactCard";
import { normalizeDndCharacter, DndCharacterView } from "./dnd/DndCharacterForm";
import type { ArtifactCardPayload, CompendiumEntry, DndCharacterData, DndCreatureData, Statblock } from "../types";
import "./entity-preview.css";

// Same pattern used everywhere else a file/resource preview needs to know
// if a URL is a directly-embeddable image (ResourcesSection.tsx).
// 5b: учтён хвост ?token / ?v=… (#583 в design_revision)
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)(\?|$)/i;

interface PreviewTarget {
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

function parseCreatureStatblock(content: string, name?: string): DndCreatureData {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(content || "{}");
  } catch {
    // Даже у повреждённого статблока остаётся доступна карточка существа.
  }
  return { ...normalizeDndCreature(parsed), ...(name ? { name } : {}) };
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
  playerSafe,
  hideProfileButton,
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
  // Взгляд игрока: без секретов/тактики в рендере и без кнопки в мастерский
  // профиль (см. CreatureCard). Секрет при этом вырезан ещё и на сервере.
  playerSafe?: boolean;
  hideProfileButton?: boolean;
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
        playerSafe={playerSafe}
        hideProfileButton={hideProfileButton}
      />
    );
  }
  if (type === "artifact") {
    return (
      <ArtifactCardLoader
        id={id}
        onClose={onClose}
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
      hideProfileButton={hideProfileButton}
    />
  );
}

function CreatureCardPreview({
  type,
  id,
  onClose,
  profileInNewWindow,
  statblockInline,
  collapsed,
  onToggleCollapse,
  playerSafe,
  hideProfileButton,
}: {
  type: string;
  id: number;
  onClose?: () => void;
  profileInNewWindow?: boolean;
  // Модалка меншена подменяет своё содержимое статблоком вместо второй
  // модалки поверх первой.
  statblockInline?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  playerSafe?: boolean;
  hideProfileButton?: boolean;
}) {
  const [shown, setShown] = useState<CreatureCardPayload | null>(null);
  if (shown?.statblock) {
    return (
      <div className="stack">
        <button type="button" className="comp-mini" onClick={() => setShown(null)}>
          ← Карточка
        </button>
        <DndCreatureView value={parseCreatureStatblock(shown.statblock.content)} />
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
      playerSafe={playerSafe}
      hideProfileButton={hideProfileButton}
    />
  );
}

function usePreviewDetail(type: string, id: number) {
  const kind = isEntityKind(type) ? type : null;
  const query = useEntity<Record<string, unknown>>(kind ?? "location", kind ? id : null);
  return query.loading ? undefined : query.data ?? null;
}

function detailPortrait(detail: Record<string, unknown> | null | undefined) {
  const avatar = detail?.avatar_image_url ?? detail?.thumbnail_image_url;
  return typeof avatar === "string" ? avatar : null;
}

function OtherEntityPreview(props: Omit<Parameters<typeof OtherEntityPreviewBody>[0], "detail">) {
  const detail = usePreviewDetail(props.type, props.id);
  return <OtherEntityPreviewBody {...props} detail={detail} />;
}

function OtherEntityPreviewBody({
  type,
  id,
  onClose,
  collapsed,
  onToggleCollapse,
  hideProfileButton,
  detail,
  inDialog,
  playerSafe,
}: {
  type: string;
  id: number;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  hideProfileButton?: boolean;
  detail: Record<string, unknown> | null | undefined;
  inDialog?: boolean;
  playerSafe?: boolean;
}) {
  const statblocks = useResource<Statblock[]>(type === "character" ? `/statblocks?owner_type=${type}&owner_id=${id}` : null);
  const statblock = statblocks.data?.find((s) => s.format === "dnd_character" || s.format === "dnd_creature");
  const name = detail ? String(detail.character_name ?? detail.name ?? "") : "";
  const avatar = detailPortrait(detail);

  return (
    <div className="stack">
      {/* Шапка сама и есть переключатель: в докстанции Мастер сворачивает
          карточку на ходу, и цель в 20 px рядом с крестиком — не то, во что
          попадают за столом. */}
      {!inDialog && <div
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
      </div>}

      {!collapsed && detail === undefined && <span className="muted">Загрузка…</span>}
      {!collapsed && detail === null && <span className="muted">Не найдено.</span>}

      {!collapsed && detail && (
        <div className="stack">
          {avatar && !inDialog && (
            <img src={avatar} alt="" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: "var(--card-radius)" }} />
          )}

          {type === "location" && (
            <>
              {!!detail.kind && <span className="muted">{String(detail.kind)}</span>}
              {inDialog && !!detail.description && <h3 className="entity-preview-label">Описание</h3>}
              <div className="reading-text"><MentionText text={String(detail.description ?? "")} /></div>
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
                <div className="reading-text"><MentionText text={String(detail.current_situation ?? "")} /></div>
                <div className="reading-text"><MentionText text={String(detail.backstory ?? "")} /></div>
              </>
            ))}

          {type === "resource" && (
            <>
              {typeof detail.file_url === "string" && IMAGE_EXT.test(detail.file_url.split(/[?#]/)[0]) && (
                <img src={detail.file_url} alt="" style={{ maxWidth: "100%", borderRadius: "var(--card-radius)" }} />
              )}
              <span className="muted">
                {[detail.type, detail.category].filter(Boolean).join(" · ")}
              </span>
              <div className="reading-text"><MentionText text={String(detail.notes ?? "")} /></div>
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

          {!["location", "character", "resource"].includes(type) && (
            <>
              {/* Универсальный фолбэк для остальных типов (campaign/setting/community/adventure/scene/session/setting_event/player/mastering).
                  Печатает первое непустое прозаическое поле; порядок отражает частоту использования. */}
              <div className="reading-text">
                {String(detail.description ?? "").trim() && <MentionText text={String(detail.description)} />}
                {String(detail.notes ?? "").trim() && <MentionText text={String(detail.notes)} />}
                {String(detail.content ?? "").trim() && <MentionText text={String(detail.content)} />}
                {String(detail.notes_text ?? "").trim() && <MentionText text={String(detail.notes_text)} />}
                {String(detail.current_situation ?? "").trim() && <MentionText text={String(detail.current_situation)} />}
                {String(detail.backstory ?? "").trim() && <MentionText text={String(detail.backstory)} />}
                {String(detail.history ?? "").trim() && <MentionText text={String(detail.history)} />}
                {!playerSafe && String(detail.secret ?? "").trim() && <MentionText text={String(detail.secret)} />}
              </div>
              {/* Сеттинг/кампания могут хранить system_name / status рядом с описанием */}
              {(type === "campaign" || type === "setting") && detail.system_name && (
                <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{String(detail.system_name)}</span>
              )}
              {(type === "community" || type === "location") && detail.kind && (
                <span className="muted">{String(detail.kind)}</span>
              )}
              {type === "setting_event" && detail.description != null && String(detail.description).trim() === "" && detail.title && (
                <span className="muted">{String(detail.title)}</span>
              )}
            </>
          )}
        </div>
      )}

      {!inDialog && !collapsed && !hideProfileButton && DETAIL_ROUTES[type] && (
        <Link to={`${DETAIL_ROUTES[type]}/${id}`} onClick={onClose}>
          Открыть полностью →
        </Link>
      )}
    </div>
  );
}

interface PreviewOptions extends PreviewTarget {
  initialView?: "card" | "statblock";
  source?: "map";
  returnFocusTo?: RefObject<HTMLElement | null>;
  article?: { entry: CompendiumEntry; label: string; content: ReactNode };
}

interface DialogOptions extends PreviewOptions {
  playerSafe: boolean;
  canUseBag: boolean;
  canOpenProfile: boolean;
}

function compendiumBagItem(entry: CompendiumEntry): BagItem {
  const ability = entry.data?.ability;
  return {
    type: "compendium_entry",
    id: entry.id,
    title: entry.name,
    kind: entry.kind,
    system_id: entry.system_id,
    section_id: entry.section_id,
    level: entry.level,
    ability: typeof ability === "string" ? ability : undefined,
  };
}

function PreviewBagButton({ item }: { item: BagItem }) {
  const { items } = useBag();
  const inBag = items.some((entry) => !entry.pdfQuote && entry.type === item.type && entry.id === item.id);
  return <button
    type="button"
    className={`d-btn d-btn--sm entity-preview-bag${inBag ? "" : " d-btn--primary"}`}
    aria-pressed={inBag}
    title={inBag ? "Убрать из мешка" : undefined}
    onClick={() => inBag ? removeItemsFromBag([item]) : addToBag(item)}
  >
    <NavIcon name="bag" /> {inBag ? "В мешке" : "В мешок"}
  </button>;
}

function PreviewDialog({
  type, id, onClose, source, returnFocusTo, canUseBag, canOpenProfile,
  name, label, portrait, bagItem, showingStatblock, onToggleStatblock, children,
}: DialogOptions & {
  name?: string;
  label?: string;
  portrait?: string | null;
  bagItem?: BagItem;
  showingStatblock?: boolean;
  onToggleStatblock?: () => void;
  children: ReactNode;
}) {
  const typeName = label ?? (type === "compendium_entry" ? "Запись справочника" : type === "artifact" ? "Предмет" : ENTITY_TYPE_SINGULAR[type] ?? "Карточка");
  const route = name && canOpenProfile && !showingStatblock && DETAIL_ROUTES[type];
  const bag = canUseBag && bagItem && isBagItemType(bagItem.type) ? bagItem : null;
  return <Modal
    className={`entity-preview-modal${source === "map" ? " workspace-editor-label-dialog" : ""}`}
    style={profileStyle(type)}
    ariaLabel={name || typeName}
    onClose={onClose}
    returnFocusTo={returnFocusTo}
  >
    <header className="entity-preview-head">
      <span className="entity-preview-portrait" aria-hidden="true">
        {portrait ? <img src={portrait} alt="" /> : <TypeGlyph type={type} />}
      </span>
      <div>
        {name && <div className="entity-preview-label">
          {showingStatblock ? "Статблок" : typeName}{source === "map" && " · Источник на карте"}
        </div>}
        <h2>{name || typeName}</h2>
      </div>
    </header>
    <div className={`entity-preview-content${showingStatblock ? " entity-preview-statblock" : ""}`} key={showingStatblock ? "statblock" : "card"}>{children}</div>
    {(route || onToggleStatblock || bag) && <footer className="entity-preview-actions">
      {route && <Link className="d-btn d-btn--sm" to={`${route}/${id}`} onClick={onClose}>Профиль →</Link>}
      {onToggleStatblock && <button type="button" className="d-btn d-btn--sm" onClick={onToggleStatblock}>
        {showingStatblock ? "← Карточка" : "Статблок"}
      </button>}
      {bag && <PreviewBagButton item={bag} />}
    </footer>}
  </Modal>;
}

function CreaturePreviewDialog(props: DialogOptions) {
  const { type, id, initialView, canUseBag, canOpenProfile, playerSafe } = props;
  const query = useQuery(creatureCardQuery(type, id));
  const entry = useEntity<CompendiumEntry>("compendium_entry", canUseBag && type === "compendium_entry" ? id : null).data;
  const [showStatblock, setShowStatblock] = useState(initialView === "statblock");
  const data = query.data;
  const statblock = data?.statblock;
  const showingStatblock = showStatblock && !!statblock;
  const name = data ? data.name || "Без названия" : undefined;
  const bagItem = entry ? compendiumBagItem(entry) : name && type === "being" ? { type, id, title: name } : undefined;
  let body = <span className="muted">{query.isPending ? "Загрузка…" : "Не найдено."}</span>;
  if (showingStatblock && data) {
    body = <DndCreatureView value={parseCreatureStatblock(statblock.content, data.statblock_inherited ? name : undefined)} />;
  } else if (data) {
    body = <CreatureCard data={data} inDialog hideProfileButton={!canOpenProfile} playerSafe={playerSafe} />;
  }
  return <PreviewDialog
    {...props}
    name={name}
    label={entry?.kind === "monster" ? "Бестиарий" : undefined}
    portrait={data?.avatar_image_url}
    bagItem={bagItem}
    showingStatblock={showingStatblock}
    onToggleStatblock={statblock ? () => setShowStatblock((open) => !open) : undefined}
  >{body}</PreviewDialog>;
}

function ArtifactPreviewDialog(props: DialogOptions) {
  const { type, id, canOpenProfile } = props;
  const query = useResource<ArtifactCardPayload>(`/artifacts/${id}/card`);
  const data = query.data;
  const name = data ? data.name || "Без названия" : undefined;
  return <PreviewDialog {...props} name={name} portrait={data?.avatar_image_url} bagItem={name ? { type, id, title: name } : undefined}>
    {data ? <ArtifactCard data={data} inDialog hideProfileButton={!canOpenProfile} /> : <span className="muted">{query.loading ? "Загрузка…" : "Не найдено."}</span>}
  </PreviewDialog>;
}

function OtherPreviewDialog(props: DialogOptions) {
  const { type, id, playerSafe } = props;
  const detail = usePreviewDetail(type, id);
  const name = detail ? entityLabel(type, id, detail) || "Без названия" : undefined;
  return <PreviewDialog {...props} name={name} portrait={detailPortrait(detail)} bagItem={name ? { type, id, title: name } : undefined}>
    <OtherEntityPreviewBody type={type} id={id} detail={detail} inDialog playerSafe={playerSafe} />
  </PreviewDialog>;
}

export function EntityPreviewModal(props: PreviewOptions) {
  const { type, id, source, article } = props;
  const { user } = useCurrentUser();
  const gm = user?.role === "gm";
  const options = { ...props, playerSafe: user?.role === "player", canUseBag: gm, canOpenProfile: gm && source !== "map" };
  const key = `${type}:${id}`;
  if (article && gm) {
    const { entry, label, content } = article;
    return <PreviewDialog key={key} {...options} name={entry.name || "Без названия"} label={label} portrait={entry.avatar_image_url} bagItem={compendiumBagItem(entry)}>
      {content}
    </PreviewDialog>;
  }
  if (type === "being" || type === "compendium_entry") return <CreaturePreviewDialog key={key} {...options} />;
  if (type === "artifact") return <ArtifactPreviewDialog key={key} {...options} />;
  return <OtherPreviewDialog key={key} {...options} />;
}
