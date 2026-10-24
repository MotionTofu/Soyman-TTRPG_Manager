import { Link, useNavigate, useParams } from "react-router-dom";
import { useAction, useEntity, useSaveEntity, write } from "../data/hooks";
import type { Affect } from "../data/entities";
import { EditableTextCard } from "../components/EditableTextCard";
import { EntityFieldsCard } from "../components/EntityFieldsCard";
import { EntityPage } from "../components/EntityPage";
import { LinkDropZone } from "../components/LinkDropZone";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { formatEventDate } from "../inworldCalendar";
import type { SettingCalendarEvent } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { PlayerVisibilityFact } from "../components/PlayerVisibilityFact";
import { sessionLabel } from "../sessionLabel";

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

  return (
    <EntityPage
      paper
      crumbs={crumbs}
      entityType={kind}
      title={event?.title ?? ""}
      meta={
        event && (
          <span className="paper-ident-tags">
            <span className="badge tag">
              {formatEventDate(event.inworld_year, event.inworld_month, event.inworld_day, months)}
            </span>
          </span>
        )
      }
      // Единственное действие события — разрушительное, а разрушительное
      // главным не бывает: в шапке пусто, «Удалить» под «…».
      actions={[{ label: "Удалить", danger: true, onClick: deleteEvent }]}
      loading={!event}
      error={eventState.error}
      onRetry={eventState.reload}
      overlays={confirmDialog}
    >
      {event && (
        <div className="event-sheet">
          {/* Флаги сервер принимает логическими (`important === true`), а
              отдаёт числами — отсюда приведение типа. */}
          <div className="event-sheet__flags">
            <button
              type="button"
              aria-pressed={!!event.important}
              onClick={() => void saveEntity({ important: !event.important } as unknown as Partial<ProfileEvent>)}
            >
              {event.important ? "★" : "☆"} важное
            </button>
            <label className="row">
              <input
                type="checkbox"
                checked={!!event.visible_to_players}
                onChange={() => void saveEntity({ visible_to_players: !event.visible_to_players } as unknown as Partial<ProfileEvent>)}
              />
              видно игрокам
            </label>
            <Link className="paper-more event-sheet__to" to={chronicleUrl}>
              В хронике ›
            </Link>
          </div>
          {/* Кому открыто по кампаниям (спека campaign-paper, Q34). */}
          {!campaign && <dl className="paper-facts">
            <PlayerVisibilityFact targetType="setting_calendar_event" targetId={eventId} />
          </dl>}

          <EditableTextCard
            key={`${kind}-description-${event.id}`}
            title="Кратко"
            help="Эта строка показывается в хронике мира."
            value={event.description}
            onSave={(v) => save({ description: v })}
            rows={3}
            emptyLabel="одна строка для хроники"
            entityType={kind}
            entityId={eventId}
            defaultSettingId={event.setting_id ?? undefined}
          />
          <EditableTextCard
            key={`${kind}-full-${event.id}`}
            title="Подробно"
            value={event.full_description}
            onSave={(v) => save({ full_description: v })}
            rows={8}
            emptyLabel="полное описание"
            entityType={kind}
            entityId={eventId}
            defaultSettingId={event.setting_id ?? undefined}
          />
          <EditableTextCard
            key={`${kind}-consequences-${event.id}`}
            title="Последствия"
            help="Что в мире изменилось после события."
            value={event.consequences}
            onSave={(v) => save({ consequences: v })}
            rows={6}
            emptyLabel="что изменилось после"
            entityType={kind}
            entityId={eventId}
            defaultSettingId={event.setting_id ?? undefined}
          />

          <LinkDropZone entityType={kind} entityId={eventId} title="Участники и места" />

          <section className="card">
            <h3>Сессии</h3>
            {event.sessions?.length ? <ul>
              {event.sessions.map((session) => <li key={session.link_id}>
                <Link to={`/sessions/${session.id}`}>{sessionLabel(session)}</Link>
              </li>)}
            </ul> : <p className="muted">Пока не связаны.</p>}
          </section>
          <EditableTextCard
            key={`${kind}-player-${event.id}`}
            title="Текст для игроков"
            value={event.player_text}
            onSave={(value) => save({ player_text: value })}
            rows={6}
            emptyLabel="Если не задан, игроки увидят краткое описание."
            entityType={kind}
            entityId={eventId}
            defaultSettingId={event.setting_id ?? undefined}
          />

          {/* Название и дата правятся редко — свёрнуто, как справка у
              остальных профилей. */}
          <details className="paper-fold">
            <summary>Название и дата</summary>
            <div className="paper-fold__body">
              <EntityFieldsCard
                fields={[
                  { key: "title", label: "Название", value: event.title, required: true },
                  { key: "inworld_year", label: "Год", value: String(event.inworld_year) },
                  {
                    key: "inworld_month",
                    label: "Месяц",
                    value: String(event.inworld_month),
                    // Календарь у сеттинга свой; пока месяцы не заведены — обычное поле
                    // с номером, как и в самой хронике.
                    options:
                      months.length > 0
                        ? months.map((m) => ({ value: String(m.position), label: m.name }))
                        : undefined,
                  },
                  { key: "inworld_day", label: "День", value: String(event.inworld_day) },
                ]}
                onSave={(values) =>
                  save({
                    title: values.title,
                    inworld_year: Number(values.inworld_year),
                    inworld_month: Number(values.inworld_month),
                    inworld_day: Number(values.inworld_day),
                  })
                }
              />
            </div>
          </details>
        </div>
      )}
    </EntityPage>
  );
}
