import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { DETAIL_ROUTES } from "../entityTypes";
import { LOCATION_ROLE_LABELS, locationRoleIcon, locationRoleOf } from "../locationRoles";
import { plainMentions } from "../utils/plainMentions";
import { isSafeImageUrl } from "../utils/safeUrl";
import type { LocationContentItem, SettingLocation } from "../types";
import { MentionText } from "./mentions/MentionText";
import { NavIcon, type NavIconName } from "./NavIcons";

interface Named {
  id: number;
  name: string;
}
interface NestedNamed extends Named {
  location_names: string[];
}

/** Ответ `GET /setting-locations/:id?nested=1` в той части, что нужна карточке. */
export interface PlaceDetail extends SettingLocation {
  children: SettingLocation[];
  ancestors: Named[];
  content: LocationContentItem[];
  inhabitant_beings: Named[];
  nested_inhabitant_beings: NestedNamed[];
  inhabitant_communities: Named[];
  nested_inhabitant_communities: NestedNamed[];
  artifacts: (Named & { location_name: string | null })[];
}

const CONTENT_KINDS: { key: string; label: string; icon: NavIconName }[] = [
  { key: "secret", label: "Секрет", icon: "secret" },
  { key: "loot", label: "Лут", icon: "loot" },
  { key: "trap", label: "Ловушка", icon: "warning" },
  { key: "feature", label: "Особенность", icon: "spark" },
];

const WHO_LIMIT = 6;
const SPOT_LIMIT = 8;
// Описание длиннее этого сворачивается до четырёх строк с «ещё».
const DESC_CLAMP_CHARS = 240;

function routeFor(type: string, id: number): string | null {
  const base = (DETAIL_ROUTES as Record<string, string | undefined>)[type];
  return base ? `${base}/${id}` : null;
}

/**
 * Карточка места (решения 2026-09-11, §2): одна раскладка в Географии и в доке
 * пульта. Порядок блоков фиксированный — Мастер его выучивает и находит нужное
 * взглядом, — пустой блок не рисуется. Правка здесь только быстрая: строка
 * наполнения; всё остальное — на полной странице локации.
 */
export function PlaceCard({
  locationId,
  onPick,
  onAddChild,
}: {
  locationId: number;
  /** Переход к другому месту внутри проводника; без него — ссылки на страницы. */
  onPick?: (id: number) => void;
  onAddChild?: (id: number) => void;
}) {
  const { data: d, loading, error, reload } = useResource<PlaceDetail>(`/setting-locations/${locationId}?nested=1`);
  const run = useAction();
  const [descOpen, setDescOpen] = useState(false);
  const [whoAll, setWhoAll] = useState(false);
  const [spotsAll, setSpotsAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState("secret");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  if (loading) {
    return (
      <div className="place-card" aria-busy="true" aria-label="Загрузка карточки">
        <div className="place-card__scroll">
          <div className="search-skeleton-pulse" style={{ height: 26 }} />
          <div className="search-skeleton-pulse" style={{ height: 80 }} />
        </div>
      </div>
    );
  }
  if (error || !d) {
    return (
      <div className="place-card">
        <div className="place-card__scroll">
          <span className="muted">Не удалось загрузить место{error ? `: ${error}` : ""}</span>
          <button onClick={reload} style={{ alignSelf: "flex-start" }}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  async function addContent() {
    const clean = text.trim();
    if (!clean || saving) return;
    setSaving(true);
    const created = await run(() => write.post(`/setting-locations/${locationId}/content`, { kind, text: clean }), {
      affects: [{ kind: "location", id: locationId }],
      retry: false,
    });
    setSaving(false);
    if (created !== undefined) {
      setText("");
      setAdding(false);
    }
  }

  const role = locationRoleOf(d);
  const badge = [d.kind?.trim(), d.parent_id == null ? "Корень мира" : LOCATION_ROLE_LABELS[role]]
    .filter(Boolean)
    .join(" · ");
  const thumb = d.thumbnail_image_url || d.avatar_image_url;
  const safeThumb = thumb && isSafeImageUrl(thumb) ? thumb : null;
  const description = d.description?.trim() ?? "";
  const longDesc = description.length > DESC_CLAMP_CHARS;

  const who = [
    ...d.inhabitant_beings.map((b) => ({ key: `b${b.id}`, to: routeFor("being", b.id), name: b.name, where: "" })),
    ...d.inhabitant_communities.map((c) => ({ key: `c${c.id}`, to: routeFor("community", c.id), name: c.name, where: "" })),
    ...d.nested_inhabitant_beings.map((b) => ({
      key: `nb${b.id}`,
      to: routeFor("being", b.id),
      name: b.name,
      where: b.location_names.join(", "),
    })),
    ...d.nested_inhabitant_communities.map((c) => ({
      key: `nc${c.id}`,
      to: routeFor("community", c.id),
      name: c.name,
      where: c.location_names.join(", "),
    })),
  ];
  const shownWho = whoAll ? who : who.slice(0, WHO_LIMIT);
  const spots = d.children.filter((c) => locationRoleOf(c) === "spot");
  const shownSpots = spotsAll ? spots : spots.slice(0, SPOT_LIMIT);
  const showContent = d.content.length > 0 || adding;

  function placeLink(id: number, name: string, className?: string) {
    return onPick ? (
      <button type="button" className={className} onClick={() => onPick(id)} title={`Перейти: ${name}`}>
        {name}
      </button>
    ) : (
      <Link className={className} to={`/locations/${id}`}>
        {name}
      </Link>
    );
  }

  return (
    <div className="place-card">
      <div className="place-card__scroll">
        {safeThumb && <img src={safeThumb} alt="" className="place-card__hero" />}
        <div className="place-card__head">
          <div className="place-card__badge">
            <NavIcon name={locationRoleIcon(d)} />
            {badge}
          </div>
          <h2 className="place-card__name">{d.name}</h2>
          {d.ancestors.length > 0 && (
            <nav className="place-card__path" aria-label="Где находится">
              {d.ancestors.map((a, i) => (
                <span key={a.id} className="place-card__path-seg">
                  {i > 0 && <span aria-hidden="true">/ </span>}
                  {placeLink(a.id, a.name)}
                </span>
              ))}
            </nav>
          )}
        </div>

        {description && (
          <div className="stack" style={{ gap: 4 }}>
            <div className={`place-card__desc${longDesc && !descOpen ? " is-clamped" : ""}`}>
              <MentionText text={description} />
            </div>
            {longDesc && (
              <button type="button" className="place-card__more" onClick={() => setDescOpen((v) => !v)}>
                {descOpen ? "свернуть" : "ещё"}
              </button>
            )}
          </div>
        )}

        {who.length > 0 && (
          <section className="place-card__sec">
            <div className="place-card__sech">
              <span className="place-card__title">Кто здесь</span>
              <span className="place-card__count">{who.length}</span>
            </div>
            {shownWho.map((w) => (
              <div key={w.key} className="place-card__row">
                {w.to ? (
                  <Link className="place-card__row-name" to={w.to}>
                    {w.name}
                  </Link>
                ) : (
                  <span className="place-card__row-name">{w.name}</span>
                )}
                {w.where && <span className="place-card__note">({w.where})</span>}
              </div>
            ))}
            {who.length > WHO_LIMIT && (
              <button type="button" className="place-card__more" onClick={() => setWhoAll((v) => !v)}>
                {whoAll ? "свернуть" : `ещё ${who.length - WHO_LIMIT}`}
              </button>
            )}
          </section>
        )}

        {showContent && (
          <section className="place-card__sec">
            <div className="place-card__sech">
              <span className="place-card__title">Что здесь</span>
              {d.content.length > 0 && <span className="place-card__count">{d.content.length}</span>}
              {!adding && (
                <button type="button" className="place-card__add" onClick={() => setAdding(true)}>
                  <NavIcon name="plus" /> Добавить
                </button>
              )}
            </div>
            {d.content.map((c) => {
              const k = CONTENT_KINDS.find((x) => x.key === c.kind) ?? CONTENT_KINDS[3];
              return (
                <div key={c.id} className="place-card__row">
                  <NavIcon name={k.icon} />
                  <span className="place-card__tag">{k.label}</span>
                  <span className="place-card__text">{c.text}</span>
                </div>
              );
            })}
            {adding && (
              <div className="place-card__form">
                <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={saving} aria-label="Тип">
                  {CONTENT_KINDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <input
                  autoFocus
                  placeholder="Тайник под третьей плитой…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addContent();
                    if (e.key === "Escape") setAdding(false);
                  }}
                  disabled={saving}
                />
                <button className="primary" onClick={() => void addContent()} disabled={saving || !text.trim()}>
                  {saving ? "…" : "Добавить"}
                </button>
              </div>
            )}
          </section>
        )}

        {spots.length > 0 && (
          <section className="place-card__sec">
            <div className="place-card__sech">
              <span className="place-card__title">Точки</span>
              <span className="place-card__count">{spots.length}</span>
            </div>
            {shownSpots.map((s) => {
              const note = plainMentions(s.description ?? "").trim();
              return (
                <div key={s.id} className="place-card__row">
                  <NavIcon name="spot" />
                  {placeLink(s.id, s.name, "place-card__row-name")}
                  {note && <span className="place-card__note">{note}</span>}
                </div>
              );
            })}
            {spots.length > SPOT_LIMIT && (
              <button type="button" className="place-card__more" onClick={() => setSpotsAll((v) => !v)}>
                {spotsAll ? "свернуть" : `ещё ${spots.length - SPOT_LIMIT}`}
              </button>
            )}
          </section>
        )}

        {d.artifacts.length > 0 && (
          <section className="place-card__sec">
            <div className="place-card__sech">
              <span className="place-card__title">Артефакты здесь</span>
              <span className="place-card__count">{d.artifacts.length}</span>
            </div>
            {d.artifacts.map((a) => {
              const to = routeFor("artifact", a.id);
              return (
                <div key={a.id} className="place-card__row">
                  {to ? (
                    <Link className="place-card__row-name" to={to}>
                      {a.name}
                    </Link>
                  ) : (
                    <span className="place-card__row-name">{a.name}</span>
                  )}
                  {a.location_name && <span className="place-card__note">({a.location_name})</span>}
                </div>
              );
            })}
          </section>
        )}

        {!showContent && (
          <div className="place-card__quick">
            <button type="button" className="place-card__add" onClick={() => setAdding(true)}>
              <NavIcon name="plus" /> Что здесь
            </button>
          </div>
        )}
      </div>

      <div className="place-card__foot">
        <Link className="place-card__open" to={`/locations/${d.id}`}>
          Открыть локацию <NavIcon name="arrowRight" />
        </Link>
        {onAddChild && role !== "spot" && (
          <button type="button" onClick={() => onAddChild(d.id)}>
            <NavIcon name="plus" /> Вложенная
          </button>
        )}
      </div>
    </div>
  );
}
