import { LocationCascadePicker } from "../LocationCascadePicker";
import { MonsterTemplatePicker } from "../MonsterTemplatePicker";
import { CREATABLE_BEING_CATEGORIES } from "../../beingCategories";
import {
  AliasesField,
  AvatarField,
  Field,
  MultiPickField,
  RelationsField,
  TextAreaField,
  TextField,
  useSettingOptions,
  type DraftRelation,
} from "./fields";
import type { SearchResult } from "../../types";
import type { WizardContext, WizardDraft, WizardStep } from "./types";

export type Patch = (values: WizardDraft) => void;

export const str = (draft: WizardDraft, key: string) => (typeof draft[key] === "string" ? (draft[key] as string) : "");
export const arr = (draft: WizardDraft, key: string) => (Array.isArray(draft[key]) ? (draft[key] as number[]) : []);
export const strArr = (draft: WizardDraft, key: string) =>
  Array.isArray(draft[key]) ? (draft[key] as string[]) : [];

// ————— Локация —————

function LocationBasicsStep({ draft, patch }: { draft: WizardDraft; patch: Patch }) {
  return (
    <div className="stack">
      <TextField
        label="Тип локации"
        value={str(draft, "kind")}
        placeholder="континент, город, таверна…"
        onChange={(v) => patch({ kind: v })}
      />
      <AliasesField
        aliases={strArr(draft, "aliases")}
        nameOriginal={str(draft, "name_original")}
        onChange={(aliases, nameOriginal) => patch({ aliases, name_original: nameOriginal })}
      />
      <TextField
        label="Короткое имя для карты"
        value={str(draft, "short_name")}
        hint="Показывается вместо полного названия в подписи пина на карте."
        onChange={(v) => patch({ short_name: v })}
      />
      <TextAreaField
        label="Короткое описание"
        value={str(draft, "description")}
        onChange={(v) => patch({ description: v })}
      />
      <AvatarField file={(draft.avatar as File) ?? null} onChange={(f) => patch({ avatar: f })} />
    </div>
  );
}

function LocationTreeStep({ draft, patch, ctx }: { draft: WizardDraft; patch: Patch; ctx: WizardContext }) {
  const { locations, rawLocations } = useSettingOptions(ctx.settingId);
  return (
    <div className="stack">
      <Field label="Родительская локация">
        <LocationCascadePicker
          locations={rawLocations}
          value={(draft.parent_id as number | null) ?? null}
          onChange={(id) => patch({ parent_id: id })}
        />
      </Field>
      <MultiPickField
        label="Вложенные локации"
        hint="Уже существующие локации, которые станут дочерними для этой."
        options={locations}
        selected={arr(draft, "child_ids")}
        onChange={(v) => patch({ child_ids: v })}
        emptyLabel="В сеттинге ещё нет других локаций."
      />
    </div>
  );
}

function InhabitantsStep({ draft, patch, ctx }: { draft: WizardDraft; patch: Patch; ctx: WizardContext }) {
  const { beings, communities } = useSettingOptions(ctx.settingId);
  return (
    <div className="stack">
      <MultiPickField
        label="Обитатели: личности и существа"
        options={beings}
        selected={arr(draft, "inhabitant_being_ids")}
        onChange={(v) => patch({ inhabitant_being_ids: v })}
        emptyLabel="В сеттинге пока нет существ."
      />
      <MultiPickField
        label="Обитатели: сообщества"
        options={communities}
        selected={arr(draft, "inhabitant_community_ids")}
        onChange={(v) => patch({ inhabitant_community_ids: v })}
        emptyLabel="В сеттинге пока нет сообществ."
      />
    </div>
  );
}

export function EventsStep({ draft, patch, ctx }: { draft: WizardDraft; patch: Patch; ctx: WizardContext }) {
  const { events } = useSettingOptions(ctx.settingId);
  return (
    <MultiPickField
      label="Связанные события"
      hint="События хроники мира, к которым эта сущность имеет отношение."
      options={events}
      selected={arr(draft, "event_ids")}
      onChange={(v) => patch({ event_ids: v })}
      emptyLabel="В хронике мира пока нет событий."
    />
  );
}

export function locationSteps(): WizardStep[] {
  return [
    {
      title: "Описание",
      render: (draft, patch) => <LocationBasicsStep draft={draft} patch={patch} />,
    },
    {
      title: "Место в мире",
      render: (draft, patch, ctx) => <LocationTreeStep draft={draft} patch={patch} ctx={ctx} />,
    },
    {
      title: "Обитатели",
      render: (draft, patch, ctx) => <InhabitantsStep draft={draft} patch={patch} ctx={ctx} />,
    },
    {
      title: "События",
      render: (draft, patch, ctx) => <EventsStep draft={draft} patch={patch} ctx={ctx} />,
    },
  ];
}

// ————— Личность и существо бестиария —————

function BeingBasicsStep({
  draft,
  patch,
  withCategory,
}: {
  draft: WizardDraft;
  patch: Patch;
  withCategory: boolean;
}) {
  return (
    <div className="stack">
      {withCategory && (
        <Field label="Тип личности">
          <select value={str(draft, "category")} onChange={(e) => patch({ category: e.target.value })}>
            {CREATABLE_BEING_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field
        label="На основе существующего"
        hint="Запись бестиария или монстр компендиума. Его статблок и описание приедут копией — в карточку существа и в «Историю». Оставьте пустым, если существо новое."
      >
        <MonsterTemplatePicker
          value={(draft.base_monster as SearchResult | null) ?? null}
          onChange={(v) => patch({ base_monster: v })}
        />
      </Field>
      <AliasesField
        label="Альтернативные имена"
        aliases={strArr(draft, "aliases")}
        nameOriginal={str(draft, "name_original")}
        onChange={(aliases, nameOriginal) => patch({ aliases, name_original: nameOriginal })}
      />
      <TextField
        label="Короткое имя для карты"
        value={str(draft, "short_name")}
        onChange={(v) => patch({ short_name: v })}
      />
      <TextAreaField
        label="Короткое описание"
        value={str(draft, "description")}
        onChange={(v) => patch({ description: v })}
      />
      <AvatarField file={(draft.avatar as File) ?? null} onChange={(f) => patch({ avatar: f })} />
    </div>
  );
}

function BeingPlacesStep({ draft, patch, ctx }: { draft: WizardDraft; patch: Patch; ctx: WizardContext }) {
  const { locations, communities } = useSettingOptions(ctx.settingId);
  return (
    <div className="stack">
      <MultiPickField
        label="Места обитания"
        options={locations}
        selected={arr(draft, "location_ids")}
        onChange={(v) => patch({ location_ids: v })}
        emptyLabel="В сеттинге ещё нет локаций."
      />
      <MultiPickField
        label="Принадлежность к сообществам"
        options={communities}
        selected={arr(draft, "community_ids")}
        onChange={(v) => patch({ community_ids: v })}
        emptyLabel="В сеттинге ещё нет сообществ."
      />
    </div>
  );
}

function BeingRelationsStep({ draft, patch, ctx }: { draft: WizardDraft; patch: Patch; ctx: WizardContext }) {
  const { beings, communities } = useSettingOptions(ctx.settingId);
  return (
    <RelationsField
      beings={beings}
      communities={communities}
      relations={(draft.relations as DraftRelation[]) ?? []}
      onChange={(v) => patch({ relations: v })}
    />
  );
}

export function beingSteps(withCategory: boolean): WizardStep[] {
  return [
    {
      title: "Описание",
      render: (draft, patch) => (
        <BeingBasicsStep draft={draft} patch={patch} withCategory={withCategory} />
      ),
    },
    {
      title: "Места и сообщества",
      render: (draft, patch, ctx) => <BeingPlacesStep draft={draft} patch={patch} ctx={ctx} />,
    },
    {
      title: "Отношения",
      render: (draft, patch, ctx) => <BeingRelationsStep draft={draft} patch={patch} ctx={ctx} />,
    },
    {
      title: "События",
      render: (draft, patch, ctx) => <EventsStep draft={draft} patch={patch} ctx={ctx} />,
    },
  ];
}
