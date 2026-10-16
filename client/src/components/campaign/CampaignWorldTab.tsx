import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import { labelled } from "../../data/notices";
import { campaignPaths } from "../../data/campaigns";
import { mentionTone } from "../../mentions";
import { BEING_CATEGORY_LABELS } from "../../beingCategories";
import { recordSummary } from "../../entityRecords";
import { sessionLabel } from "../../sessionLabel";
import { formatDateKeyRu } from "../../utils/date";
import { EmptyState } from "../EmptyState";
import { MentionPickerModal } from "../mentions/MentionPickerModal";
import type { SessionSummary } from "../../types";

// «Мир кампании» (ADR-0006, спека .scratch/campaign-layer, задача 03):
// сущности сеттинга, задействованные в кампании, — по видам, со сводкой
// записей. Задействована не значит показана игрокам: это «Выдача».

type WorldType = "being" | "community" | "location";

export interface WorldEntity {
  entity_type: WorldType;
  entity_id: number;
  name: string;
  /** Существо — ключ категории, место — вывеска, сообщество — нет. */
  category: string | null;
  manual: boolean;
  records: number;
  drafts: number;
  rumors: number;
  last_session: { id: number; title: string | null; date: string } | null;
}

export interface CampaignWorld {
  setting_id: number | null;
  entities: WorldEntity[];
}

const GROUPS: { type: WorldType; label: string; kind: string; path: string }[] = [
  { type: "being", label: "Существа", kind: "существо", path: "/beings" },
  { type: "community", label: "Сообщества", kind: "сообщество", path: "/communities" },
  { type: "location", label: "Места", kind: "место", path: "/locations" },
];
const WORLD_TYPES = GROUPS.map((g) => g.type);

const SETTING_LISTS: Record<WorldType, (settingId: number) => string> = {
  being: (id) => `/setting-beings?setting_id=${id}`,
  community: (id) => `/setting-communities?setting_id=${id}`,
  location: (id) => `/setting-locations?setting_id=${id}`,
};

type Filter = "rumor" | "draft" | null;

export function CampaignWorldTab({
  campaignId,
  settingId,
  sessions,
}: {
  campaignId: number;
  settingId: number | null;
  sessions: SessionSummary[];
}) {
  const state = useResource<CampaignWorld>(settingId ? campaignPaths.world(campaignId) : null);
  const [filter, setFilter] = useState<Filter>(null);
  const [picking, setPicking] = useState(false);
  const run = useAction();
  const entities = state.data?.entities;
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

  function lastSession(e: WorldEntity) {
    if (!e.last_session) return null;
    const s = sessionById.get(e.last_session.id);
    return (
      <Link className="paper-rows__sub" to={`/sessions/${e.last_session.id}`}>
        {s ? sessionLabel(s) : e.last_session.title || formatDateKeyRu(e.last_session.date)}
      </Link>
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
          + Задействовать из сеттинга
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
          {GROUPS.map((g) => {
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
                    return (
                      <li key={`${e.entity_type}:${e.entity_id}`}>
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
                        </span>
                        {lastSession(e)}
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
  engaged,
  onPick,
  onClose,
}: {
  settingId: number;
  engaged: WorldEntity[];
  onPick: (type: string, id: number) => void;
  onClose: () => void;
}) {
  const beings = useResource<{ id: number }[]>(SETTING_LISTS.being(settingId)).data;
  const communities = useResource<{ id: number }[]>(SETTING_LISTS.community(settingId)).data;
  const locations = useResource<{ id: number }[]>(SETTING_LISTS.location(settingId)).data;
  const allowed = useMemo(() => {
    const taken = new Set(engaged.map((e) => `${e.entity_type}:${e.entity_id}`));
    const keys = new Set<string>();
    for (const [type, list] of [["being", beings], ["community", communities], ["location", locations]] as const)
      for (const x of list ?? []) if (!taken.has(`${type}:${x.id}`)) keys.add(`${type}:${x.id}`);
    return keys;
  }, [engaged, beings, communities, locations]);
  return (
    <MentionPickerModal
      initialQuery=""
      heading="Задействовать из сеттинга"
      direct
      onlyTypes={WORLD_TYPES}
      allow={(r) => allowed.has(`${r.type}:${r.id}`)}
      defaultSettingId={settingId}
      lockSetting
      onPick={(r) => onPick(r.type, r.id)}
      onClose={onClose}
    />
  );
}
