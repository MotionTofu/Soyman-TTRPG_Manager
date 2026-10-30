import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import { stripMentions } from "../../mentions";
import { labelled } from "../../data/notices";
import { campaignPaths } from "../../data/campaigns";
import { WORLD_GROUPS as GROUPS, WORLD_TYPES, useSetCampaignEntityState, type CampaignWorld, type WorldEntity, type WorldType } from "../../campaignWorld";
import { CampaignWorldRow } from "./CampaignWorldRow";
import { CampaignWorldRecords } from "./CampaignWorldRecords";
import { RecordFormModal } from "../records/RecordFormModal";
import { ContextMenu } from "../ContextMenu";
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

/**
 * `types` — только эти виды (листы тетради кампании: места · стороны);
 * `expand` — «Записи» раскрывают карточку под строкой; имя остаётся ссылкой.
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
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<WorldType | "all" | "rumor" | "draft">("all");
  const [creating, setCreating] = useState(false);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
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

  async function engage(type: string, id: number, created = false) {
    setPicking(false);
    const result = await run(labelled("Задействовать", () => write.post(campaignPaths.world(campaignId), { entity_type: type, entity_id: id })), {
      affects: [{ path: campaignPaths.world(campaignId) }, { kind: type as WorldType, id }],
      retry: false,
    });
    if (result && created) {
      setCreating(false);
      navigate(`${GROUPS.find((g) => g.type === type)!.path}/${id}?campaign=${campaignId}`);
    }
  }

  async function removeEntity(entity: WorldEntity) {
    await run(labelled("Убрать из кампании", () => write.del(`${campaignPaths.world(campaignId)}/${entity.entity_type}/${entity.entity_id}`)), {
      affects: [{ path: campaignPaths.world(campaignId) }, { kind: entity.entity_type, id: entity.entity_id }],
    });
  }

  const search = query.trim().toLocaleLowerCase("ru");
  const visible = entities
    .filter((e) => (kind === "all" || e.entity_type === kind) && (!search || stripMentions(`${e.name} ${e.summary.text}`).toLocaleLowerCase("ru").includes(search)))
    .sort((a, b) => b.changed_at.localeCompare(a.changed_at) || a.name.localeCompare(b.name, "ru"));
  const settingLink = <Link to={`/settings/${settingId}`}>как в сеттинге ›</Link>;
  return (
    <section className={`campaign-world ${expand ? "campaign-world--compact" : "campaign-world--catalog"}`} aria-label="Мир кампании">
      {/* Голова «Д» (макеты Camp-World, Camp-World-Drafts): у слухов и
          черновиков — свои заголовок и пояснение, без кнопок добавления. */}
      {!expand && <header className="d-head campaign-world__head">
        {kind === "draft" || kind === "rumor" ? <div>
          <h2>{kind === "draft" ? "Черновики" : "Слухи"}</h2>
          <div className="d-head__sub">{kind === "draft" ? "Записанное за столом наспех — разобрать в «Итогах» сессии" : "Что говорят в мире — может оказаться неправдой"}</div>
        </div> : <div>
          <h2>Мир кампании</h2>
          <div className="d-head__sub">Только то, что кампания задействовала или изменила. Остальное — {settingLink}</div>
        </div>}
        {kind !== "draft" && kind !== "rumor" && <div className="d-head__acts campaign-world__actions">
          <button type="button" className="d-btn campaign-world__new" onClick={() => setCreating(true)}>Новая в сеттинге<span>появится и в сеттинге</span></button>
          <button type="button" className="d-btn d-btn--primary" onClick={() => setPicking(true)}>+ Добавить из сеттинга</button>
        </div>}
        <button ref={addTrigger} type="button" className="campaign-world__mobile-add" aria-label="Добавить в мир кампании" aria-haspopup="menu" aria-expanded={!!addMenu} onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAddMenu({ x: rect.right, y: rect.bottom });
        }}>+</button>
      </header>}
      <div className="campaign-world__layout">
        {!expand && <nav className="campaign-world__kinds" aria-label="Виды мира кампании">
          <button type="button" className={kind === "all" ? "is-active" : ""} aria-pressed={kind === "all"} onClick={() => setKind("all")}><NavIcon name="library" /><span>Все</span><span>{entities.length}</span></button>
          {GROUPS.filter((g) => types.includes(g.type)).map((g) => <button type="button" key={g.type} className={kind === g.type ? "is-active" : ""} aria-pressed={kind === g.type} onClick={() => setKind(g.type)}><TypeGlyph type={g.type} /><span>{g.label}</span><span>{entities.filter((e) => e.entity_type === g.type).length}</span></button>)}
          <hr />
          <button type="button" className={kind === "rumor" ? "is-active" : ""} aria-pressed={kind === "rumor"} onClick={() => setKind("rumor")}><NavIcon name="chat" /><span>Слухи</span><span>{state.data!.rumors}</span></button>
          <button type="button" className={kind === "draft" ? "is-active" : ""} aria-pressed={kind === "draft"} onClick={() => setKind("draft")}><NavIcon name="document" /><span>Черновики</span><span>{state.data!.drafts}</span></button>
        </nav>}
        <div className="campaign-world__results">
          <label className="campaign-world__search"><NavIcon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Поиск в мире кампании" placeholder="Поиск по названию или тексту…" /></label>
          {kind === "rumor" || kind === "draft" ? <CampaignWorldRecords campaignId={campaignId} mode={kind} sessions={sessions} query={query} /> : <>
          <p className="campaign-world__count d-mono">{visible.length} в кампании · по изменению</p>
          {visible.length ? <ul className="campaign-world__rows">{visible.map((e) => {
            const key = `${e.entity_type}:${e.entity_id}`;
            return <CampaignWorldRow key={key} entity={e} campaignId={campaignId}
              session={e.last_session ? sessionById.get(e.last_session.id) : undefined}
              onState={(entity, value) => void setEntityState(entity, value)}
              onRecord={setAdding} onRemove={(entity) => void removeEntity(entity)}
              expanded={open === key}
              onExpand={expand ? () => setOpen(open === key ? null : key) : undefined}
              records={expand && open === key ? expand(e) : undefined}
            />;
          })}</ul> : <p className="campaign-world__empty">{entities.length ? "Ничего не подходит." : <>Только то, что кампания задействовала или изменила. Остальное — {settingLink}</>}</p>}
          </>}
        </div>
      </div>
      {addMenu && <ContextMenu x={addMenu.x} y={addMenu.y} ariaLabel="Добавить в мир кампании" items={[
        { label: "Из сеттинга", onClick: () => setPicking(true) },
        { label: "Новая", onClick: () => setCreating(true) },
      ]} onClose={() => { setAddMenu(null); addTrigger.current?.focus(); }} />}
      {creating && <MentionPickerModal initialQuery="" initialCreate initialCreateType={kind === "all" || kind === "rumor" || kind === "draft" ? undefined : kind} defaultSettingId={settingId} lockSetting direct onlyTypes={types} onPick={(r) => void engage(r.type, r.id, true)} onClose={() => setCreating(false)} />}
      {picking && <WorldPicker settingId={settingId} types={kind === "all" || kind === "rumor" || kind === "draft" ? types : [kind]} engaged={entities} onPick={(type, id) => void engage(type, id)} onClose={() => setPicking(false)} />}
      {adding && <RecordFormModal campaignId={campaignId} settingId={settingId} ownerType={adding.entity_type} ownerId={adding.entity_id} onClose={() => setAdding(null)} />}
    </section>
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
