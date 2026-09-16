import { useNavigate, useParams } from "react-router-dom";
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

// Профиль события хроники. Строка хроники показывает только дату и краткое
// описание — всё остальное (развёрнутый текст, последствия, участники) живёт
// здесь.
export function EventDetailPage() {
  const [confirmDialog, confirm] = useConfirm();
  const { id } = useParams();
  const eventId = Number(id);
  const navigate = useNavigate();

  const eventState = useEntity<SettingCalendarEvent>("setting_event", eventId);
  const event = eventState.data ?? null;
  const calendar = useSettingCalendar(event?.setting_id);
  // Событие живёт внутри хроники сеттинга: его строка там и отметка в календаре.
  const eventAffects: Affect[] = event ? [{ path: `/settings/${event.setting_id}` }, { path: "/calendar" }] : [];
  const { save: saveEntity } = useSaveEntity<SettingCalendarEvent>("setting_event", eventId, { affects: eventAffects });
  const run = useAction();

  const chronicleUrl = event
    ? `/settings/${event.setting_id}?tab=${encodeURIComponent("Хроника мира")}`
    : "/settings";

  // Карточки полей держат правку открытой, пока сохранение не удалось.
  async function save(values: Partial<SettingCalendarEvent>) {
    if (!(await saveEntity(values))) throw new Error("Не сохранилось");
  }

  async function deleteEvent() {
    if (!event) return;
    if (!(await confirm({ message: "Удалить событие из хроники?", confirmLabel: "Удалить", danger: true })))
      return;
    const done = await run(() => write.del(`/settings/calendar-events/${eventId}`).then(() => true), { affects: eventAffects });
    if (done) navigate(chronicleUrl);
  }

  const months = calendar?.months ?? [];

  // Пока событие не пришло, крошки знают только первую ступень — дальше
  // дорога зависит от сеттинга, который приедет вместе с самим событием.
  const crumbs = event
    ? [
        { label: "Сеттинги", to: "/settings" },
        { label: event.setting_name ?? "Сеттинг", to: `/settings/${event.setting_id}` },
        { label: "Хроника мира", to: chronicleUrl },
        { label: event.title },
      ]
    : [{ label: "Сеттинги", to: "/settings" }];

  return (
    <EntityPage
      crumbs={crumbs}
      entityType="setting_event"
      title={event?.title ?? ""}
      meta={
        event && formatEventDate(event.inworld_year, event.inworld_month, event.inworld_day, months)
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
        <>
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

          {/* Флаги сервер принимает логическими (`important === true`), а
              отдаёт числами — отсюда приведение типа. */}
          <div className="card row">
            <label className="row">
              <input
                type="checkbox"
                checked={!!event.important}
                onChange={() => void saveEntity({ important: !event.important } as unknown as Partial<SettingCalendarEvent>)}
              />
              Важное
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={!!event.visible_to_players}
                onChange={() => void saveEntity({ visible_to_players: !event.visible_to_players } as unknown as Partial<SettingCalendarEvent>)}
              />
              Видно игрокам
            </label>
          </div>

          <EditableTextCard
            key={`description-${event.id}`}
            title="Краткое описание"
            help="Эта строка показывается в хронике мира."
            value={event.description}
            onSave={(v) => save({ description: v })}
            rows={3}
            entityType="setting_event"
            entityId={eventId}
            defaultSettingId={event.setting_id}
          />
          <EditableTextCard
            key={`full-${event.id}`}
            title="Полное описание"
            value={event.full_description}
            onSave={(v) => save({ full_description: v })}
            rows={8}
            entityType="setting_event"
            entityId={eventId}
            defaultSettingId={event.setting_id}
          />
          <EditableTextCard
            key={`consequences-${event.id}`}
            title="Последствия"
            help="Что в мире изменилось после события."
            value={event.consequences}
            onSave={(v) => save({ consequences: v })}
            rows={6}
            entityType="setting_event"
            entityId={eventId}
            defaultSettingId={event.setting_id}
          />

          <div className="card stack">
            <LinkDropZone entityType="setting_event" entityId={eventId} title="Участники и локации" />
          </div>
        </>
      )}
    </EntityPage>
  );
}
