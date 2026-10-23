import { useContext, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useEntity, useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { beingAffects } from "../../data/settingEntities";
import { sessionPaths } from "../../data/sessions";
import {
  CERTAINTY_LABELS,
  FUNCTION_LABELS,
  KNOWN_TO_LABELS,
  RECORD_ASPECTS,
  lastHeldSession,
  recordChains,
  type EntityRecord,
  type RecordCertainty,
  type RecordFunction,
  type RecordKnownTo,
  type RecordOwnerType,
} from "../../entityRecords";
import { mentionTone, parseMentions, resolveMention } from "../../mentions";
import type { CampaignDetail, Character, LiveSession, SessionDetail, SessionSummary, SettingBeingDetail } from "../../types";
import { SessionResults } from "../SessionResults";
import { sessionLabel } from "../../sessionLabel";
import { formatDateKeyRu } from "../../utils/date";
import { formatInworldDate } from "../../inworldCalendar";
import { useSettingCalendar } from "../../hooks/useSettingCalendar";
import { WorkbookContext, type InstanceSummary } from "./model";
import { CampaignParticipation } from "../CharacterDossier";
import { CampaignWorldTab, type WorldEntity, type WorldType } from "../campaign/CampaignWorldTab";
import { CampaignRecords } from "../campaign/CampaignProfileParts";
import { CampaignMove } from "../campaign/CampaignMove";
import { useOwnerRecords } from "../campaign/campaignProfile";
import { EntityRecordItem } from "../records/EntityRecordItem";
import { RecordFormModal } from "../records/RecordFormModal";
import { OwnerSelect } from "../records/SessionRecordsReview";

// Виды листов тетради кампании v4 (спека .scratch/workbook-rework): тетрадь
// — вид на данные кампании, а не второе хранилище. Здесь только сборка
// готовых частей «Мира кампании» и профиля в контексте кампании.

const PLACES: readonly WorldType[] = ["location"];
const SIDES: readonly WorldType[] = ["being", "community"];
const PROFILE_PATHS: Record<WorldType, string> = { being: "/beings", community: "/communities", location: "/locations", artifact: "/artifacts" };
const NO_SESSIONS: SessionSummary[] = [];

/** Лист 6 «Место и доступ», лист 7 «Сторона и отношения»: список + раскрытая карточка сущности. */
export function CampaignEntitiesView({ campaignId, view, title }: { campaignId: number; view: "places" | "sides"; title: string }) {
  const campaign = useResource<CampaignDetail>(campaignPaths.detail(campaignId)).data;
  const sessions = useResource<SessionSummary[]>(campaignPaths.sessions(campaignId)).data ?? NO_SESSIONS;
  if (!campaign) return <p className="muted">Открываем кампанию…</p>;
  return (
    <section className="wb-profile">
      <h3>{title}</h3>
      <CampaignWorldTab
        campaignId={campaignId}
        settingId={campaign.setting_id}
        sessions={sessions}
        types={view === "places" ? PLACES : SIDES}
        expand={(e) => <EntityCard campaignId={campaignId} settingId={campaign.setting_id} entity={e} />}
      />
    </section>
  );
}

function EntityCard({ campaignId, settingId, entity }: { campaignId: number; settingId: number | null; entity: WorldEntity }) {
  const { entity_type: type, entity_id: id } = entity;
  const records = useOwnerRecords(campaignId, type, id);
  const aspects = RECORD_ASPECTS[type].map((a) => a.key);
  return (
    <>
      {type === "being" && <BeingMove campaignId={campaignId} beingId={id} />}
      <CampaignRecords
        campaignId={campaignId}
        settingId={settingId}
        ownerType={type}
        ownerId={id}
        chains={records}
        title="Записи в кампании"
        aspects={aspects}
        // У места графы — словарь листа; у стороны основа силы правится в профиле.
        emptyKeys={type === "location" ? aspects.filter((k) => k !== "note") : []}
      />
      <Link className="paper-more" to={`${PROFILE_PATHS[type]}/${id}?campaign=${campaignId}`}>
        Профиль ›
      </Link>
    </>
  );
}

function BeingMove({ campaignId, beingId }: { campaignId: number; beingId: number }) {
  const being = useEntity<SettingBeingDetail>("being", beingId).data;
  const live = useResource<LiveSession | null>(sessionPaths.live()).data ?? null;
  if (!being) return null;
  return <CampaignMove being={being} campaignId={campaignId} live={live?.campaign_id === campaignId} affects={beingAffects(beingId)} />;
}

const NO_CHARACTERS: Character[] = [];
const CHARACTER_ASPECTS = RECORD_ASPECTS.character.map((a) => a.key);
const GROUND_ASPECTS = ["group_ties", "open_goals", "disputes", "needs_agreement", "goal_conflict"] as const;

/** Лист 4: персонажи игроков кампании; карточка — участие и записи персонажа по графам. */
export function CampaignHeroesView({ campaignId, title }: { campaignId: number; title: string }) {
  const campaign = useResource<CampaignDetail>(campaignPaths.detail(campaignId)).data;
  const characters = useResource<Character[]>(campaignPaths.characters(campaignId)).data;
  const [open, setOpen] = useState<number | null>(null);
  if (!campaign || !characters) return <p className="muted">Открываем героев…</p>;
  return (
    <section className="wb-profile campaign-world">
      <h3>{title}</h3>
      {characters.length === 0 ? (
        <p className="muted">В кампании пока нет персонажей игроков — они появляются на вкладке «Персонажи игроков».</p>
      ) : (
        <ul className="paper-rows">
          {(characters ?? NO_CHARACTERS).map((c) => (
            <li key={c.id} className={open === c.id ? "campaign-world__open" : undefined}>
              <span className="paper-rows__main">
                <Link className={`mention-link mention--${mentionTone("character", c.id)}`} to={`/characters/${c.id}`}>
                  {c.character_name}
                </Link>
                {c.player_name && <span className="paper-rows__sub"> · {c.player_name}</span>}
                {" · "}
                <button type="button" className="wb-link" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                  {open === c.id ? "Свернуть" : "Участие и записи"}
                </button>
              </span>
              {open === c.id && (
                <div className="campaign-world__card">
                  <HeroCard campaignId={campaignId} campaign={campaign} character={c} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HeroCard({ campaignId, campaign, character }: { campaignId: number; campaign: CampaignDetail; character: Character }) {
  const records = useOwnerRecords(campaignId, "character", character.id);
  return (
    <>
      <CampaignParticipation characterId={character.id} campaignId={campaignId} campaignName={campaign.name} />
      <CampaignRecords
        campaignId={campaignId}
        settingId={campaign.setting_id}
        ownerType="character"
        ownerId={character.id}
        chains={records}
        title="Записи персонажа"
        aspects={CHARACTER_ASPECTS}
        emptyKeys={CHARACTER_ASPECTS.filter((k) => k !== "note")}
      />
    </>
  );
}

/** Лист 4: общие основания группы — записи кампании по пяти графам. */
export function GroupGroundsView({ campaignId, title }: { campaignId: number; title: string }) {
  const campaign = useResource<CampaignDetail>(campaignPaths.detail(campaignId)).data;
  const records = useOwnerRecords(campaignId, "campaign", campaignId);
  if (!campaign) return <p className="muted">Открываем кампанию…</p>;
  return (
    <section className="wb-profile">
      <CampaignRecords
        campaignId={campaignId}
        settingId={campaign.setting_id}
        ownerType="campaign"
        ownerId={campaignId}
        chains={records}
        title={title}
        aspects={GROUND_ASPECTS}
        emptyKeys={GROUND_ASPECTS}
      />
    </section>
  );
}

const FUNCTIONS: Exclude<RecordFunction, "">[] = ["current", "anchor", "archive"];
const DOUBTS: RecordCertainty[] = ["rumor", "reported", "disputed"];
const KNOWN: RecordKnownTo[] = ["gm", "table", "public", "some"];
/** Вид владельца → цель выдачи: «показано игрокам» бывает только у сущностей сеттинга. */
const GRANT_TARGETS: Partial<Record<RecordOwnerType, string>> = { being: "setting_being", community: "setting_community", location: "setting_location" };
type NewRecord = { owner_type: RecordOwnerType; owner_id: number; aspect: string };

/**
 * Лист 9 «Знание кампании»: действующие записи с функцией сведения группами
 * Т · О · А. Черновики, отброшенные и заменённые сюда не попадают.
 */
export function CampaignKnowledgeView({ campaignId, title }: { campaignId: number; title: string }) {
  const campaign = useResource<CampaignDetail>(campaignPaths.detail(campaignId)).data;
  const records = useResource<{ records: EntityRecord[] }>(campaignPaths.records(campaignId)).data?.records;
  const grants = useResource<{ target_type: string; target_id: number }[]>(campaignPaths.grantSummary(campaignId)).data;
  const [all, setAll] = useState(false);
  const [doubt, setDoubt] = useState<RecordCertainty | null>(null);
  const [known, setKnown] = useState<RecordKnownTo | "">("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewRecord | null>(null);
  const chains = useMemo(
    () =>
      recordChains(records ?? []).filter(
        ({ record: r }) => r.status !== "draft" && (!doubt || r.certainty === doubt) && (!known || r.known_to === known)
      ),
    [records, doubt, known]
  );
  const shown = useMemo(() => new Set((grants ?? []).map((g) => `${g.target_type}:${g.target_id}`)), [grants]);
  if (!campaign || !records) return <p className="muted">Открываем записи кампании…</p>;
  const settingId = campaign.setting_id;
  const grantMark = (r: EntityRecord) =>
    GRANT_TARGETS[r.owner_type] && shown.has(`${GRANT_TARGETS[r.owner_type]}:${r.owner_id}`) ? <span className="badge tag">показано игрокам</span> : null;
  const item = (c: (typeof chains)[number]) => <EntityRecordItem key={c.record.id} chain={c} settingId={settingId} showOwner extra={grantMark(c.record)} />;
  const groups = FUNCTIONS.map((f) => [f, chains.filter((c) => c.record.function === f)] as const);
  return (
    <section className="wb-profile campaign-records campaign-knowledge">
      <h3 className="paper-group__head">
        {title}
        <button type="button" className="campaign-records__add" onClick={() => setAdding(!adding)}>
          + сведение
        </button>
      </h3>
      {adding && (
        <OwnerSelect
          campaignId={campaignId}
          placeholder="о ком сведение…"
          settingId={settingId}
          onPick={(o) => {
            setAdding(false);
            setDraft(o);
          }}
        />
      )}
      <div className="campaign-world__bar" role="group" aria-label="Фильтры сведений">
        <button type="button" className={`population__chip${all ? " is-on" : ""}`} aria-pressed={all} onClick={() => setAll(!all)}>
          все записи
        </button>
        {DOUBTS.map((d) => (
          <button key={d} type="button" className={`population__chip${doubt === d ? " is-on" : ""}`} aria-pressed={doubt === d} onClick={() => setDoubt(doubt === d ? null : d)}>
            {CERTAINTY_LABELS[d]}
          </button>
        ))}
        <select aria-label="Кому известно" value={known} onChange={(e) => setKnown(e.target.value as RecordKnownTo | "")}>
          <option value="">кому известно: все</option>
          {KNOWN.map((k) => (
            <option key={k} value={k}>
              знает: {KNOWN_TO_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      {all ? (
        chains.length ? chains.map(item) : <p className="muted">Ничего не подходит.</p>
      ) : groups.every(([, list]) => !list.length) ? (
        <p className="muted">Сведений пока нет: у записи функция выбирается в окне записи, в «ещё».</p>
      ) : (
        groups.map(
          ([f, list]) =>
            list.length > 0 && (
              <div key={f} className="campaign-records__group">
                <span className="paper-label">{FUNCTION_LABELS[f]}</span>
                {list.map(item)}
              </div>
            )
        )
      )}
      {draft && (
        <RecordFormModal
          campaignId={campaignId}
          settingId={settingId}
          ownerType={draft.owner_type}
          ownerId={draft.owner_id}
          aspect={draft.aspect}
          fn="current"
          onClose={() => setDraft(null)}
        />
      )}
    </section>
  );
}

/** Лист 22 «После встречи»: «Итоги» выбранной встречи — те же компоненты, что на вкладке сессии. */
export function CampaignSessionReviewView({ campaignId }: { campaignId: number }) {
  const campaign = useResource<CampaignDetail>(campaignPaths.detail(campaignId)).data;
  const sessions = useResource<SessionSummary[]>(campaignPaths.sessions(campaignId)).data;
  const [picked, setPicked] = useState<number | null>(null);
  const sessionId = picked ?? (sessions ? (lastHeldSession(sessions)?.id ?? null) : null);
  const session = useEntity<SessionDetail>("session", sessionId).data;
  if (!campaign || !sessions) return <p className="muted">Открываем встречи…</p>;
  const ordered = sessions.filter((s) => s.status !== "cancelled").sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return (
    <section className="wb-profile stack">
      <label className="stack">
        <span className="paper-label">Встреча</span>
        <select value={sessionId ?? ""} onChange={(e) => setPicked(e.target.value ? Number(e.target.value) : null)}>
          {sessionId == null && <option value="">— выберите встречу —</option>}
          {ordered.map((s) => (
            <option key={s.id} value={s.id}>
              {sessionLabel(s)} · {formatDateKeyRu(s.date)}
            </option>
          ))}
        </select>
      </label>
      {sessionId == null ? (
        <p className="muted">Сыгранных встреч пока нет — разбор появится после первой.</p>
      ) : session ? (
        <SessionResults session={session} campaignId={campaignId} settingId={campaign.setting_id} />
      ) : (
        <p className="muted">Открываем встречу…</p>
      )}
    </section>
  );
}

/** Лист 11: текущий момент мира — мировая дата последней сыгранной встречи (её конец, если указан). */
export function WorldMomentView({ campaignId, title }: { campaignId: number; title: string }) {
  const campaign = useResource<CampaignDetail>(campaignPaths.detail(campaignId)).data;
  const sessions = useResource<SessionSummary[]>(campaignPaths.sessions(campaignId)).data;
  const calendar = useSettingCalendar(campaign?.setting_id);
  if (!campaign || !sessions) return <p className="muted">Открываем встречи…</p>;
  const last = lastHeldSession(sessions);
  const end = last?.inworld_year_end != null;
  const [y, m, d] = !last ? [null, null, null] : end ? [last.inworld_year_end, last.inworld_month_end, last.inworld_day_end] : [last.inworld_year, last.inworld_month, last.inworld_day];
  const date = y == null ? null : calendar ? formatInworldDate(y, m, d, calendar.months, calendar.era) : [d, m, y].filter((x) => x != null).join(".");
  return (
    <section className="wb-profile">
      <h3 className="paper-group__head">{title}</h3>
      {date && last ? (
        <p>
          <strong>{date}</strong>{" "}
          <span className="muted">
            — {end ? "конец" : "начало"} встречи <Link to={`/sessions/${last.id}`}>{sessionLabel(last)}</Link>
          </span>
        </p>
      ) : (
        <p className="muted">
          Момент мира не указан.{" "}
          {last ? (
            <>
              Мировая дата ставится у встречи — <Link to={`/sessions/${last.id}`}>{sessionLabel(last)} ›</Link>
            </>
          ) : (
            "Сыгранных встреч пока нет."
          )}
        </p>
      )}
    </section>
  );
}

/** «Подготовка» сессии → лист 14 тетради кампании, если у кампании есть тетрадь v4. */
export function PrepSheetLink({ campaignId }: { campaignId: number }) {
  const list = useResource<InstanceSummary[]>(`/workbooks/instances?project_type=campaign&project_id=${campaignId}&template=campaign-design`).data;
  const book = list?.find((w) => w.template_version >= 4);
  if (!book) return null;
  return (
    <Link className="paper-more" to={`/workbooks/${book.id}?sheet=prep`}>
      Лист подготовки в тетради ›
    </Link>
  );
}

const FORMER_OWNERS: ReadonlySet<string> = new Set(["being", "community", "location", "character"]);

/** Ответ «Прежних граф» строками: текст — одна строка, таблица — строка на строку таблицы. */
function formerTexts(value: unknown): string[] {
  const one = (v: unknown): string =>
    v == null ? "" : typeof v === "object" ? Object.entries(v).filter(([k]) => k !== "_id").map(([, x]) => one(x)).filter(Boolean).join(" · ") : String(v).trim();
  return (Array.isArray(value) ? value.map(one) : [one(value)]).filter(Boolean);
}

/**
 * «→ в запись» у ответа из «Прежних граф» тетради кампании (спека
 * workbook-rework, Q18): окно записи с текстом ответа. Владелец — первое
 * упоминание, если это сущность сеттинга или персонаж (сервер проверит, что
 * они из этой кампании), иначе выбор. Сам ответ не меняется и не удаляется.
 */
export function FormerToRecord({ value }: { value: unknown }) {
  const doc = useContext(WorkbookContext)?.document;
  const campaignId = doc?.project_type === "campaign" ? doc.project_id : null;
  const campaign = useResource<CampaignDetail>(campaignId ? campaignPaths.detail(campaignId) : null).data;
  const [choosing, setChoosing] = useState<string | null>(null);
  const [draft, setDraft] = useState<(NewRecord & { text: string }) | null>(null);
  if (!campaignId || !campaign) return null;
  const texts = formerTexts(value);
  function start(text: string) {
    const first = parseMentions(text)[0];
    const id = first && FORMER_OWNERS.has(first.type) ? resolveMention(first.type, first.uid) : null;
    if (first && id) setDraft({ owner_type: first.type as RecordOwnerType, owner_id: id, aspect: "note", text });
    else setChoosing(text);
  }
  return (
    <>
      {texts.map((t, i) => (
        <div key={i} className="workbook-former__row">
          {texts.length > 1 && <span className="muted">{t}</span>}
          <button type="button" className="wb-link" onClick={() => start(t)}>
            → в запись
          </button>
        </div>
      ))}
      {choosing != null && (
        <OwnerSelect
          campaignId={campaignId}
          placeholder="о ком запись…"
          settingId={campaign.setting_id}
          onPick={(o) => {
            setDraft({ ...o, text: choosing });
            setChoosing(null);
          }}
        />
      )}
      {draft && (
        <RecordFormModal
          campaignId={campaignId}
          settingId={campaign.setting_id}
          ownerType={draft.owner_type}
          ownerId={draft.owner_id}
          aspect={draft.aspect}
          text={draft.text}
          onClose={() => setDraft(null)}
        />
      )}
    </>
  );
}
