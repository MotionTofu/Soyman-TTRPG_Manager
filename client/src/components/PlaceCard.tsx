import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { DETAIL_ROUTES } from "../entityTypes";
import { LOCATION_ROLE_LABELS, locationRoleIcon, locationRoleOf } from "../locationRoles";
import { PARTY_PLACE_CHANGED, type PartyPlaceView } from "../partyPlaceEvents";
import { plainMentions } from "../utils/plainMentions";
import { isSafeImageUrl } from "../utils/safeUrl";
import type { LocationContentItem, SettingLocation } from "../types";
import { EntityTypeChip } from "./EntityTypeChip";
import { MentionText } from "./mentions/MentionText";
import { NavIcon, type NavIconName } from "./NavIcons";
import { PlaceExitForm } from "./PlaceExitForm";
import { useConfirm } from "../hooks/useConfirm";
import { sessionLabel } from "../sessionLabel";

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
  exits: PlaceExit[];
}

/** Выход, как его видит это место: out — начинается здесь, in — двусторонний сюда. */
export interface PlaceExit {
  id: number;
  direction: "out" | "in";
  other_id: number;
  other_name: string;
  other_role: string;
  other_parent_name: string | null;
  how: string;
  travel_time: string;
  one_way: number;
  secret: number;
  note: string;
}

/** Ответ `GET /setting-locations/:id/history` (server/src/services/placeHistory.ts). */
export interface PlaceHistory {
  ahead: {
    campaign_id: number;
    campaign_name: string;
    scene_id: number;
    scene_name: string;
    place_name: string | null;
    /** Последний запуск в сессиях кампании: прогон или игра — решает отметка. */
    launched_at: string | null;
  }[];
  ahead_total: number;
  visits: {
    session_id: number;
    campaign_id: number;
    campaign_name: string;
    date: string;
    title: string | null;
    status: string;
    session_number: number;
    reasons: ("scene" | "panel" | "mention")[];
  }[];
  visits_total: number;
}

const REASON_LABEL: Record<string, string> = { scene: "сцена", panel: "пульт", mention: "упоминание" };

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

/** «2026-08-29» → «29.08»; чужой год — с годом. */
function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return m[1] === String(new Date().getFullYear()) ? `${m[3]}.${m[2]}` : `${m[3]}.${m[2]}.${m[1].slice(2)}`;
}

/**
 * Карточка места (решения 2026-09-11, §2): одна раскладка в Географии и в доке
 * пульта. Порядок блоков фиксированный — Мастер его выучивает и находит нужное
 * взглядом, — пустой блок не рисуется. Правка здесь только быстрая: строка
 * наполнения и выход; всё остальное — на полной странице локации. Удаление
 * выхода тоже здесь: другого места для него пока нет.
 *
 * `panel` — правая панель проводника: крупное имя, «Вложенная». `dock` —
 * докстанция пульта: заголовок — плашка дока (сворачивает), путь без корня,
 * «Мы здесь», история только кампании сессии.
 */
export function PlaceCard({
  locationId,
  variant = "panel",
  onPick,
  onAddChild,
  partyCampaigns,
  sessionId = null,
  collapsed = false,
  onToggleCollapse,
  onClose,
}: {
  locationId: number;
  variant?: "panel" | "dock";
  /** Переход к другому месту; без него — ссылки на страницы. */
  onPick?: (id: number) => void;
  onAddChild?: (id: number) => void;
  /** География: кампании, чья партия стоит ровно здесь. */
  partyCampaigns?: string[];
  /** Док: сессия пульта — для «Мы здесь» и истории своей кампании. */
  sessionId?: number | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onClose?: () => void;
}) {
  const dock = variant === "dock";
  const { data: d, loading, error, reload } = useResource<PlaceDetail>(`/setting-locations/${locationId}?nested=1`);
  const { data: session } = useResource<{ campaign_id: number }>(dock && sessionId ? `/sessions/${sessionId}` : null);
  const { data: party } = useResource<PartyPlaceView>(dock && sessionId ? `/sessions/${sessionId}/party-place` : null);
  const campaignId = session?.campaign_id ?? null;
  const run = useAction();
  const [descOpen, setDescOpen] = useState(false);
  const [whoAll, setWhoAll] = useState(false);
  const [spotsAll, setSpotsAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState("secret");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingExit, setAddingExit] = useState(false);
  const [marking, setMarking] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [historyAll, setHistoryAll] = useState(false);
  const [passing, setPassing] = useState<number | null>(null);
  // В доке история — только кампании сессии; пока кампания неизвестна, не
  // читаем вовсе, иначе на миг мелькнёт чужая.
  const historyParams = new URLSearchParams();
  if (dock && campaignId != null) historyParams.set("campaign_id", String(campaignId));
  if (historyAll) historyParams.set("all", "1");
  const historyQuery = historyParams.toString();
  const historyPath =
    dock && sessionId && campaignId == null
      ? null
      : `/setting-locations/${locationId}/history${historyQuery ? `?${historyQuery}` : ""}`;
  const { data: history } = useResource<PlaceHistory>(collapsed ? null : historyPath);

  const partyHere = dock ? party?.location?.id === locationId : (partyCampaigns?.length ?? 0) > 0;

  // Плашка дока рисуется и до загрузки: свернуть и закрыть карточку должно
  // быть можно всегда.
  const plate = dock ? (
    <div
      className="place-card__plate preview-head-clickable"
      onClick={onToggleCollapse}
      title={onToggleCollapse ? (collapsed ? "Развернуть" : "Свернуть") : undefined}
    >
      <EntityTypeChip type="location" />
      <strong className="place-card__plate-name">{d?.name ?? "…"}</strong>
      {partyHere && <NavIcon name="flag" />}
      {onToggleCollapse && <span className="muted">{collapsed ? "+" : "−"}</span>}
      {onClose && (
        <button
          type="button"
          className="comp-mini"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Убрать из дока"
        >
          ✕
        </button>
      )}
    </div>
  ) : null;

  if (dock && collapsed) {
    return <div className="place-card place-card--dock">{plate}</div>;
  }
  if (loading) {
    return (
      <div className={`place-card${dock ? " place-card--dock" : ""}`} aria-busy="true" aria-label="Загрузка карточки">
        {plate}
        <div className="place-card__scroll">
          <div className="search-skeleton-pulse" style={{ height: 26 }} />
          <div className="search-skeleton-pulse" style={{ height: 80 }} />
        </div>
      </div>
    );
  }
  if (error || !d) {
    return (
      <div className={`place-card${dock ? " place-card--dock" : ""}`}>
        {plate}
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
  const safeThumb = !dock && thumb && isSafeImageUrl(thumb) ? thumb : null;
  const description = d.description?.trim() ?? "";
  const longDesc = description.length > DESC_CLAMP_CHARS;
  // В доке узко: корень мира в пути — лишний, он и так один на кампанию.
  const pathShown = dock ? d.ancestors.slice(1) : d.ancestors;

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
  const showExits = d.exits.length > 0 || addingExit;

  const removeExit = async (e: PlaceExit) => {
    const ok = await confirm({
      title: "Удалить выход?",
      message: `«${d.name}» — «${e.other_name}»${e.how ? ` (${e.how})` : ""}. Выход пропадёт с обоих концов.`,
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    await run(() => write.del(`/setting-locations/exits/${e.id}`), {
      affects: [
        { kind: "location", id: locationId },
        { kind: "location", id: e.other_id },
      ],
    });
  };

  // «Пройдена» у запускавшейся сцены: запуск бывает прогоном пульта, поэтому
  // сам по себе сцену не закрывает — Мастер отмечает сыгранное одним нажатием.
  const markPassed = async (sceneId: number, sceneCampaignId: number) => {
    if (passing != null) return;
    setPassing(sceneId);
    await run(() => write.put(`/story/scenes/${sceneId}/state`, { campaign_id: sceneCampaignId, status: "done" }), {
      affects: [
        { kind: "location", id: locationId },
        { kind: "scene", id: sceneId },
      ],
      retry: false,
    });
    setPassing(null);
  };

  const markHere = async () => {
    if (!sessionId || marking) return;
    setMarking(true);
    const done = await run(() => write.put(`/sessions/${sessionId}/party-place`, { location_id: d.id }), {
      affects: [
        { path: `/sessions/${sessionId}/party-place` },
        { path: `/settings/${d.setting_id}/party-places` },
        { kind: "location", id: d.id },
      ],
      retry: false,
    });
    setMarking(false);
    // Панели пульта читают себя сами — место легло в «Локации» сессии.
    if (done !== undefined) window.dispatchEvent(new CustomEvent(PARTY_PLACE_CHANGED, { detail: { sessionId } }));
  };

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
    <div className={`place-card${dock ? " place-card--dock" : ""}`}>
      {confirmDialog}
      {plate}
      <div className="place-card__scroll">
        {safeThumb && <img src={safeThumb} alt="" className="place-card__hero" />}
        {dock ? (
          (pathShown.length > 0 || d.kind?.trim()) && (
            <div className="place-card__path">
              {pathShown.map((a, i) => (
                <span key={a.id} className="place-card__path-seg">
                  {i > 0 && <span aria-hidden="true">/ </span>}
                  {placeLink(a.id, a.name)}
                </span>
              ))}
              {d.kind?.trim() && <span className="place-card__tag place-card__end">{d.kind}</span>}
            </div>
          )
        ) : (
          <div className="place-card__head">
            <div className="place-card__badge">
              <NavIcon name={locationRoleIcon(d)} />
              {badge}
            </div>
            <h2 className="place-card__name">{d.name}</h2>
            {pathShown.length > 0 && (
              <nav className="place-card__path" aria-label="Где находится">
                {pathShown.map((a, i) => (
                  <span key={a.id} className="place-card__path-seg">
                    {i > 0 && <span aria-hidden="true">/ </span>}
                    {placeLink(a.id, a.name)}
                  </span>
                ))}
              </nav>
            )}
          </div>
        )}

        {!dock && partyHere && (
          <div className="place-card__party">
            <NavIcon name="flag" />
            <span>
              <strong>Партия здесь</strong> · {partyCampaigns!.join(", ")}
            </span>
          </div>
        )}

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

        {showExits && (
          <section className="place-card__sec">
            <div className="place-card__sech">
              <span className="place-card__title">Выходы</span>
              {d.exits.length > 0 && <span className="place-card__count">{d.exits.length}</span>}
              {!addingExit && (
                <button type="button" className="place-card__add" onClick={() => setAddingExit(true)}>
                  <NavIcon name="plus" /> Добавить
                </button>
              )}
            </div>
            {d.exits.map((e) => (
              <div key={e.id} className="place-card__row" title={e.note || undefined}>
                <NavIcon name={e.one_way ? "arrowRight" : "twoWay"} />
                {placeLink(e.other_id, e.other_name, "place-card__row-name")}
                {e.how && <span className="place-card__note">{e.how}</span>}
                {e.travel_time || e.secret ? (
                  <span className="place-card__end">
                    {e.travel_time ? <span className="place-card__time">{e.travel_time}</span> : null}
                    {e.secret ? <span className="place-card__tag">тайный</span> : null}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="comp-mini place-card__row-del"
                  onClick={() => void removeExit(e)}
                  aria-label={`Удалить выход: ${e.other_name}`}
                  title="Удалить выход"
                >
                  ✕
                </button>
              </div>
            ))}
            {addingExit && (
              <PlaceExitForm settingId={d.setting_id} fromId={d.id} onClose={() => setAddingExit(false)} />
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

        {history && (history.ahead.length > 0 || history.visits.length > 0) && (
          <section className="place-card__sec">
            <div className="place-card__sech">
              <span className="place-card__title">Что здесь было</span>
            </div>
            {(() => {
              // Название кампании — только когда их здесь больше одной.
              const manyCampaigns =
                new Set([...history.ahead, ...history.visits].map((x) => x.campaign_id)).size > 1;
              const more =
                historyAll || history.ahead_total > history.ahead.length || history.visits_total > history.visits.length;
              return (
                <>
                  {history.ahead.length > 0 && <div className="place-card__sub">Впереди</div>}
                  {history.ahead.map((a) => {
                    // Сцена комнаты часто названа как комната («1. Гостевая
                    // книга») — подпись места тогда повторяла бы имя.
                    const where =
                      a.place_name && !a.scene_name.toLocaleLowerCase("ru").includes(a.place_name.toLocaleLowerCase("ru"))
                        ? `(${a.place_name})`
                        : null;
                    const note = [where, manyCampaigns ? a.campaign_name : null].filter(Boolean).join(" · ");
                    return (
                      <div
                        key={`${a.campaign_id}-${a.scene_id}`}
                        className={`place-card__row${a.launched_at ? " place-card__row--wrap" : ""}`}
                      >
                        <NavIcon name="play" />
                        <Link className="place-card__row-name" to={`/scenes/${a.scene_id}?campaign=${a.campaign_id}`}>
                          {a.scene_name}
                        </Link>
                        {note && <span className="place-card__note">{note}</span>}
                        {a.launched_at && (
                          <span className="place-card__end">
                            <span
                              className="place-card__time"
                              title="Сцену уже запускали на пульте — если это была игра, а не прогон, отметьте пройденной"
                            >
                              запускалась {shortDate(a.launched_at)}
                            </span>
                            <button
                              type="button"
                              className="comp-mini"
                              onClick={() => void markPassed(a.scene_id, a.campaign_id)}
                              disabled={passing != null}
                              title="Отметить сцену пройденной в кампании"
                            >
                              <NavIcon name="check" /> {passing === a.scene_id ? "…" : "пройдена"}
                            </button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {history.visits.length > 0 && <div className="place-card__sub">Было</div>}
                  {history.visits.map((v) => (
                    <div key={v.session_id} className="place-card__row">
                      <span className="place-card__date">{shortDate(v.date)}</span>
                      <Link className="place-card__row-name" to={`/sessions/${v.session_id}`}>
                        {sessionLabel(v)}
                      </Link>
                      {manyCampaigns && <span className="place-card__note">{v.campaign_name}</span>}
                      <span className="place-card__end">
                        <span className="place-card__time">{v.reasons.map((r) => REASON_LABEL[r] ?? r).join(", ")}</span>
                      </span>
                    </div>
                  ))}
                  {more && (
                    <button type="button" className="place-card__more" onClick={() => setHistoryAll((v) => !v)}>
                      {historyAll ? "свернуть" : "все"}
                    </button>
                  )}
                </>
              );
            })()}
          </section>
        )}

        {(!showContent || !showExits) && (
          <div className="place-card__quick">
            {!showContent && (
              <button type="button" className="place-card__add" onClick={() => setAdding(true)}>
                <NavIcon name="plus" /> Что здесь
              </button>
            )}
            {!showExits && (
              <button type="button" className="place-card__add" onClick={() => setAddingExit(true)}>
                <NavIcon name="plus" /> Выход
              </button>
            )}
          </div>
        )}
      </div>

      {dock ? (
        <div className="place-card__foot">
          {sessionId != null && (
            <button
              type="button"
              className="primary"
              onClick={() => void markHere()}
              disabled={marking || partyHere}
              title={partyHere ? "Партия уже здесь" : "Отметить: партия пришла сюда"}
            >
              <NavIcon name="flag" /> {partyHere ? "Партия здесь" : marking ? "…" : "Мы здесь"}
            </button>
          )}
          {/* Уход в профиль сбрасывает док вместе с живой сессией — поэтому
              отсюда полная страница открывается новым окном. */}
          <a className="place-card__open-link" href={`/locations/${d.id}`} target="_blank" rel="noreferrer">
            Открыть полностью →
          </a>
        </div>
      ) : (
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
      )}
    </div>
  );
}
