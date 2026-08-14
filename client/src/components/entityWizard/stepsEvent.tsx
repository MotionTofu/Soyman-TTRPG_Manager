import { useSettingCalendar } from "../../hooks/useSettingCalendar";
import { Field, MultiPickField, TextAreaField, useSettingOptions } from "./fields";
import { arr, str, type Patch } from "./steps";
import type { WizardContext, WizardDraft, WizardStep } from "./types";

// Шаги события хроники. Событие отличается от остальных типов тем, что у него
// нет ни аватарки, ни синонимов: его опознают дата и участники.

const num = (draft: WizardDraft, key: string, fallback: number) =>
  typeof draft[key] === "number" ? (draft[key] as number) : fallback;

function EventDateStep({ draft, patch, ctx }: { draft: WizardDraft; patch: Patch; ctx: WizardContext }) {
  const calendar = useSettingCalendar(ctx.settingId);
  const months = calendar?.months ?? [];
  return (
    <div className="stack">
      <div className="row">
        <Field label="Год">
          <input
            type="number"
            value={num(draft, "inworld_year", 0)}
            onChange={(e) => patch({ inworld_year: Number(e.target.value) })}
          />
        </Field>
        <Field label="Месяц">
          {months.length > 0 ? (
            <select
              value={num(draft, "inworld_month", 1)}
              onChange={(e) => patch({ inworld_month: Number(e.target.value) })}
            >
              {months.map((m) => (
                <option key={m.position} value={m.position}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              value={num(draft, "inworld_month", 1)}
              onChange={(e) => patch({ inworld_month: Number(e.target.value) })}
            />
          )}
        </Field>
        <Field label="День">
          <input
            type="number"
            value={num(draft, "inworld_day", 1)}
            onChange={(e) => patch({ inworld_day: Number(e.target.value) })}
          />
        </Field>
      </div>
      <TextAreaField
        label="Краткое описание"
        value={str(draft, "description")}
        onChange={(v) => patch({ description: v })}
      />
      <label className="row" style={{ alignItems: "center" }}>
        <input
          type="checkbox"
          checked={!!draft.important}
          onChange={(e) => patch({ important: e.target.checked })}
        />
        Важное событие
      </label>
    </div>
  );
}

function EventParticipantsStep({
  draft,
  patch,
  ctx,
}: {
  draft: WizardDraft;
  patch: Patch;
  ctx: WizardContext;
}) {
  const { locations, beings, communities, artifacts } = useSettingOptions(ctx.settingId);
  return (
    <div className="stack">
      <MultiPickField
        label="Локации"
        options={locations}
        selected={arr(draft, "location_ids")}
        onChange={(v) => patch({ location_ids: v })}
        emptyLabel="В сеттинге ещё нет локаций."
      />
      <MultiPickField
        label="Участники: личности и существа"
        options={beings}
        selected={arr(draft, "being_ids")}
        onChange={(v) => patch({ being_ids: v })}
        emptyLabel="В сеттинге пока нет существ."
      />
      <MultiPickField
        label="Участники: сообщества"
        options={communities}
        selected={arr(draft, "community_ids")}
        onChange={(v) => patch({ community_ids: v })}
        emptyLabel="В сеттинге пока нет сообществ."
      />
      <MultiPickField
        label="Предметы сокровищницы"
        options={artifacts}
        selected={arr(draft, "artifact_ids")}
        onChange={(v) => patch({ artifact_ids: v })}
        emptyLabel="В сокровищнице пока пусто."
      />
    </div>
  );
}

export function eventSteps(): WizardStep[] {
  return [
    {
      title: "Дата и описание",
      render: (draft, patch, ctx) => <EventDateStep draft={draft} patch={patch} ctx={ctx} />,
    },
    {
      title: "Полное описание",
      render: (draft, patch) => (
        <TextAreaField
          label="Полное описание"
          rows={8}
          value={str(draft, "full_description")}
          onChange={(v) => patch({ full_description: v })}
        />
      ),
    },
    {
      title: "Участники",
      render: (draft, patch, ctx) => <EventParticipantsStep draft={draft} patch={patch} ctx={ctx} />,
    },
    {
      title: "Последствия",
      render: (draft, patch) => (
        <TextAreaField
          label="Последствия"
          rows={6}
          value={str(draft, "consequences")}
          onChange={(v) => patch({ consequences: v })}
        />
      ),
    },
  ];
}
