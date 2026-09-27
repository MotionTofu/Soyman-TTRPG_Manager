// Лист D&D, блок Артефактора: реплики, схемы, выбор основы и передача.
import type { ReplicaLimits, ReplicaBonus, ReplicaGeneric } from "./dndResources";
import type { DndCharacterData, DndReplicaScheme, DndReplicaItem, DndEquipmentItem, CompendiumEntry, Statblock } from "../../types";
import { useState, useEffect } from "react";
import { useConfirm } from "../../hooks/useConfirm";
import { EMPTY_EQUIPMENT_ITEM, makeEquipmentId, fetchEquipmentMeta } from "./dndEquipment";
import { useCompendiumEntries } from "./useCompendiumEntries";
import { Modal } from "../Modal";
import { NavIcon } from "../NavIcons";
import { MentionText } from "../mentions/MentionText";
import { useResource, write } from "../../data/hooks";
import { readResource, afterWriteAnywhere } from "../../data/imperative";
import { statblockListPath, statblockAffects } from "../../data/statblocks";
import { ensureEntries, getCachedEntry } from "./entryCache";
import { loadDndEquipmentEntries } from "./dndCompendium";

export function DndReplicaBlock({
  limits,
  value,
  systemId,
  campaignId,
  ownerCharacterId,
  replicaBonus,
  onQuickUpdate,
}: {
  limits: ReplicaLimits;
  value: DndCharacterData;
  systemId: number | null;
  campaignId?: number | null;
  ownerCharacterId?: number | null;
  /** Бонус сверх таблицы (Лучший бронник) — строкой, не форсингом. */
  replicaBonus?: ReplicaBonus | null;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openScheme, setOpenScheme] = useState<DndReplicaScheme | null>(null);
  const [openItem, setOpenItem] = useState<DndReplicaItem | null>(null);
  const [giving, setGiving] = useState<DndReplicaItem | null>(null);
  const [given, setGiven] = useState("");
  const [confirmDialog, confirm] = useConfirm();

  const schemes = (value.replicaSchemes ?? []).filter((s) => s.classId === limits.classId);
  const items = (value.replicaItems ?? []).filter((i) => i.classId === limits.classId);
  // Предел — таблица плюс прибавка («Лучший бронник»): она видна плашкой в
  // шапке карточки, а число уже с ней.
  const maxSchemes = limits.schemes + (replicaBonus?.schemes ?? 0);
  const maxItems = limits.items + (replicaBonus?.items ?? 0);

  function setSchemes(next: DndReplicaScheme[]) {
    const others = (value.replicaSchemes ?? []).filter((s) => s.classId !== limits.classId);
    onQuickUpdate?.({ replicaSchemes: [...others, ...next] });
  }

  // «Оружие +1» и «Доспех +1» — не предмет, а прибавка: чем именно она
  // станет, решает игрок, поэтому у таких схем спрашивается базовый предмет
  // (решение R3). Признак — прибавка в названии схемы.
  function needsBase(scheme: DndReplicaScheme): boolean {
    return /\+\s*\d/.test(scheme.name);
  }

  function createItem(
    scheme: DndReplicaScheme,
    base?: { name: string; entryId: number | null; meta: Partial<DndEquipmentItem> }
  ) {
    if (!onQuickUpdate) return;
    const id = `replica-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const bonusMatch = /\+\s*(\d)/.exec(scheme.name);
    const bonus = bonusMatch ? Number(bonusMatch[1]) : 0;
    const item: DndReplicaItem = {
      id,
      schemeEntryId: scheme.entryId,
      name: scheme.name,
      classId: limits.classId,
      baseName: base?.name,
      baseEntryId: base?.entryId ?? null,
    };
    // Одна строка инвентаря, а не две: базовый предмет со своими КЗ и уроном
    // плюс прибавка и пометка «магический».
    const row: DndEquipmentItem = base
      ? {
          ...EMPTY_EQUIPMENT_ITEM,
          ...base.meta,
          id: makeEquipmentId(),
          name: bonus ? `${base.name} +${bonus}` : base.name,
          entryId: base.entryId,
          magical: true,
          magicBonus: bonus || undefined,
          notes: `реплика: ${scheme.name}`,
          replicaId: id,
        }
      : {
          ...EMPTY_EQUIPMENT_ITEM,
          id: makeEquipmentId(),
          name: scheme.name,
          entryId: scheme.entryId,
          magical: true,
          notes: "реплика",
          replicaId: id,
        };
    const sections = value.equipmentSections.length > 0 ? value.equipmentSections : [{ name: "Общее", items: [] }];
    onQuickUpdate({
      replicaItems: [...(value.replicaItems ?? []), item],
      equipmentSections: sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, row] } : sec)),
    });
  }

  function removeItem(item: DndReplicaItem) {
    if (!onQuickUpdate) return;
    onQuickUpdate({
      replicaItems: (value.replicaItems ?? []).filter((i) => i.id !== item.id),
      equipmentSections: value.equipmentSections.map((sec) => ({
        ...sec,
        items: sec.items.filter((row) => row.replicaId !== item.id),
      })),
    });
  }

  const bonusFrom = replicaBonus?.from.length ? ` от «${replicaBonus.from.join("», «")}»` : "";
  const bonusNote = replicaBonus?.notes.join(" · ") || undefined;
  // Макет Sheet-PC-Resources-Artificer (гриллинг 2026-09-26, Q1–Q11): две
  // карточки «умею → сделал», строка целиком открывает окно, пределы —
  // крупным «N / M» в шапке и по-прежнему не запирают (R4).
  return (
    <div className="stack dnd-replica-block">
      {confirmDialog}
      <h3 className="dnd-replica-heading">Реплики магических предметов</h3>
      <div className="dnd-replica-grid">
        <div className="dnd-replica-card">
          <ReplicaCardHead
            title="Схемы"
            count={schemes.length}
            max={maxSchemes}
            plate={replicaBonus && replicaBonus.schemes > 0 ? `+${replicaBonus.schemes}${bonusFrom}` : ""}
            plateTitle={bonusNote}
          />
          {schemes.length === 0 && <span className="muted">Схемы не выбраны.</span>}
          {schemes.map((scheme) => {
            const made = items.filter((i) => i.schemeEntryId === scheme.entryId).length;
            return (
              <button key={scheme.entryId} type="button" className="dnd-replica-line" onClick={() => setOpenScheme(scheme)}>
                <span className="dnd-replica-name">{scheme.name}</span>
                {made > 0 && <span className="dnd-replica-made">создано: {made}</span>}
              </button>
            );
          })}
          {onQuickUpdate && (
            <button type="button" className="dnd-replica-add" onClick={() => setPickerOpen(true)}>
              + выбрать схемы
            </button>
          )}
        </div>
        <div className="dnd-replica-card">
          <ReplicaCardHead
            title="Созданные предметы"
            count={items.length}
            max={maxItems}
            plate={replicaBonus && replicaBonus.items > 0 ? `+${replicaBonus.items}${bonusFrom}` : ""}
            plateTitle={bonusNote}
          />
          {items.length === 0 && <span className="muted">Ничего не создано.</span>}
          {items.map((item) => (
            <button key={item.id} type="button" className="dnd-replica-line" onClick={() => setOpenItem(item)}>
              <span className="dnd-replica-name">
                {replicaItemTitle(item)}
                {item.baseName && <span className="dnd-replica-sub">по схеме: {item.name}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>

      {pickerOpen && (
        <DndReplicaSchemePicker
          limits={limits}
          chosen={schemes}
          systemId={systemId}
          onClose={() => setPickerOpen(false)}
          onChange={setSchemes}
        />
      )}
      {given && <span className="muted">{given}</span>}
      {giving && (
        <DndReplicaHandover
          item={giving}
          campaignId={campaignId}
          ownerCharacterId={ownerCharacterId}
          giverName={value.characterName || "Артефактор"}
          onClose={() => setGiving(null)}
          onDone={() => {
            setGiven(`Передано: ${giving.baseName ? `${giving.baseName} — ` : ""}${giving.name}`);
            setGiving(null);
          }}
        />
      )}
      {openScheme && (
        <DndReplicaSchemeModal
          scheme={openScheme}
          made={items.filter((i) => i.schemeEntryId === openScheme.entryId).length}
          needsBase={needsBase(openScheme)}
          systemId={systemId}
          canCreate={!!onQuickUpdate}
          onClose={() => setOpenScheme(null)}
          onCreate={(base) => {
            createItem(openScheme, base);
            setOpenScheme(null);
          }}
        />
      )}
      {openItem && (
        <DndReplicaItemModal
          item={openItem}
          canEdit={!!onQuickUpdate}
          onClose={() => setOpenItem(null)}
          onGive={() => {
            setGiving(openItem);
            setOpenItem(null);
          }}
          onRemove={async () => {
            const ok = await confirm({
              title: "Убрать предмет?",
              message: `«${replicaItemTitle(openItem)}» исчезнет и из «Снаряжения».`,
              confirmLabel: "Убрать",
            });
            if (!ok) return;
            removeItem(openItem);
            setOpenItem(null);
          }}
        />
      )}
    </div>
  );
}

/** Имя созданного предмета так же, как строка в «Снаряжении»:
 *  «Длинный меч +1», а не «Длинный меч — Оружие +1» (Q11). */
function replicaItemTitle(item: DndReplicaItem): string {
  if (!item.baseName) return item.name;
  const bonus = /\+\s*(\d)/.exec(item.name);
  return bonus ? `${item.baseName} +${bonus[1]}` : item.baseName;
}

function ReplicaCardHead({
  title,
  count,
  max,
  plate,
  plateTitle,
}: {
  title: string;
  count: number;
  max: number;
  plate: string;
  plateTitle?: string;
}) {
  return (
    <div className="dnd-replica-head">
      <span className="dnd-replica-head-title">
        <span className="sb-label">{title}</span>
        {plate && (
          <span className="dnd-special-mark" title={plateTitle}>
            {plate}
          </span>
        )}
      </span>
      <b className={`dnd-replica-count${count > max ? " dnd-limit-over" : ""}`}>
        {count}
        <span> / {max}</span>
      </b>
    </div>
  );
}

function replicaEntryMeta(entry: CompendiumEntry | undefined): string {
  const d = (entry?.data ?? {}) as { item_type?: unknown; rarity?: unknown; attunement?: unknown };
  return [
    typeof d.item_type === "string" ? d.item_type : "",
    typeof d.rarity === "string" ? d.rarity.toLowerCase() : "",
    d.attunement ? "требует настройки" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Окно схемы: описание и «Создать»; у «+N» второй шаг — основа тем же
 *  окном, с «Назад» (Q10). */
function DndReplicaSchemeModal({
  scheme,
  made,
  needsBase,
  systemId,
  canCreate,
  onCreate,
  onClose,
}: {
  scheme: DndReplicaScheme;
  made: number;
  needsBase: boolean;
  systemId: number | null;
  canCreate: boolean;
  onCreate: (base?: { name: string; entryId: number | null; meta: Partial<DndEquipmentItem> }) => void;
  onClose: () => void;
}) {
  const getEntry = useCompendiumEntries([scheme.entryId]);
  const entry = getEntry(scheme.entryId);
  const [step, setStep] = useState<"about" | "base">("about");
  const [base, setBase] = useState<CompendiumEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = replicaEntryMeta(entry);
  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-spell-modal dnd-replica-modal">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="dnd-spell-modal-title">
            <h3 style={{ margin: 0 }}>{scheme.name}</h3>
            <div className="dnd-spell-modal-en">{step === "base" ? "выберите основу" : "схема"}</div>
          </div>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        {step === "about" ? (
          <>
            {meta && <span className="muted">{meta}</span>}
            {entry?.description?.trim() ? <MentionText text={entry.description} /> : null}
            {made > 0 && <span className="dnd-replica-made" style={{ alignSelf: "flex-start" }}>создано: {made}</span>}
            {canCreate && (
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="primary" onClick={() => (needsBase ? setStep("base") : onCreate())}>
                  Создать
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <ReplicaBaseList title={scheme.name} systemId={systemId} selectedId={base?.id ?? null} onSelect={setBase} />
            <div className="row dnd-replica-foot" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setStep("about")}>
                Назад
              </button>
              <button
                type="button"
                className="primary"
                disabled={!base || busy}
                onClick={async () => {
                  if (!base) return;
                  setBusy(true);
                  const m = await fetchEquipmentMeta(base.id).catch(() => ({}));
                  onCreate({ name: base.name, entryId: base.id, meta: m });
                }}
              >
                Создать
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function DndReplicaItemModal({
  item,
  canEdit,
  onGive,
  onRemove,
  onClose,
}: {
  item: DndReplicaItem;
  canEdit: boolean;
  onGive: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const getEntry = useCompendiumEntries([item.schemeEntryId, item.baseEntryId ?? null]);
  const entry = getEntry(item.schemeEntryId);
  const baseEntry = item.baseEntryId != null ? getEntry(item.baseEntryId) : undefined;
  const baseMeta = baseEntry
    ? [baseEntry.data.weapon_category, baseEntry.data.damage, baseEntry.data.armor_type]
        .filter((x): x is string => typeof x === "string" && !!x)
        .join(" · ")
    : "";
  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-spell-modal dnd-replica-modal">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="dnd-spell-modal-title">
            <h3 style={{ margin: 0 }}>{replicaItemTitle(item)}</h3>
            {item.baseName && <div className="dnd-spell-modal-en">по схеме: {item.name}</div>}
          </div>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        {baseMeta ? <span className="muted">{baseMeta}</span> : replicaEntryMeta(entry) && <span className="muted">{replicaEntryMeta(entry)}</span>}
        {entry?.description?.trim() ? <MentionText text={entry.description} /> : null}
        {canEdit && (
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={onGive}>
              Передать
            </button>
            <button type="button" onClick={onRemove}>
              Убрать
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Передать созданный предмет участнику кампании (решение R2/W8).
 *
 * Системы уведомлений в приложении нет вовсе — ни таблицы, ни экрана, — и
 * заводить её ради одной кнопки значит построить половину мессенджера.
 * Поэтому «уведомление» здесь и есть сама строка в инвентаре получателя:
 * она приходит с пометкой «не принято» и двумя кнопками, а на вкладке
 * «Инвентарь» появляется точка. Полноценные уведомления — отдельной задачей.
 *
 * Пишется чужой лист патчем одного поля (`contentPatch`), а не снимком: у
 * получателя лист может быть открыт в этот самый момент, и снимок стёр бы
 * его правку.
 */
function DndReplicaHandover({
  item,
  campaignId,
  ownerCharacterId,
  giverName,
  onDone,
  onClose,
}: {
  item: DndReplicaItem;
  campaignId?: number | null;
  ownerCharacterId?: number | null;
  giverName: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const party = useResource<{ id: number; character_name: string; player_name: string }[]>(
    campaignId ? `/characters?campaign_id=${campaignId}` : null
  );
  // null — список ещё грузится; не загрузился — передавать некому, как раньше.
  const targets = !campaignId
    ? []
    : party.data
    ? party.data.filter((c) => c.id !== ownerCharacterId)
    : party.error
    ? []
    : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function give(target: { id: number; character_name: string }) {
    setBusy(true);
    setError("");
    try {
      // Чужой лист — свежим: поверх него сразу пишется раздел снаряжения.
      const sheets = await readResource<Statblock[]>(statblockListPath("character", target.id), { fresh: true });
      const sheet = sheets.find((s) => s.format === "dnd_character");
      if (!sheet) {
        setError(`У «${target.character_name}» нет чарника D&D — передать некуда.`);
        return;
      }
      const data = JSON.parse(sheet.content || "{}") as DndCharacterData;
      const sections =
        Array.isArray(data.equipmentSections) && data.equipmentSections.length > 0
          ? data.equipmentSections
          : [{ name: "Общее", items: [] }];
      const row: DndEquipmentItem = {
        ...EMPTY_EQUIPMENT_ITEM,
        id: makeEquipmentId(),
        name: item.baseName ? `${item.baseName} — ${item.name}` : item.name,
        entryId: item.baseEntryId ?? item.schemeEntryId,
        magical: true,
        notes: `реплика от «${giverName}»`,
        pendingFrom: giverName,
      };
      await write.put(`/statblocks/${sheet.id}`, {
        contentPatch: {
          equipmentSections: sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, row] } : sec)),
        },
      });
      afterWriteAnywhere(statblockAffects("character", target.id));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-replica-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Передать: {item.baseName ? `${item.baseName} — ${item.name}` : item.name}</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          Предмет ляжет получателю в инвентарь строкой «не принято» — принять или вернуть он решит
          сам. У вас предмет останется в счёте созданных: исчезает он вместе с репликой, а не с
          передачей.
        </div>
        {error && <p className="sb-save-error">{error}</p>}
        {targets === null && <p className="muted">Загрузка…</p>}
        {targets !== null && targets.length === 0 && (
          <p className="muted">
            {campaignId ? "В кампании больше никого нет." : "Персонаж не в кампании — передавать некому."}
          </p>
        )}
        {(targets ?? []).map((t) => (
          <div key={t.id} className="row dnd-replica-row">
            <span style={{ flex: "1 1 12ch", minWidth: 0 }}>
              {t.character_name}
              {t.player_name && <span className="muted"> · {t.player_name}</span>}
            </span>
            <button type="button" className="comp-mini" disabled={busy} onClick={() => void give(t)}>
              Передать
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Выбор схем: список доступных на текущем уровне, с поиском. */
/** Подходит ли предмет под общую строку («любой обычный…»). */
function genericMatches(g: ReplicaGeneric, e: CompendiumEntry): boolean {
  const d = e.data as { rarity?: unknown; item_type?: unknown; cursed?: unknown } | undefined;
  if (g.rarity && d?.rarity !== g.rarity) return false;
  if (g.types && g.types.length > 0 && !g.types.includes(String(d?.item_type ?? ""))) return false;
  if (g.excludeTypes && g.excludeTypes.includes(String(d?.item_type ?? ""))) return false;
  if (g.excludeCursed && d?.cursed === true) return false;
  return true;
}

function DndReplicaSchemePicker({
  limits,
  chosen,
  systemId,
  onChange,
  onClose,
}: {
  limits: ReplicaLimits;
  chosen: DndReplicaScheme[];
  systemId: number | null;
  onChange: (next: DndReplicaScheme[]) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Map<number, CompendiumEntry> | null>(null);
  const [query, setQuery] = useState("");
  // Раскрытый общий шаблон + кандидаты-предметы под него.
  const [genericOpen, setGenericOpen] = useState<string | null>(null);
  const [genericItems, setGenericItems] = useState<CompendiumEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    ensureEntries(limits.available.map((s) => s.entryId))
      .then(() => {
        if (!alive) return;
        const map = new Map<number, CompendiumEntry>();
        for (const s of limits.available) {
          const e = getCachedEntry(s.entryId);
          if (e) map.set(s.entryId, e);
        }
        setEntries(map);
      })
      .catch(() => alive && setEntries(new Map()));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limits.classId, limits.level]);

  const q = query.trim().toLowerCase();
  const rows = (entries ? limits.available : [])
    .map((s) => ({ scheme: s, entry: entries!.get(s.entryId) }))
    .filter((r) => r.entry && (!q || r.entry.name.toLowerCase().includes(q)))
    .sort(
      (a, b) => a.scheme.minLevel - b.scheme.minLevel || a.entry!.name.localeCompare(b.entry!.name, "ru")
    );

  function toggle(entryId: number, name: string) {
    // Именные схемы — без genericId: выбор из общего шаблона того же предмета
    // считается отдельной схемой (по книге) и чекбоксом не снимается.
    const has = chosen.some((c) => c.entryId === entryId && (c.genericId ?? null) === null);
    onChange(
      has
        ? chosen.filter((c) => !(c.entryId === entryId && (c.genericId ?? null) === null))
        : [...chosen, { entryId, name, classId: limits.classId }]
    );
  }

  function openGeneric(g: ReplicaGeneric) {
    if (genericOpen === g.id) {
      setGenericOpen(null);
      return;
    }
    setGenericOpen(g.id);
    setGenericItems(null);
    if (!systemId) {
      setGenericItems([]);
      return;
    }
    loadDndEquipmentEntries(systemId)
      .then((all) => {
        setGenericItems(
          all
            .filter((e) => e.kind === "magic_item" && genericMatches(g, e))
            .sort((a, b) => a.name.localeCompare(b.name, "ru"))
        );
      })
      .catch(() => setGenericItems([]));
  }

  function addGeneric(g: ReplicaGeneric, entry: CompendiumEntry) {
    // Каждый выбор по общему шаблону — отдельная схема: дубли разрешены.
    onChange([...chosen, { entryId: entry.id, name: entry.name, classId: limits.classId, genericId: g.id }]);
  }

  function removeGenericPick(genericId: string, occurrence: number) {
    let seen = -1;
    onChange(
      chosen.filter((c) => {
        if ((c.genericId ?? null) !== genericId) return true;
        seen++;
        return seen !== occurrence;
      })
    );
  }

  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-replica-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Схемы реплик</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          {limits.className} {limits.level} · выбрано {chosen.length} из {limits.schemes} · доступно{" "}
          {limits.available.length}
        </div>
        <input placeholder="Поиск по названию" value={query} onChange={(e) => setQuery(e.target.value)} />
        {entries === null && <p className="muted">Загрузка…</p>}
        {entries !== null && rows.length === 0 && <p className="muted">Ничего не нашлось.</p>}
        {rows.map(({ scheme, entry }) => (
          <label key={scheme.entryId} className="row dnd-replica-row">
            <input
              type="checkbox"
              checked={chosen.some((c) => c.entryId === scheme.entryId && (c.genericId ?? null) === null)}
              onChange={() => toggle(scheme.entryId, entry!.name)}
            />
            <span style={{ flex: "1 1 12ch", minWidth: 0 }}>{entry!.name}</span>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              с {scheme.minLevel} ур.
            </span>
          </label>
        ))}
        {limits.generics.length > 0 && (
          <>
            <h4 style={{ margin: "8px 0 0" }}>Общие схемы</h4>
            <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)" }}>
              Любой подходящий предмет — отдельная схема за каждый выбор.
            </p>
            {limits.generics.map((g) => {
              const picked = chosen.filter((c) => (c.genericId ?? null) === g.id);
              const open = genericOpen === g.id;
              return (
                <div key={g.id} className="stack" style={{ gap: 4 }}>
                  <div className="row dnd-replica-row" style={{ justifyContent: "space-between" }}>
                    <span style={{ flex: "1 1 12ch", minWidth: 0 }}>
                      {g.label} <span className="muted">с {g.minLevel} ур.</span>
                    </span>
                    <button type="button" className="comp-mini" onClick={() => openGeneric(g)}>
                      {open ? "Скрыть" : `Выбрать (${picked.length})`}
                    </button>
                  </div>
                  {picked.map((p, k) => (
                    <div key={`${p.entryId}-${k}`} className="row" style={{ gap: 6, alignItems: "center" }}>
                      <span className="muted" style={{ flex: "1 1 12ch", minWidth: 0 }}>
                        ↳ {p.name}
                      </span>
                      <button
                        type="button"
                        className="comp-mini danger"
                        aria-label={`Убрать выбор: ${p.name}`}
                        onClick={() => removeGenericPick(g.id, k)}
                      >
                        <NavIcon name="close" />
                      </button>
                    </div>
                  ))}
                  {open && (
                    <div className="stack" style={{ gap: 2 }}>
                      {genericItems === null && <p className="muted">Загрузка…</p>}
                      {genericItems !== null && genericItems.length === 0 && (
                        <p className="muted">Ничего не подошло.</p>
                      )}
                      {genericItems !== null &&
                        genericItems
                          .filter((e) => !q || e.name.toLowerCase().includes(q))
                          .slice(0, 60)
                          .map((e) => (
                            <div key={e.id} className="row dnd-replica-row" style={{ justifyContent: "space-between" }}>
                              <span style={{ flex: "1 1 12ch", minWidth: 0 }}>{e.name}</span>
                              <button type="button" className="comp-mini" onClick={() => addGeneric(g, e)}>
                                ＋ схема
                              </button>
                            </div>
                          ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Какое именно оружие (доспех, щит) стало «+1» — решение R3. */
export function DndReplicaBasePicker({
  title,
  only,
  systemId,
  onPick,
  onClose,
}: {
  /** Название прибавки («Доспех +1»): по слову в нём отбирается база. */
  title: string;
  /** Только эти основы по имени («Эльфийская кольчуга»: кольчуга, рубаха). */
  only?: string[];
  systemId: number | null;
  onPick: (base: { name: string; entryId: number | null; meta: Partial<DndEquipmentItem> }) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<CompendiumEntry | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-replica-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{title}: что именно?</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        <ReplicaBaseList title={title} only={only} systemId={systemId} selectedId={picked?.id ?? null} onSelect={setPicked} />
        <div className="row dnd-replica-foot" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            className="primary"
            disabled={!picked || busy}
            onClick={async () => {
              if (!picked) return;
              setBusy(true);
              const meta = await fetchEquipmentMeta(picked.id).catch(() => ({}));
              onPick({ name: picked.name, entryId: picked.id, meta });
            }}
          >
            Выбрать
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Основа для прибавки «+N»: поиск и список с отметкой. Прибавка ложится
 *  на базовый предмет — в инвентаре одна строка, помеченная магической. */
function ReplicaBaseList({
  title,
  only,
  systemId,
  selectedId,
  onSelect,
}: {
  title: string;
  only?: string[];
  systemId: number | null;
  selectedId: number | null;
  onSelect: (entry: CompendiumEntry) => void;
}) {
  const [options, setOptions] = useState<CompendiumEntry[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!systemId) {
      setOptions([]);
      return;
    }
    loadDndEquipmentEntries(systemId)
      .then(setOptions)
      .catch(() => setOptions([]));
  }, [systemId]);

  // Отбор по тому же слову, что стоит в названии схемы: «Оружие +1» — оружие,
  // «Доспех +1» — доспехи, «Щит +1» — щиты.
  const wanted = /доспех/i.test(title) ? "armor" : /щит/i.test(title) ? "shield" : "weapon";
  const q = query.trim().toLowerCase();
  const rows = (options ?? []).filter((e) => {
    // Основа — обычный предмет: «Латы дварфов» с классом доспеха в данных
    // основой для «Доспеха +1» не бывают.
    if (e.kind !== "equipment") return false;
    if (only) return only.includes(e.name) && (!q || e.name.toLowerCase().includes(q));
    const armorType = typeof e.data.armor_type === "string" ? e.data.armor_type : "";
    const isShield = armorType.trim().toLowerCase().startsWith("щит");
    const kind = isShield ? "shield" : armorType ? "armor" : e.data.damage ? "weapon" : "";
    if (kind !== wanted) return false;
    return !q || e.name.toLowerCase().includes(q);
  });

  return (
    <>
      <input placeholder="Поиск" aria-label="Поиск основы" value={query} onChange={(e) => setQuery(e.target.value)} />
      {options === null && <p className="muted">Загрузка…</p>}
      {options !== null && rows.length === 0 && <p className="muted">Ничего не нашлось.</p>}
      <div className="dnd-replica-base-list">
        {rows.map((entry) => (
          <label key={entry.id} className={`dnd-replica-base${entry.id === selectedId ? " is-picked" : ""}`}>
            <input type="radio" name="replica-base" checked={entry.id === selectedId} onChange={() => onSelect(entry)} />
            <span className="dnd-replica-name">{entry.name}</span>
            {typeof baseEntryStat(entry) === "string" && <span className="muted">{baseEntryStat(entry)}</span>}
          </label>
        ))}
      </div>
    </>
  );
}

function baseEntryStat(entry: CompendiumEntry): string | undefined {
  const d = entry.data.damage ?? entry.data.armor_class;
  return typeof d === "string" ? d : typeof d === "number" ? `КЗ ${d}` : undefined;
}
