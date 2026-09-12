import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
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

  const [event, setEvent] = useState<SettingCalendarEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const calendar = useSettingCalendar(event?.setting_id);

  function refresh() {
    setLoadError(null);
    api
      .get<SettingCalendarEvent>(`/settings/calendar-events/${eventId}`)
      .then(setEvent)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }
  useEffect(refresh, [eventId]);

  const chronicleUrl = event
    ? `/settings/${event.setting_id}?tab=${encodeURIComponent("Хроника мира")}`
    : "/settings";

  async function save(values: Record<string, unknown>) {
    await api.put(`/settings/calendar-events/${eventId}`, values);
    refresh();
  }

  async function deleteEvent() {
    if (!event) return;
    if (!(await confirm({ message: "Удалить событие из хроники?", confirmLabel: "Удалить", danger: true })))
      return;
    await api.del(`/settings/calendar-events/${eventId}`);
    navigate(chronicleUrl);
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
      error={loadError}
      onRetry={refresh}
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

          <div className="card row">
            <label className="row">
              <input
                type="checkbox"
                checked={!!event.important}
                onChange={() => save({ important: !event.important })}
              />
              Важное
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={!!event.visible_to_players}
                onChange={() => save({ visible_to_players: !event.visible_to_players })}
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
