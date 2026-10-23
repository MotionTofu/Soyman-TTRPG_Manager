import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import { labelled } from "../../data/notices";
import { campaignPaths } from "../../data/campaigns";
import { mentionTone } from "../../mentions";
import { BEING_CATEGORY_LABELS } from "../../beingCategories";
import { recordSummary } from "../../entityRecords";
import { sessionLabel } from "../../sessionLabel";
import { formatDateKeyRu } from "../../utils/date";
import { WORLD_GROUPS as GROUPS, WORLD_TYPES, useSetCampaignEntityState, type CampaignWorld, type WorldEntity, type WorldType } from "../../campaignWorld";
import { CampaignWorldRow } from "./CampaignWorldRow";
import { RecordFormModal } from "../records/RecordFormModal";
import { TypeGlyph } from "../TypeGlyph";
import { NavIcon } from "../NavIcons";
import "./campaign-world.css";
import { EmptyState } from "../EmptyState";
import { MentionPickerModal } from "../mentions/MentionPickerModal";
import type { SessionSummary } from "../../types";

export type { CampaignWorld, WorldEntity, WorldType } from "../../campaignWorld";

// «Мир кампании» (ADR-0006, спека .scratch/campaign-layer, задача 03):
// сущности сеттинга, задействованные в кампании, — по видам, со сводкой
// записей. Задействована не значит показана игрокам: это «Выдача».

const SETTING_LISTS: Record<WorldType, (settingId: number) => string> = {
  being: (id) => `/setting-beings?setting_id=${id}`,
  community: (id) => `/setting-communities?setting_id=${id}`,
  location: (id) => `/setting-locations?setting_id=${id}`,
  artifact: (id) => `/artifacts?setting_id=${id}`,
};

type Filter = "rumor" | "draft" | null;

/**
 * `types` — только эти виды (листы тетради кампании: места · стороны);
 * `expand` — строка раскрывается карточкой под собой, а не уводит на профиль.
 */
export function CampaignWorldTab({
  campaignId,
  settingId,
  sessions,
  types = WORLD_TYPES,
  expand,
}: {
  campaignId: number;
  settingId: number | null;
  sessions: SessionSummary[];
  types?: readonly WorldType[];
  expand?: (e: WorldEntity) => ReactNode;
}) {
  const state = useResource<CampaignWorld>(settingId ? campaignPaths.world(campaignId) : null);
  const [filter, setFilter] = useState<Filter>(null);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<WorldType | "all">("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<WorldEntity | null>(null);
  const setEntityState = useSetCampaignEntityState(campaignId);
  const run = useAction();
  const entities = useMemo(() => state.data?.entities.filter((e) => types.includes(e.entity_type)), [state.data, types]);
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  if (!settingId)
    return <EmptyState kind="search" title="Кампания не привязана к сеттингу" hint="Сеттинг выбирается на «Обзоре» — «Править основное»." />;
  if (state.error)
    return (
      <p role="alert">
        Не удалось загрузить «Мир кампании». <button onClick={state.reload}>Повторить</button>
      </p>
    );
  if (!entities) return null;

  const rumorCount = entities.filter((e) => e.rumors > 0).length;
  const draftCount = entities.filter((e) => e.drafts > 0).length;
  const shown = entities.filter((e) => (filter === "rumor" ? e.rumors > 0 : filter === "draft" ? e.drafts > 0 : true));
  const toggle = (f: Exclude<Filter, null>) => setFilter((cur) => (cur === f ? null : f));

  async function engage(type: string, id: number) {
    setPicking(false);
    await run(labelled("Задействовать", () => write.post(campaignPaths.world(campaignId), { entity_type: type, entity_id: id })), {
      affects: [{ path: campaignPaths.world(campaignId) }, { kind: type as WorldType, id }],
      retry: false,
    });
  }

  async function removeEntity(entity: WorldEntity) {
    await run(labelled("Убрать из кампании", () => write.del(`${campaignPaths.world(campaignId)}/${entity.entity_type}/${entity.entity_id}`)), {
      affects: [{ path: campaignPaths.world(campaignId) }, { kind: entity.entity_type, id: entity.entity_id }],
    });
  }

  function lastSession(e: WorldEntity) {
    if (!e.last_session) return null;
    const s = sessionById.get(e.last_session.id);
    return (
      <Link className="paper-rows__sub" to={`/sessions/${e.last_session.id}`}>
        {s ? sessionLabel(s) : e.last_session.title || formatDateKeyRu(e.last_session.date)}
      </Link>
    );
  }

  if (!expand) {
    const search = query.trim().toLocaleLowerCase("ru");
    const visible = entities
      .filter((e) => (kind === "all" || e.entity_type === kind) && (!search || `${e.name} ${e.summary.text}`.toLocaleLowerCase("ru").includes(search)))
      .sort((a, b) => b.changed_at.localeCompare(a.changed_at) || a.name.localeCompare(b.name, "ru"));
    const settingLink = <Link to={`/settings/${settingId}`}>как в сеттинге ›</Link>;
    return (
      <section className="campaign-world campaign-world--catalog" aria-label="Мир кампании">
        <header className="campaign-world__head">
          <div>
            <h2>Мир кампании</h2>
            <p>Только то, что кампания задействовала или изменила. Остальное — {settingLink}</p>
          </div>
          <button type="button" className="campaign-world__add" onClick={() => setPicking(true)}>+ Добавить из сеттинга</button>
        </header>
        <div className="campaign-world__layout">
          <nav className="campaign-world__kinds" aria-label="Виды мира кампании">
            <button type="button" className={kind === "all" ? "is-active" : ""} aria-pressed={kind === "all"} onClick={() => setKind("all")}><NavIcon name="library" /><span>Все</span><span>{entities.length}</span></button>
            {GROUPS.filter((g) => types.includes(g.type)).map((g) => <button type="button" key={g.type} className={kind === g.type ? "is-active" : ""} aria-pressed={kind === g.type} onClick={() => setKind(g.type)}><TypeGlyph type={g.type} /><span>{g.label}</span><span>{entities.filter((e) => e.entity_type === g.type).length}</span></button>)}
            <hr />
            <button type="button" disabled><NavIcon name="chat" /><span>Слухи</span><span>{state.data!.rumors}</span></button>
            <button type="button" disabled><NavIcon name="document" /><span>Черновики</span><span>{state.data!.drafts}</span></button>
          </nav>
          <div className="campaign-world__results">
            <label className="campaign-world__search"><NavIcon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Поиск в мире кампании" placeholder="Поиск по названию или тексту…" /></label>
            <p className="campaign-world__count">{visible.length} в кампании</p>
            {visible.length ? <ul className="campaign-world__rows">{visible.map((e) => <CampaignWorldRow key={`${e.entity_type}:${e.entity_id}`} entity={e} campaignId={campaignId} session={e.last_session ? sessionById.get(e.last_session.id) : undefined} onState={(entity, value) => void setEntityState(entity, value)} onRecord={setAdding} onRemove={(entity) => void removeEntity(entity)} />)}</ul> : <p className="campaign-world__empty">{entities.length ? "Ничего не подходит." : <>Только то, что кампания задействовала или изменила. Остальное — {settingLink}</>}</p>}
          </div>
        </div>
        {picking && <WorldPicker settingId={settingId} types={kind === "all" ? types : [kind]} engaged={entities} onPick={(type, id) => void engage(type, id)} onClose={() => setPicking(false)} />}
        {adding && <RecordFormModal campaignId={campaignId} settingId={settingId} ownerType={adding.entity_type} ownerId={adding.entity_id} onClose={() => setAdding(null)} />}
      </section>
    );
  }

  return (
    <div className="campaign-world">
      <div className="campaign-world__bar">
        {/* Тот же чип, что у фильтров «Населения». */}
        <button type="button" className={`population__chip${filter === "rumor" ? " is-on" : ""}`} aria-pressed={filter === "rumor"} onClick={() => toggle("rumor")}>
          Слухи · {rumorCount}
        </button>
        <button type="button" className={`population__chip${filter === "draft" ? " is-on" : ""}`} aria-pressed={filter === "draft"} onClick={() => toggle("draft")}>
          Есть черновики · {draftCount}
        </button>
        <button type="button" className="campaign-world__add" onClick={() => setPicking(true)}>
          + Добавить из сеттинга
        </button>
      </div>

      {entities.length === 0 ? (
        <EmptyState
          title="Из сеттинга пока ничего не задействовано"
          hint="Сущность попадает сюда сама с первой записью о ней в кампании — или руками."
        />
      ) : shown.length === 0 ? (
        <p className="muted">Ничего не подходит.</p>
      ) : (
        <div className="paper-groups">
          {GROUPS.filter((g) => types.includes(g.type)).map((g) => {
            const list = shown.filter((e) => e.entity_type === g.type);
            if (!list.length) return null;
            return (
              <section key={g.type}>
                <h3 className="paper-group__head">
                  {g.label} <span className="paper-group__count">· {list.length}</span>
                </h3>
                <ul className="paper-rows">
                  {list.map((e) => {
                    const category = e.entity_type === "being" ? BEING_CATEGORY_LABELS[e.category ?? ""] : e.category;
                    const key = `${e.entity_type}:${e.entity_id}`;
                    return (
                      <li key={key} className={open === key ? "campaign-world__open" : undefined}>
                        <span className="paper-rows__main">
                          <Link
                            className={`mention-link mention--${mentionTone(e.entity_type, e.entity_id)}`}
                            to={`${g.path}/${e.entity_id}?campaign=${campaignId}`}
                          >
                            {e.name}
                          </Link>{" "}
                          <span className="paper-rows__sub">
                            {g.kind}
                            {category ? ` · ${category.toLowerCase()}` : ""}
                          </span>
                          <br />
                          <span className="campaign-world__summary">{recordSummary(e)}</span>
                          {" · "}
                          <button type="button" className="wb-link" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
                            {open === key ? "Свернуть" : "Записи"}
                          </button>
                        </span>
                        {lastSession(e)}
                        {open === key && <div className="campaign-world__card">{expand(e)}</div>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {picking && (
        <WorldPicker
          settingId={settingId}
          types={types}
          engaged={entities}
          onPick={(type, id) => void engage(type, id)}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/** Пикер упоминаний, ограниченный сеттингом кампании и ещё не задействованным. */
function WorldPicker({
  settingId,
  types,
  engaged,
  onPick,
  onClose,
}: {
  settingId: number;
  types: readonly WorldType[];
  engaged: WorldEntity[];
  onPick: (type: string, id: number) => void;
  onClose: () => void;
}) {
  const beings = useResource<{ id: number }[]>(SETTING_LISTS.being(settingId)).data;
  const communities = useResource<{ id: number }[]>(SETTING_LISTS.community(settingId)).data;
  const locations = useResource<{ id: number }[]>(SETTING_LISTS.location(settingId)).data;
  const artifacts = useResource<{ id: number }[]>(SETTING_LISTS.artifact(settingId)).data;
  const allowed = useMemo(() => {
    const taken = new Set(engaged.map((e) => `${e.entity_type}:${e.entity_id}`));
    const keys = new Set<string>();
    for (const [type, list] of [["being", beings], ["community", communities], ["location", locations], ["artifact", artifacts]] as const)
      for (const x of list ?? []) if (!taken.has(`${type}:${x.id}`)) keys.add(`${type}:${x.id}`);
    return keys;
  }, [engaged, beings, communities, locations, artifacts]);
  return (
    <MentionPickerModal
      initialQuery=""
      heading="Добавить из сеттинга"
      direct
      onlyTypes={[...types]}
      allow={(r) => allowed.has(`${r.type}:${r.id}`)}
      defaultSettingId={settingId}
      lockSetting
      onPick={(r) => onPick(r.type, r.id)}
      onClose={onClose}
    />
  );
}
