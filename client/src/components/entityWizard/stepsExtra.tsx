import { CompendiumEntryPicker } from "../MonsterTemplatePicker";
import { LocationCascadePicker } from "../LocationCascadePicker";
import { ITEM_CLASSES, MAGIC_ITEM_RARITIES, itemTypeOptions } from "../../compendium";
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
import { EventsStep, arr, str, strArr, type Patch } from "./steps";
import type { SearchResult } from "../../types";
import type { WizardContext, WizardDraft, WizardStep } from "./types";

// Шаги сообщества и предмета сокровищницы. Лежат отдельно от локации и
// личности только ради размера файла — устроены точно так же.

// ————— Сообщество —————

function CommunityBasicsStep({ draft, patch }: { draft: WizardDraft; patch: Patch }) {
  return (
    <div className="stack">
      <AliasesField
        aliases={strArr(draft, "aliases")}
        nameOriginal={str(draft, "name_original")}
        onChange={(aliases, nameOriginal) => patch({ aliases, name_original: nameOriginal })}
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

function CommunityPlacesStep({ draft, patch, ctx }: { draft: WizardDraft; patch: Patch; ctx: WizardContext }) {
  const { locations } = useSettingOptions(ctx.settingId);
  return (
    <MultiPickField
      label="Места обитания"
      options={locations}
      selected={arr(draft, "location_ids")}
      onChange={(v) => patch({ location_ids: v })}
      emptyLabel="В сеттинге ещё нет локаций."
    />
  );
}

function CommunityMembersStep({ draft, patch, ctx }: { draft: WizardDraft; patch: Patch; ctx: WizardContext }) {
  const { beings, communities } = useSettingOptions(ctx.settingId);
  return (
    <div className="stack">
      <MultiPickField
        label="Вложенные сообщества"
        hint="Существующие сообщества, которые встанут внутрь этого."
        options={communities}
        selected={arr(draft, "child_ids")}
        onChange={(v) => patch({ child_ids: v })}
        emptyLabel="В сеттинге ещё нет других сообществ."
      />
      <MultiPickField
        label="Представители"
        options={beings}
        selected={arr(draft, "member_ids")}
        onChange={(v) => patch({ member_ids: v })}
        emptyLabel="В сеттинге пока нет существ."
      />
    </div>
  );
}

function CommunityRelationsStep({ draft, patch, ctx }: { draft: WizardDraft; patch: Patch; ctx: WizardContext }) {
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

export function communitySteps(): WizardStep[] {
  return [
    { title: "Описание", render: (draft, patch) => <CommunityBasicsStep draft={draft} patch={patch} /> },
    {
      title: "Места обитания",
      render: (draft, patch, ctx) => <CommunityPlacesStep draft={draft} patch={patch} ctx={ctx} />,
    },
    {
      title: "Состав",
      render: (draft, patch, ctx) => <CommunityMembersStep draft={draft} patch={patch} ctx={ctx} />,
    },
    {
      title: "Отношения",
      render: (draft, patch, ctx) => <CommunityRelationsStep draft={draft} patch={patch} ctx={ctx} />,
    },
    { title: "События", render: (draft, patch, ctx) => <EventsStep draft={draft} patch={patch} ctx={ctx} /> },
  ];
}

// ————— Предмет сокровищницы —————

function ArtifactBasicsStep({ draft, patch }: { draft: WizardDraft; patch: Patch }) {
  return (
    <div className="stack">
      <TextField
        label="Короткое имя для карты"
        value={str(draft, "short_name")}
        onChange={(v) => patch({ short_name: v })}
      />
      <AliasesField
        aliases={strArr(draft, "aliases")}
        nameOriginal={str(draft, "name_original")}
        onChange={(aliases, nameOriginal) => patch({ aliases, name_original: nameOriginal })}
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

function ArtifactPlaceStep({ draft, patch, ctx }: { draft: WizardDraft; patch: Patch; ctx: WizardContext }) {
  const { rawLocations, beings, communities } = useSettingOptions(ctx.settingId);
  const ownerValue =
    str(draft, "owner_type") && draft.owner_id ? `${str(draft, "owner_type")}:${draft.owner_id}` : "";
  return (
    <div className="stack">
      <Field
        label="Предмет в компендиуме"
        hint="Запись системы, описывающая этот же предмет. Одна вещь с двух сторон: у сеттинга — своя, у системы — механика."
      >
        <CompendiumEntryPicker
          value={(draft.compendium_entry as SearchResult | null) ?? null}
          onChange={(v) => patch({ compendium_entry: v })}
          // Род выбирается следующим шагом, поэтому по умолчанию ищем среди
          // магических предметов; для снаряжения — среди снаряжения.
          kind={str(draft, "item_class") === "equipment" ? "equipment" : "magic_item"}
          placeholder="Найти предмет в компендиуме…"
          selectedLabel="Из компендиума"
        />
      </Field>
      <Field label="Локация">
        <LocationCascadePicker
          locations={rawLocations}
          value={(draft.location_id as number | null) ?? null}
          onChange={(id) => patch({ location_id: id })}
          rootLabel="— не указана —"
          clearLabel="✕ Убрать локацию"
        />
      </Field>
      <Field label="Владелец" hint="Личность или сообщество, у которых предмет на руках.">
        <select
          value={ownerValue}
          onChange={(e) => {
            if (!e.target.value) return patch({ owner_type: null, owner_id: null });
            const [type, id] = e.target.value.split(":");
            patch({ owner_type: type, owner_id: Number(id) });
          }}
        >
          <option value="">— не указан —</option>
          {beings.map((b) => (
            <option key={`being:${b.id}`} value={`being:${b.id}`}>
              {b.name}
            </option>
          ))}
          {communities.map((c) => (
            <option key={`community:${c.id}`} value={`community:${c.id}`}>
              {c.name} (сообщество)
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function ArtifactClassStep({ draft, patch }: { draft: WizardDraft; patch: Patch }) {
  const itemClass = str(draft, "item_class");
  const types = itemTypeOptions(itemClass);
  return (
    <div className="stack">
      <Field label="Род предмета">
        <select
          value={itemClass}
          onChange={(e) => {
            const next = e.target.value;
            // Тип из прежнего списка в новом может отсутствовать, а редкость и
            // настройка у снаряжения не бывают — сбрасываем, чтобы в записи не
            // осталось значения, которого в выбранном роде нет.
            const type = str(draft, "item_type");
            patch({
              item_class: next,
              item_type: itemTypeOptions(next).includes(type) ? type : "",
              ...(next === "equipment" ? { rarity: "", requires_attunement: false } : {}),
            });
          }}
        >
          <option value="">— не указан —</option>
          {ITEM_CLASSES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Тип предмета">
        <select value={str(draft, "item_type")} onChange={(e) => patch({ item_type: e.target.value })}>
          <option value="">— не указан —</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      {itemClass !== "equipment" && (
        <>
          <Field label="Редкость">
            <select value={str(draft, "rarity")} onChange={(e) => patch({ rarity: e.target.value })}>
              <option value="">— не указана —</option>
              {MAGIC_ITEM_RARITIES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <label className="row" style={{ alignItems: "center" }}>
            <input
              type="checkbox"
              checked={!!draft.requires_attunement}
              onChange={(e) => patch({ requires_attunement: e.target.checked })}
            />
            Требует настройки
          </label>
        </>
      )}
    </div>
  );
}

export function artifactSteps(): WizardStep[] {
  return [
    { title: "Описание", render: (draft, patch) => <ArtifactBasicsStep draft={draft} patch={patch} /> },
    {
      title: "Место и владелец",
      render: (draft, patch, ctx) => <ArtifactPlaceStep draft={draft} patch={patch} ctx={ctx} />,
    },
    { title: "Классификация", render: (draft, patch) => <ArtifactClassStep draft={draft} patch={patch} /> },
    {
      title: "Сила и свойства",
      render: (draft, patch) => (
        <TextAreaField
          label="Сила / свойства"
          rows={6}
          value={str(draft, "power")}
          onChange={(v) => patch({ power: v })}
        />
      ),
    },
    { title: "События", render: (draft, patch, ctx) => <EventsStep draft={draft} patch={patch} ctx={ctx} /> },
  ];
}
