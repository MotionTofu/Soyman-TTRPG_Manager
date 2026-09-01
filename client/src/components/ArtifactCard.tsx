import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "./Modal";
import { MentionText } from "./mentions/MentionText";
import type { ArtifactCardPayload } from "../types";

// Карточка предмета — быстрый взгляд (аналог CreatureCard). Показывает
// картинку, название, владельца, редкость и секции с описанием, секретом,
// историей и силой. Используется в докстанции, поповере и вкладке профиля.

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="creature-card__section">
      <button
        type="button"
        className={`creature-card__section-head${open ? " is-open" : ""}`}
        onClick={onToggle}
      >
        <span>{title}</span>
        <span className="creature-card__section-mark">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="creature-card__section-body">{children}</div>}
    </section>
  );
}

export function ArtifactCard({
  data,
  variant = "column",
  hideProfileButton,
  onClose,
  collapsed,
  onToggleCollapse,
}: {
  data: ArtifactCardPayload;
  variant?: "column" | "page";
  hideProfileButton?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [sectionsOpen, setSectionsOpen] = useState({
    secret: true,
    description: true,
    history: true,
    power: true,
  });
  const toggleSection = (key: keyof typeof sectionsOpen) =>
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const hasSecret = !!data.secret.trim();
  const hasDescription = !!data.description.trim();
  const hasHistory = !!data.history.trim();
  const hasPower = !!data.power.trim();
  const isEmpty = !hasSecret && !hasDescription && !hasHistory && !hasPower;

  const profilePath = `/artifacts/${data.id}`;
  const avatar = data.avatar_image_url ?? null;

  // Мета под заголовком: владелец + редкость
  const metaParts: string[] = [];
  if (data.owner) metaParts.push(data.owner);
  if (data.rarity) metaParts.push(data.rarity);
  if (data.requires_attunement) metaParts.push("Требует настройки");
  const meta = metaParts.join(" · ");

  return (
    <article className={`creature-card${variant === "page" ? " creature-card--page" : ""}`}>
      <header
        className={`creature-card__band${onToggleCollapse ? " is-clickable" : ""}`}
        onClick={onToggleCollapse}
        title={onToggleCollapse ? (collapsed ? "Развернуть" : "Свернуть") : undefined}
      >
        {avatar ? (
          <img className="creature-card__portrait" src={avatar} alt="" />
        ) : (
          <span className="creature-card__portrait creature-card__portrait--empty" />
        )}
        <div className="creature-card__title">
          <div className="creature-card__name">{data.name || "Без названия"}</div>
          {meta && <div className="creature-card__cr">{meta}</div>}
        </div>
        {onToggleCollapse && <span className="creature-card__mark">{collapsed ? "+" : "−"}</span>}
        {onClose && (
          <button
            type="button"
            className="creature-card__close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Убрать"
          >
            ✕
          </button>
        )}
      </header>

      {!collapsed && (data.item_class || data.item_type) && (
        <div className="creature-card__chips">
          {data.item_class && (
            <span className="creature-card__chip is-type">
              {data.item_class === "magic_item" ? "Магический предмет" : "Снаряжение"}
            </span>
          )}
          {data.item_type && <span className="creature-card__chip">{data.item_type}</span>}
        </div>
      )}

      {!collapsed && (data.location || data.owner_entity) && (
        <div className="creature-card__chips">
          {data.location && (
            <Link to={`/locations/${data.location.id}`} className="creature-card__chip">
              📍 {data.location.name}
            </Link>
          )}
          {data.owner_entity && (
            <Link
              to={`/${data.owner_entity.type === "being" ? "beings" : "communities"}/${data.owner_entity.id}`}
              className="creature-card__chip"
            >
              👤 {data.owner_entity.name}
            </Link>
          )}
        </div>
      )}

      {!collapsed && isEmpty && (
        <div className="creature-card__empty">
          Карточка не заполнена.{" "}
          <Link to={`${profilePath}?tab=${encodeURIComponent("Карточка предмета")}`}>Заполнить</Link>
        </div>
      )}

      {!collapsed && hasSecret && (
        <Section
          title="Секрет"
          open={sectionsOpen.secret}
          onToggle={() => toggleSection("secret")}
        >
          <div className="creature-card__secret">
            <MentionText text={data.secret} />
          </div>
        </Section>
      )}

      {!collapsed && hasDescription && (
        <Section
          title="Описание"
          open={sectionsOpen.description}
          onToggle={() => toggleSection("description")}
        >
          <div className="creature-card__prose">
            <MentionText text={data.description} />
          </div>
        </Section>
      )}

      {!collapsed && hasHistory && (
        <Section
          title="История"
          open={sectionsOpen.history}
          onToggle={() => toggleSection("history")}
        >
          <div className="creature-card__prose">
            <MentionText text={data.history} />
          </div>
        </Section>
      )}

      {!collapsed && hasPower && (
        <Section
          title="Сила / свойства"
          open={sectionsOpen.power}
          onToggle={() => toggleSection("power")}
        >
          <div className="creature-card__prose">
            <MentionText text={data.power} />
          </div>
        </Section>
      )}

      {!hideProfileButton && (
        <footer className="creature-card__actions">
          <Link className="creature-card__button" to={profilePath}>
            В профиль
          </Link>
        </footer>
      )}
    </article>
  );
}

// Обёртка, которая сама сходит за данными — ею пользуются все места, кроме
// вкладки профиля: там карточка соседствует с редактором и данные общие.
export function ArtifactCardLoader({
  id,
  hideProfileButton,
  onClose,
  collapsed,
  onToggleCollapse,
}: {
  id: number;
  hideProfileButton?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [data, setData] = useState<ArtifactCardPayload | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    api
      .get<ArtifactCardPayload>(`/artifacts/${id}/card`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (data === undefined) return <span className="muted">Загрузка…</span>;
  if (data === null) return <span className="muted">Не найдено.</span>;
  return (
    <ArtifactCard
      data={data}
      hideProfileButton={hideProfileButton}
      onClose={onClose}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
    />
  );
}
