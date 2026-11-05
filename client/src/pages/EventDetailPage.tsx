import { useState } from "react";
import { ProfileHero, ProfileText } from "../components/profiles/ProfileParts";
import { ProfileEventSessions } from "../components/profiles/ProfileEventSessions";
import { Modal } from "../components/Modal";
import { EntityFieldInputs, type EntityField, type EntityFieldValues, toFieldValues } from "../components/EntityFieldsCard";
import { campaignClock, timeTone } from "../components/chronicle/time";
import { sessionPaths } from "../data/sessions";
import type { SessionSummary } from "../types";
import "../components/chronicle/chronicle.css";
import { useNavigate, useParams } from "react-router-dom";
import { useAction, useEntity, useResource, useSaveEntity, write } from "../data/hooks";
import type { Affect } from "../data/entities";
import { EntityPage } from "../components/EntityPage";
import { LinkDropZone } from "../components/LinkDropZone";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { formatByPrecision } from "../inworldCalendar";
import type { SettingCalendarEvent } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { PlayerVisibilityFact } from "../components/PlayerVisibilityFact";

type ProfileEvent = Omit<SettingCalendarEvent, "setting_id"> & {
  setting_id: number | null;
  campaign_id?: number;
  campaign_name?: string;
};

// Профиль события хроники. Строка хроники показывает только дату и краткое
// описание — всё остальное (развёрнутый текст, последствия, участники) живёт
// здесь. На бумаге и без вкладок (разбор 2026-10-02, доска 28): их нечем
// наполнить; дата — меткой под именем, на месте мазка.
export function EventDetailPage() {
  const [confirmDialog, confirm] = useConfirm();
  const { id, campaignEventId } = useParams();
  const campaign = campaignEventId !== undefined;
  const kind = campaign ? "campaign_event" : "setting_event";
  const eventId = Number(campaignEventId ?? id);
  const navigate = useNavigate();

  const eventState = useEntity<ProfileEvent>(kind, eventId);
  const event = eventState.data ?? null;
  const [editing,setEditing] = useState(false);
  const [players,setPlayers] = useState(false);
  const clockOwner = useResource<{ pinned_calendar_year: number | null; pinned_calendar_month: number | null }>(event ? campaign ? `/campaigns/${event.campaign_id}` : `/settings/${event.setting_id}` : null).data;
  const sessions = useResource<SessionSummary[]>(campaign && event?.campaign_id ? sessionPaths.campaignSessions(event.campaign_id) : null).data ?? [];
  const now = clockOwner ? campaignClock(clockOwner,campaign ? sessions : []).now : null;
  const tone = event ? timeTone(event,now) : "past";
  const calendar = useSettingCalendar(event?.setting_id);
  // Событие живёт внутри хроники сеттинга: его строка там и отметка в календаре.
  const eventAffects: Affect[] = event ? [
    { path: campaign ? `/campaigns/${event.campaign_id}` : `/settings/${event.setting_id}` },
    { path: "/calendar" }, { path: "/player" }, { path: "/visibility-grants" },
  ] : [];
  const { save: saveEntity } = useSaveEntity<ProfileEvent>(kind, eventId, { affects: eventAffects });
  const run = useAction();

  const chronicleUrl = event
    ? campaign ? `/campaigns/${event.campaign_id}?tab=${encodeURIComponent("Хроника мира")}`
      : `/settings/${event.setting_id}?tab=${encodeURIComponent("Хроника")}`
    : campaign ? "/campaigns" : "/settings";

  // Карточки полей держат правку открытой, пока сохранение не удалось.
  async function save(values: Partial<ProfileEvent>) {
    if (!(await saveEntity(values))) throw new Error("Не сохранилось");
  }

  async function deleteEvent() {
    if (!event) return;
    if (!(await confirm({ message: "Удалить событие из хроники?", confirmLabel: "Удалить", danger: true })))
      return;
    const done = await run(() => write.del(`${campaign ? "/campaigns" : "/settings"}/calendar-events/${eventId}`).then(() => true), { affects: eventAffects });
    if (done) navigate(chronicleUrl);
  }

  const months = calendar?.months ?? [];

  // Пока событие не пришло, крошки знают только первую ступень — дальше
  // дорога зависит от сеттинга, который приедет вместе с самим событием.
  const crumbs = campaign ? [
    { label: "Кампании", to: "/campaigns" },
    { label: event?.campaign_name ?? "Кампания", to: event ? `/campaigns/${event.campaign_id}` : "/campaigns" },
    { label: "Хроника мира", to: chronicleUrl },
    { label: event?.title ?? "Событие" },
  ] : event
    ? [
        { label: "Сеттинги", to: "/settings" },
        { label: event.setting_name ?? "Сеттинг", to: `/settings/${event.setting_id}` },
        { label: "Хроника", to: chronicleUrl },
        { label: event.title },
      ]
    : [{ label: "Сеттинги", to: "/settings" }];

  const fields: EntityField[] = event ? [
    { key:"title",label:"Название",value:event.title,required:true },
    { key:"inworld_year",label:"Год",value:String(event.inworld_year) },
    { key:"inworld_month",label:"Месяц",value:String(event.inworld_month),options:months.length ? months.map((m) => ({value:String(m.position),label:m.name})) : undefined },
    { key:"inworld_day",label:"День",value:String(event.inworld_day) },
    { key:"date_precision",label:"Точность",value:event.date_precision,options:[{value:"day",label:"День"},{value:"month",label:"Месяц"},{value:"year",label:"Год"},{value:"decade",label:"Десятилетие"},{value:"century",label:"Век"}] },
    { key:"inworld_year_end",label:"Год окончания",value:event.inworld_year_end == null ? "" : String(event.inworld_year_end) },
    { key:"inworld_month_end",label:"Месяц окончания",value:event.inworld_month_end == null ? "" : String(event.inworld_month_end) },
    { key:"inworld_day_end",label:"День окончания",value:event.inworld_day_end == null ? "" : String(event.inworld_day_end) },
    { key:"status",label:"Статус",value:event.status,options:[{value:"upcoming",label:"Предстоит"},{value:"happened",label:"Случилось"},{value:"cancelled",label:"Отменено"}] },
    { key:"cancel_note",label:"Причина отмены",value:event.cancel_note },
  ] : [];
  async function saveFields(values: EntityFieldValues) {
    await save({ title:values.title,inworld_year:Number(values.inworld_year),inworld_month:Number(values.inworld_month),inworld_day:Number(values.inworld_day),
      inworld_year_end:values.inworld_year_end ? Number(values.inworld_year_end) : null,inworld_month_end:values.inworld_month_end ? Number(values.inworld_month_end) : null,inworld_day_end:values.inworld_day_end ? Number(values.inworld_day_end) : null,
      date_precision:values.date_precision as ProfileEvent["date_precision"],status:values.status as ProfileEvent["status"],cancel_note:values.cancel_note });
    setEditing(false);
  }
  const dateLabel = event ? formatByPrecision(event.inworld_year,event.inworld_month,event.inworld_day,event.date_precision,months,calendar?.era ?? "") : "";
  const endLabel = event?.inworld_year_end != null || event?.inworld_month_end != null || event?.inworld_day_end != null ? formatByPrecision(event!.inworld_year_end ?? event!.inworld_year,event!.inworld_month_end ?? event!.inworld_month,event!.inworld_day_end ?? event!.inworld_day,event!.date_precision,months,calendar?.era ?? "") : "";
  return <EntityPage profile={{id:eventId,tone}} crumbs={crumbs} entityType={kind} title={event?.title ?? ""}
    primaryAction={<button type="button" className="d-btn" onClick={() => setEditing(true)} disabled={!event}>Править</button>}
    actions={[{label:"В хронике",onClick:() => navigate(chronicleUrl)},{label:"Удалить",danger:true,onClick:deleteEvent}]}
    loading={!event} error={eventState.error} onRetry={eventState.reload} overlays={<>
      {confirmDialog}
      {editing && event && <Modal onClose={() => setEditing(false)} ariaLabel="Править событие"><h2>Править событие</h2><EventFields fields={fields} onSave={saveFields} /></Modal>}
      {players && event && <Modal onClose={() => setPlayers(false)} ariaLabel="Что видят игроки"><h2>Что видят игроки</h2>
        <label className="row"><input type="checkbox" checked={!!event.visible_to_players} onChange={() => void saveEntity({visible_to_players:!event.visible_to_players} as unknown as Partial<ProfileEvent>)} />Видно игрокам</label>
        {!campaign && <dl className="paper-facts"><PlayerVisibilityFact targetType="setting_calendar_event" targetId={eventId} /></dl>}
        <ProfileText title="Текст для игроков" value={event.player_text} onSave={(v) => save({player_text:v})} emptyLabel="Если текст не задан, игроки увидят краткое описание." defaultSettingId={event.setting_id ?? undefined} />
      </Modal>}
    </>}>
    {event && <div className="profile-dossier profile-event">
      <ProfileHero type={kind} name={event.title} createdAt={event.created_at} subtype={campaign ? "Кампании" : "Сеттинга"} labels={<>
        <span className={`profile-event-date tone-${tone}`}><i />{dateLabel}{endLabel && ` — ${endLabel}`}</span><span className="d-note">{{past:"случилось",on:"идёт",up:"предстоит",off:"отменено"}[tone]}</span>
        <button type="button" className="d-btn d-btn--sm d-btn--ghost" aria-pressed={!!event.important} onClick={() => void saveEntity({important:!event.important} as unknown as Partial<ProfileEvent>)}>{event.important ? "★ важное" : "+ важное"}</button>
      </>}>
        <ProfileText focal title="Кратко" value={event.description} onSave={(v) => save({description:v})} emptyLabel="Одна строка для хроники мира." defaultSettingId={event.setting_id ?? undefined} rows={3} />
      </ProfileHero>
      <div className="profile-visibility"><span className="profile-visibility__label">Игрокам</span><span>{event.visible_to_players ? "открыто" : "скрыто"} — {event.player_text ? "отдельный текст" : "краткое описание"}</span><button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => setPlayers(true)}>Что видят игроки ›</button></div>
      {campaign && <ProfileEventSessions sessions={event.sessions} />}
      <div className="profile-columns"><ProfileText title="Подробно" value={event.full_description} onSave={(v) => save({full_description:v})} emptyLabel="Добавьте подробности события." defaultSettingId={event.setting_id ?? undefined} rows={8} /><ProfileText title="Последствия" value={event.consequences} onSave={(v) => save({consequences:v})} emptyLabel="Что в мире изменилось после события?" defaultSettingId={event.setting_id ?? undefined} rows={6} /></div>
      <LinkDropZone profile entityType={kind} entityId={eventId} title="Участники" settingId={event.setting_id ?? undefined} />
    </div>}
  </EntityPage>;
}

function EventFields({ fields,onSave }: { fields:EntityField[];onSave:(v:EntityFieldValues) => Promise<void> }) {
  const [values,setValues] = useState(() => toFieldValues(fields));
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState("");
  return <form className="stack" onSubmit={async (e) => { e.preventDefault();setSaving(true);setError("");try { await onSave(values); } catch(e) { setError(e instanceof Error ? e.message : "Не сохранилось"); } finally { setSaving(false); } }}>
    <EntityFieldInputs fields={fields} values={values} onChange={(key,value) => setValues((v) => ({...v,[key]:value}))} />
    {error && <p role="alert">{error}</p>}<button className="d-btn" disabled={saving || !values.title.trim()}>Сохранить</button>
  </form>;
}
