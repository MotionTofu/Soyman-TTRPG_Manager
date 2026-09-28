// Лист D&D, «Снаряжение»: быстрый вид, правка разделов, строки и меню
// предметов, подбор из справочника, кошелёк и нагрузка.
import type { DndEquipmentItem, DndEquipmentSection, DndCoins, CompendiumEntry, DndCharacterData, SearchResult } from "../../types";
import { rasterAsset } from "../../rasterAssets";
import { isRationRow, makeEquipmentId, fetchEquipmentMeta, carryCapacityLb, EMPTY_EQUIPMENT_ITEM, isStackableEquipmentEntry, isArmorProficient, entryRequiresAttunement } from "./dndEquipment";
import { useState, useRef, useEffect, memo, type DragEvent, useMemo, useCallback, type ReactNode } from "react";
import { NavIcon } from "../NavIcons";
import { useConfirm } from "../../hooks/useConfirm";
import { useEvent, useLatest } from "../../hooks/useEvent";
import { readSearchDrop, SheetModalHead } from "./sheetShared";
import { LB_PER_KG, formatWeight } from "../../dndPrefs";
import { useDndPrefs } from "../../hooks/useDndPrefs";
import { plural } from "../../sceneKinds";
import { useDndRuntime } from "./DndRuntime";
import { useBag } from "../../bag";
import { transferAction } from "./characterTransfers";
import { readResource } from "../../data/imperative";
import { loadDndEquipmentEntries } from "./dndCompendium";
import { DndReplicaBasePicker } from "./SheetReplicas";
import { Modal } from "../Modal";
import { MentionText } from "../mentions/MentionText";
import { DndCoinCalculator } from "./DndCoinCalculator";

// Renders the cached armor/weapon fields (snapshotted by fetchEquipmentMeta)
// as a compact tag line above the item's compendium description, so the
// "what does this do" info shows even though the fields live outside the
// free-text description.
function equipmentTagsLine(item: DndEquipmentItem): string {
  const parts: string[] = [];
  if (item.armorType) {
    parts.push(item.armorType);
    // У щита в поле `ac` лежит не базовое значение, а прибавка — подписываем
    // её плюсом, чтобы строка не читалась как «КЗ 2».
    const shield = item.armorType.trim().toLowerCase().startsWith("щит");
    if (item.ac) parts.push(shield ? `+${item.ac} КЗ` : `КЗ ${item.ac}`);
    if (!shield) {
      // У щита `dex_bonus: false` значит «щит сам Ловкость не добавляет», а не
      // «Ловкость не считается» — подпись только для доспехов.
      if (item.maxDexBonus) parts.push(`Макс. бонус Лов ${item.maxDexBonus}`);
      else if (item.dexBonus === false || item.armorType.trim().toLowerCase().startsWith("тяж"))
        parts.push("Ловкость не применяется");
    }
  }
  if (item.acBonus) parts.push(`+${item.acBonus} КЗ`);
  if (item.itemType) parts.push(item.itemType);
  if (item.rarity) parts.push(item.rarity);
  if (item.requiresAttunement) parts.push("требует настройки");
  if (item.cursed) parts.push("проклят");
  if (item.attuned) parts.push("настроен");
  if (item.magical) parts.push("магический");
  if (item.weaponDamage) {
    const type = item.weaponAttackMelee && item.weaponAttackRanged ? "Ближняя/дальняя атака" : item.weaponAttackRanged ? "Дальняя атака" : "Ближняя атака";
    parts.push(type, item.weaponDamage);
  }
  if (item.weaponProperties) parts.push(item.weaponProperties);
  if (item.weaponMastery) parts.push(`Мастерство: ${item.weaponMastery}`);
  return parts.join(" · ");
}

/**
 * Значок предмета: восемь рисованных плиток на всё снаряжение.
 *
 * Значок отвечает на один вопрос — «это оружие, доспех, расходник или
 * барахло»; более дробный набор на 19 px перестаёт читаться и превращается
 * в ребус (гриллинг 2026-09-10). Категория выводится из снимка справочника
 * (`armorType`, `weaponDamage`, `chargesMax`, `itemType`), а у вписанных
 * руками строк — по имени: снимка у них нет, а рюкзак вместо зелья
 * выглядит поломкой.
 */
type EquipmentIconKey = "shield" | "sword" | "wand" | "potion" | "amulet" | "pouch" | "key" | "pack";
function equipmentIconKey(item: DndEquipmentItem): EquipmentIconKey {
  const text = `${item.itemType ?? ""} ${item.name}`.toLowerCase();
  if (item.armorType || /доспех|щит|броня|кольчуг|латы/.test(text)) return "shield";
  if (item.weaponDamage || /меч|топор|кинжал|лук|копь|булав|молот|посох|арбалет|оруж/.test(text)) return "sword";
  if (item.chargesMax || /палочк|жезл|стерж|скипетр/.test(text)) return "wand";
  if (/зель|элексир|эликсир|фляг|склянк|яд|масло/.test(text)) return "potion";
  if (/кольц|амулет|подвеск|оберег|брошь|перстен|плащ|накидк/.test(text)) return "amulet";
  if (/рацион|паёк|паек|еда|провиз|мешоч|кошел|сумк|припас/.test(text)) return "pouch";
  if (/инструм|отмычк|воровск|набор|ключ|верёв|верев|снаряж/.test(text)) return "key";
  return "pack";
}

/**
 * Плитка предмета. Активное — в цвете, лежащее в рюкзаке — чёрно-белое.
 *
 * Это не украшение, а сама метка «активно»: близкое горит, далёкое гаснет
 * (решение владельца, гриллинг 2026-09-10). Отдельного кружка «надето»
 * в строке больше нет — плитка и есть мишень.
 */
function EquipmentIcon({ item }: { item: DndEquipmentItem }) {
  return (
    <img
      className={`dnd-item-icon${item.equipped ? " is-active" : ""}`}
      src={rasterAsset("inventory", equipmentIconKey(item)) ?? undefined}
      alt=""
      aria-hidden="true"
      // Наклейка узнаёт, но не сообщает (правило растра п.2): имя предмета
      // стоит в строке рядом, ховер повторяет его на самой плитке.
      title={item.name}
      draggable={false}
    />
  );
}

/**
 * Метки строки — не больше двух.
 *
 * У предмета их бывает семь; если показывать все, вторая строка раздувается
 * и цена с весом уезжают за край. Порядок — по тому, меняют ли они решение
 * за столом: проклятие и отсутствие владения меняют, «без механики» — нет.
 */
function equipmentMarks(item: DndEquipmentItem, armorProficient: boolean | null): { text: string; title: string }[] {
  const all: { text: string; title: string }[] = [];
  if (item.cursed) all.push({ text: "проклят", title: "Проклят: снять можно только в правке с подтверждением" });
  if (armorProficient === false) all.push({ text: "без владения", title: "Нет владения этим доспехом: мешает заклинаниям" });
  if (isRationRow(item)) {
    const q = String(item.qty ?? "").trim();
    if (q !== "" && isValidQty(q) && parseQty(q) >= 1 && parseQty(q) <= 3) {
      all.push({ text: "мало", title: "Рационы заканчиваются" });
    }
  }
  if (String(item.qty ?? "").trim() !== "" && !isValidQty(String(item.qty ?? ""))) {
    all.push({ text: "счёт?", title: "Счёт — целое ≥ 0, напр. 2; иначе в вес не считается" });
  }
  if (String(item.weight ?? "").trim() !== "" && !isValidWeight(String(item.weight ?? ""))) {
    all.push({ text: "вес?", title: "Вес — число ≥ 0 с единицей, напр. 5 кг; иначе в вес не считается" });
  }
  if (magicPlusWithoutBase(item) != null || baseChoiceWithoutBase(item)) {
    all.push({ text: "основа?", title: "Выберите в меню строки, на чём лежит прибавка, — до этого КЗ и атака её не считают" });
  }
  if (item.attuned) all.push({ text: "настроен", title: "Настроено — занимает слот настройки" });
  if (item.replicaId) all.push({ text: "реплика", title: "Создано умением: исчезнет вместе с ним" });
  // У строки из набора визарда («выбрать самому») пометка уже есть — вторая
  // «без механики» рядом лишняя (владелец 2026-09-26).
  if (!item.entryId && item.notes !== "выбрать самому")
    all.push({ text: "без механики", title: "Вписано вручную: КЗ, вес и цена из справочника не подтянуты" });
  return all.slice(0, 2);
}

// «Доспех +1», «Щит +2», «Оружие +3» из справочника — не вещь, а прибавка к
// базовой (решение R3, гриллинг 2026-09-23 Q19). Пока база не выбрана, у
// строки нет ни КЗ, ни урона, и прибавка никуда не идёт.
function magicPlusWithoutBase(item: DndEquipmentItem): number | null {
  if (item.armorType || item.weaponDamage || item.magicBonus) return null;
  const m = /^\s*(доспех|щит|оружие)\s*\+\s*(\d)/i.exec(item.name ?? "");
  return m ? Number(m[2]) : null;
}

// «Эльфийская кольчуга» — магический доспех с выбором основы (Q8): своё имя
// и эффекты остаются, КЗ и тип берутся у выбранной основы.
function baseChoiceWithoutBase(item: DndEquipmentItem): string[] | null {
  return item.baseOptions?.length && !item.armorType && !item.weaponDamage ? item.baseOptions : null;
}

/** Тихая вторая строка: цена, вес, заметка. Из имени они ушли — длинное
 *  название иначе превращается в кашу из точек и скобок. */
function equipmentSubParts(item: DndEquipmentItem): string[] {
  const parts: string[] = [];
  if (item.cost) parts.push(item.cost);
  if (item.weight) parts.push(item.weight);
  if (item.notes) parts.push(item.notes);
  return parts;
}

/**
 * Меню строки — всё, чего не делают в бою.
 *
 * В строке осталась одна кнопка (трата); порядок, правка, пополнение,
 * настройка, передача и удаление живут здесь. Закрывается по выбору,
 * по Escape и по щелчку мимо: за столом меню, оставшееся открытым, — это
 * следующий случайный тап не туда.
 */
function EquipmentRowMenu({ label, items }: { label: string; items: { text: string; danger?: boolean; onPick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent | TouchEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    // globalThis.KeyboardEvent, а не react'овский: одноимённый тип React
    // импортирован выше и перекрывает DOM-овский.
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("touchstart", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("touchstart", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="dnd-row-menu" ref={boxRef}>
      <button
        type="button"
        className="comp-mini dnd-row-menu-btn"
        aria-label={`${label}: ещё`}
        aria-expanded={open}
        title="Ещё"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋮
      </button>
      {open && (
        <div className="dnd-row-menu-list" role="menu">
          {items.map((it) => (
            <button
              key={it.text}
              type="button"
              role="menuitem"
              className={`dnd-row-menu-item${it.danger ? " is-danger" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onPick();
              }}
            >
              {it.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Requirement 14: Снаряжение as named sections of structured items,
// drag-and-droppable both within and between sections. A drag payload of
// `{ sectionIndex, itemIndex }` (JSON, custom MIME) identifies the item
// being moved; a search-result drop (compendium/etc.) adds a new item
// instead, marked "(свиток)" for spells — mirroring the old free-text
// behavior where a dropped spell became a scroll, not the spell itself.
const EQUIPMENT_DRAG_MIME = "application/x-rpg-equipment-item";

// One equipment item row. Memoized with stable per-row callbacks (built by
// EquipmentSectionBlock below) — a section can hold a dozen-plus items, and
// without this, editing one item's field re-rendered every other item row
// in the same section on every keystroke.
const EquipmentItemRow = memo(function EquipmentItemRow({
  item,
  onChangeName,
  onChangeQty,
  onChangeWeight,
  onChangeNotes,
  onToggleEquipped,
  onRemove,
  onDragStart,
  onMoveUp,
  onMoveDown,
}: {
  item: DndEquipmentItem;
  onChangeName: (v: string) => void;
  onChangeQty: (v: string) => void;
  onChangeWeight: (v: string) => void;
  onChangeNotes: (v: string) => void;
  onToggleEquipped: () => void;
  onRemove: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
}) {
  return (
    <div className="row dnd-equipment-item-row" draggable onDragStart={onDragStart}>
      {/* Та же плитка, что и за столом: активное в цвете, лежащее в рюкзаке
          чёрно-белое. Органы правки здесь остаются на виду — прятать их под
          меню значит удлинять редактирование на клик ради красоты. */}
      <button
        type="button"
        className={`dnd-item-icon-btn${item.equipped ? " is-active" : ""}`}
        title={item.equipped ? "Активно — под рукой" : "В рюкзаке"}
        aria-label={`${item.name || "Предмет"}: ${item.equipped ? "активно" : "в рюкзаке"}`}
        aria-pressed={!!item.equipped}
        onClick={onToggleEquipped}
      >
        <EquipmentIcon item={item} />
      </button>
      <input placeholder="Название" value={item.name} onChange={(e) => onChangeName(e.target.value)} style={{ flex: 2 }} />
      <input placeholder="Кол-во" value={item.qty} onChange={(e) => onChangeQty(e.target.value)} style={{ flex: 1 }} />
      <input placeholder="Вес" value={item.weight} onChange={(e) => onChangeWeight(e.target.value)} style={{ flex: 1 }} />
      <input placeholder="Заметка" value={item.notes} onChange={(e) => onChangeNotes(e.target.value)} style={{ flex: 2 }} />
      <span className="row" style={{ gap: 2, flex: "0 0 auto" }} role="group" aria-label={`${item.name || "Предмет"}: порядок`}>
        <button type="button" className="comp-mini" onClick={onMoveUp ?? undefined} disabled={!onMoveUp} aria-label="Выше" title="Переместить выше">
          ↑
        </button>
        <button type="button" className="comp-mini" onClick={onMoveDown ?? undefined} disabled={!onMoveDown} aria-label="Ниже" title="Переместить ниже">
          ↓
        </button>
      </span>
      <button type="button" className="comp-mini" onClick={onRemove} aria-label="Удалить предмет">
        <NavIcon name="close" />
      </button>
    </div>
  );
});

// One named section. Memoized, and manages its own items' add/update/remove
// locally (mirroring FeatureListEdit) so a keystroke inside one section
// never touches the others — cross-section moves still go through the
// parent's onDrop, which is the only operation that needs to see every
// section at once.
const EquipmentSectionBlock = memo(function EquipmentSectionBlock({
  si,
  section,
  isDragOver,
  onNameChange,
  onRemoveSection,
  onItemsChange,
  onSectionDragOver,
  onSectionDragLeave,
  onSectionDrop,
}: {
  si: number;
  section: DndEquipmentSection;
  isDragOver: boolean;
  onNameChange: (v: string) => void;
  onRemoveSection: () => void;
  onItemsChange: (items: DndEquipmentItem[]) => void;
  onSectionDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onSectionDragLeave: () => void;
  onSectionDrop: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const [confirmDialog, confirm] = useConfirm();

  const updateItem = useEvent((ii: number, patch: Partial<DndEquipmentItem>) => {
    const next = section.items.slice();
    next[ii] = { ...next[ii], ...patch };
    onItemsChange(next);
  });
  // Удаление вынесено во второй `useEvent`: после `await` замыкание держит
  // список на момент открытия диалога, а его нужно взять на момент ответа.
  const dropItemAt = useEvent((ii: number) => onItemsChange(section.items.filter((_, idx) => idx !== ii)));
  const removeItem = useEvent(async (ii: number) => {
    const name = section.items[ii]?.name || "предмет";
    const ok = await confirm({ title: "Удалить предмет?", message: `Удалить «${name}»?`, confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    dropItemAt(ii);
  });
  function addItem() {
    onItemsChange([...section.items, { id: makeEquipmentId(), name: "", qty: "", weight: "", notes: "" }]);
  }
  // Порядок внутри секции — кнопками: drag между секциями есть, а внутри
  // moveItem молча выходил (fromSi === toSi). На таче кнопки — единственный путь.
  const moveItem = useEvent((ii: number, delta: -1 | 1) => {
    const jj = ii + delta;
    if (jj < 0 || jj >= section.items.length) return;
    const next = section.items.slice();
    [next[ii], next[jj]] = [next[jj], next[ii]];
    onItemsChange(next);
  });

  const items = section.items;
  /* Колбэки по индексу строки пересобираются только при смене числа строк, а не
     на каждое нажатие клавиши: иначе memo строки не срабатывает и правка одной
     перерисовывает весь список. Функции внутри — useEvent, их ссылка постоянна,
     а свежие данные они читают сами, поэтому items.length вместо items — сознательно. */
  /* eslint-disable react-hooks/exhaustive-deps */
  const nameCallbacks = useMemo(
    () => items.map((_, ii) => (v: string) => updateItem(ii, { name: v })),
    [items.length, updateItem]
  );
  const qtyCallbacks = useMemo(
    () => items.map((_, ii) => (v: string) => updateItem(ii, { qty: v })),
    [items.length, updateItem]
  );
  const weightCallbacks = useMemo(
    () => items.map((_, ii) => (v: string) => updateItem(ii, { weight: v })),
    [items.length, updateItem]
  );
  const notesCallbacks = useMemo(
    () => items.map((_, ii) => (v: string) => updateItem(ii, { notes: v })),
    [items.length, updateItem]
  );
  const removeCallbacks = useMemo(() => items.map((_, ii) => () => removeItem(ii)), [items.length, removeItem]);
  const moveUpCallbacks = useMemo(
    () => items.map((_, ii) => (ii > 0 ? () => moveItem(ii, -1) : null)),
    [items.length, moveItem]
  );
  const moveDownCallbacks = useMemo(
    () => items.map((_, ii) => (ii < items.length - 1 ? () => moveItem(ii, 1) : null)),
    [items.length, moveItem]
  );
  const equippedCallbacks = useMemo(
    () => items.map((_, ii) => () => updateItem(ii, { equipped: !items[ii].equipped })),
    [items, updateItem]
  );
  const dragStartCallbacks = useMemo(
    () =>
      items.map(
        (_, ii) => (e: DragEvent<HTMLDivElement>) =>
          e.dataTransfer.setData(EQUIPMENT_DRAG_MIME, JSON.stringify({ sectionIndex: si, itemIndex: ii }))
      ),
    [items.length, si]
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <>
      {confirmDialog}
      <div
        className={`dnd-equipment-section${isDragOver ? " drag-over" : ""}`}
        onDragOver={onSectionDragOver}
        onDragLeave={onSectionDragLeave}
        onDrop={onSectionDrop}
      >
        <div className="row">
          <input
            className="dnd-equipment-section-name"
            value={section.name}
            onChange={(e) => onNameChange(e.target.value)}
          />
          <button type="button" className="comp-mini" onClick={onRemoveSection}>
            <NavIcon name="delete" /> Раздел
          </button>
        </div>
      <div className="stack" style={{ gap: 4 }}>
        {items.map((item, ii) => (
          <EquipmentItemRow
            key={item.id ?? ii}
            item={item}
            onChangeName={nameCallbacks[ii]}
            onChangeQty={qtyCallbacks[ii]}
            onChangeWeight={weightCallbacks[ii]}
            onChangeNotes={notesCallbacks[ii]}
            onToggleEquipped={equippedCallbacks[ii]}
            onRemove={removeCallbacks[ii]}
            onDragStart={dragStartCallbacks[ii]}
            onMoveUp={moveUpCallbacks[ii]}
            onMoveDown={moveDownCallbacks[ii]}
          />
        ))}
        {items.length === 0 && (
          <span className="muted">Пусто — перетащите предмет из поиска или добавьте в быстром виде.</span>
        )}
        <button type="button" className="comp-mini" onClick={addItem} style={{ alignSelf: "flex-start" }}>
          + Добавить предмет
        </button>
      </div>
      </div>
    </>
  );
});

// Memoized for the same reason as DndSpellsEdit/FeatureListEdit — one of the
// larger subtrees on the sheet (drag-and-drop, multiple named sections).
export const DndEquipmentEdit = memo(function DndEquipmentEdit({
  sections,
  onChange,
}: {
  sections: DndEquipmentSection[];
  onChange: (v: DndEquipmentSection[]) => void;
}) {
  const [dragOverSection, setDragOverSection] = useState<number | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  // Свежий список после await: handleDrop ждёт мету из сети, а пишет поверх
  // того, что было на момент дропа. useEvent свеж только на входе.
  const sectionsRef = useLatest(sections);

  function addSection() {
    onChange([...sections, { name: "Новый раздел", items: [] }]);
  }
  // Шаблон разделов: новичок валит всё в «Общее», а спрашивают за столом
  // «где зелья». Добавляет только недостающие — существующие не тронет.
  function addTemplateSections() {
    const template = ["Оружие", "Броня", "Расходники", "Магия", "Прочее"];
    const have = new Set(sections.map((s) => s.name.trim().toLowerCase()));
    const missing = template.filter((t) => !have.has(t.toLowerCase()));
    if (missing.length === 0) return;
    onChange([...sections, ...missing.map((name) => ({ name, items: [] }))]);
  }
  const updateSectionName = useEvent((si: number, name: string) => {
    const next = sections.slice();
    next[si] = { ...next[si], name };
    onChange(next);
  });
  // Как и с предметами: список берётся заново после ответа на диалог.
  const dropSectionAt = useEvent((si: number) => onChange(sections.filter((_, idx) => idx !== si)));
  const removeSection = useEvent(async (si: number) => {
    const name = sections[si]?.name || "раздел";
    const ok = await confirm({ title: "Удалить раздел?", message: `Удалить «${name}» и все предметы в нём?`, confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    dropSectionAt(si);
  });
  const setSectionItems = useEvent((si: number, items: DndEquipmentItem[]) => {
    const next = sections.slice();
    next[si] = { ...next[si], items };
    onChange(next);
  });
  const moveItem = useEvent((fromSi: number, fromIi: number, toSi: number) => {
    // Чужой/битый JSON в dataTransfer раньше ронял splice на undefined.
    if (!Number.isInteger(fromSi) || !Number.isInteger(fromIi) || !Number.isInteger(toSi)) return;
    if (fromSi === toSi) return;
    const src = sections[fromSi];
    if (!src || !sections[toSi]) return;
    if (fromIi < 0 || fromIi >= src.items.length) return;
    const next = sections.map((s) => ({ ...s, items: s.items.slice() }));
    const [item] = next[fromSi].items.splice(fromIi, 1);
    if (!item) return;
    next[toSi].items.push(item);
    onChange(next);
  });
  const handleDrop = useEvent(async (e: DragEvent<HTMLDivElement>, si: number) => {
    e.preventDefault();
    setDragOverSection(null);
    const movePayload = e.dataTransfer.getData(EQUIPMENT_DRAG_MIME);
    if (movePayload) {
      try {
        const { sectionIndex, itemIndex } = JSON.parse(movePayload);
        moveItem(sectionIndex, itemIndex, si);
      } catch {}
      return;
    }
    const result = readSearchDrop(e);
    if (!result) return;
    const suffix = result.kind === "spell" ? " (свиток)" : "";
    // Дроп из поиска в режиме полной правки: ссылку на запись не теряем —
    // иначе предмет станет «ручным». Мета догружается, магпредметы с флагом.
    if (result.type === "compendium_entry" && (result.kind === "equipment" || result.kind === "magic_item")) {
      const meta = await fetchEquipmentMeta(result.id).catch(() => ({} as Partial<DndEquipmentItem>));
      const { entryId: _eid, magical: _mag, ...restMeta } = meta;
      const next = sectionsRef.current.map((s, idx) =>
        idx === si
          ? {
              ...s,
              items: [
                ...s.items,
                {
                  id: makeEquipmentId(),
                  name: result.title,
                  qty: "",
                  weight: "",
                  notes: "",
                  ...restMeta,
                  entryId: result.id,
                  ...(result.kind === "magic_item" ? { magical: true } : null),
                },
              ],
            }
          : s
      );
      onChange(next);
      return;
    }
    const next = sectionsRef.current.map((s, idx) =>
      idx === si
        ? { ...s, items: [...s.items, { id: makeEquipmentId(), name: `${result.title}${suffix}`, qty: "", weight: "", notes: "" }] }
        : s
    );
    onChange(next);
  });

  /* Колбэки по индексу строки пересобираются только при смене числа строк, а не
     на каждое нажатие клавиши: иначе memo строки не срабатывает и правка одной
     перерисовывает весь список. Функции внутри — useEvent, их ссылка постоянна,
     а свежие данные они читают сами, поэтому sections.length вместо sections — сознательно. */
  /* eslint-disable react-hooks/exhaustive-deps */
  const nameChangeCallbacks = useMemo(
    () => sections.map((_, si) => (v: string) => updateSectionName(si, v)),
    [sections.length, updateSectionName]
  );
  const removeSectionCallbacks = useMemo(
    () => sections.map((_, si) => () => removeSection(si)),
    [sections.length, removeSection]
  );
  const itemsChangeCallbacks = useMemo(
    () => sections.map((_, si) => (items: DndEquipmentItem[]) => setSectionItems(si, items)),
    [sections.length, setSectionItems]
  );
  const dragOverCallbacks = useMemo(
    () =>
      sections.map((_, si) => (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOverSection(si);
      }),
    [sections.length]
  );
  const dragLeaveCallback = useCallback(() => setDragOverSection(null), []);
  const dropCallbacks = useMemo(
    () => sections.map((_, si) => (e: DragEvent<HTMLDivElement>) => handleDrop(e, si)),
    [sections.length, handleDrop]
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <div className="stack">
      {confirmDialog}
      <div className="dnd-equipment-head" style={{ margin: 0 }}>
        Снаряжение
      </div>
      {sections.map((section, si) => (
        <EquipmentSectionBlock
          key={si}
          si={si}
          section={section}
          isDragOver={dragOverSection === si}
          onNameChange={nameChangeCallbacks[si]}
          onRemoveSection={removeSectionCallbacks[si]}
          onItemsChange={itemsChangeCallbacks[si]}
          onSectionDragOver={dragOverCallbacks[si]}
          onSectionDragLeave={dragLeaveCallback}
          onSectionDrop={dropCallbacks[si]}
        />
      ))}
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
        <button type="button" onClick={addSection} style={{ alignSelf: "flex-start" }}>
          + Добавить раздел
        </button>
        <button type="button" className="dnd-chip" onClick={addTemplateSections} title="Оружие, Броня, Расходники, Магия, Прочее — только недостающие">
          + Шаблон разделов
        </button>
      </div>
    </div>
  );
});

/**
 * Чужой лист глазами Мастера: та же анатомия строки, но без единой кнопки.
 *
 * Кошелёк здесь есть намеренно — «сколько у игрока денег» Мастер спрашивает
 * часто, а править их отсюда нельзя (гриллинг 2026-09-10).
 */
function DndEquipmentView({ sections, coins }: { sections: DndEquipmentSection[]; coins?: DndCoins }) {
  const nonEmpty = sections.filter((s) => s.items.length > 0);
  if (nonEmpty.length === 0) return null;
  return (
    <>
      <div className="sb-section cs-mt">Снаряжение</div>
      {nonEmpty.map((section, si) => (
        <div key={si} className="sb-entry">
          {sections.length > 1 &&   <div className="dnd-section-title">{section.name}</div>}
          <ul className="dnd-equipment-view-list">
              {section.items.map((item, ii) => {
                const parts = equipmentSubParts(item);
                const marks = equipmentMarks(item, null);
                const qty = String(item.qty ?? "").trim();
                return (
                  <li key={item.id ?? ii}>
                    <div className="dnd-equipment-quick-row is-static">
                      <span className={`dnd-item-icon-btn${item.equipped ? " is-active" : ""}`}>
                        <EquipmentIcon item={item} />
                      </span>
                      <div className="dnd-equipment-name">
                        <span className="dnd-equipment-name-link">{item.name}</span>
                        {(parts.length > 0 || marks.length > 0) && (
                          <div className="dnd-item-sub">
                            {parts.length > 0 && <span className="dnd-item-sub-text">{parts.join(" · ")}</span>}
                            {marks.map((m) => (
                              <span key={m.text} className="dnd-mark-chip" title={m.title}>
                                {m.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="dnd-item-rt">
                        {item.chargesMax ? (
                          <>
                            <div className="dnd-item-rt-top">
                              {item.chargesLeft ?? "?"}/{item.chargesMax}
                            </div>
                            <div className="dnd-item-rt-bot">заряды</div>
                          </>
                        ) : qty !== "" ? (
                          <>
                            <div className="dnd-item-rt-top">×{qty}</div>
                            <div className="dnd-item-rt-bot">{isRationRow(item) ? "дня" : "шт."}</div>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
      {coins && <DndCoinPurse coins={coins} />}
    </>
  );
}

function isValidQty(v: string): boolean {
  // Кол-во — пусто или целое ≥0: дробные стрелы и «-2 зелья» не существуют.
  if (!v.trim()) return true;
  return /^\d+$/.test(v.trim());
}
export function parseQty(v: string): number {
  const t = v.trim();
  if (!t) return 1;
  if (!/^\d+$/.test(t)) return 1;
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}
function isValidWeight(v: string): boolean {
  // Вес — пусто или число ≥0 с необязательной единицей.
  if (!v.trim()) return true;
  return /^\d+([.,]\d+)?\s*(фунт(ов|а|ы)?|фнт\.?|lb|lbs|кг|kg)?$/i.test(v.trim());
}
function parseWeight(v: string): number | null {
  // Возвращает фунты: «5 кг» → ~11.02, без единицы — фунты, как раньше.
  // Мусор после числа («5xyz») больше не считается пятёркой — это невалид,
  // его подсвечивает чип в строке, а сводка пропускает.
  const m = /^(\d+(?:[.,]\d+)?)\s*(фунт(?:ов|а|ы)?|фнт\.?|lb|lbs|кг|kg)?$/i.exec(v.trim());
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = (m[2] ?? "").toLowerCase();
  return unit === "кг" || unit === "kg" ? n * LB_PER_KG : n;
}
function EquipmentInlineForm({
  draft,
  onChange,
  onSave,
  onCancel,
  onRemove,
}: {
  draft: DndEquipmentItem;
  onChange: (v: DndEquipmentItem) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const qtyOk = isValidQty(draft.qty);
  const wOk = isValidWeight(draft.weight);
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "4px 0" }}>
      <input
        autoFocus
        placeholder="Название"
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        style={{ flex: "2 1 140px" }}
      />
      <input
        placeholder="Кол-во"
        value={draft.qty}
        onChange={(e) => onChange({ ...draft, qty: e.target.value })}
        style={{ flex: "1 1 60px", borderColor: qtyOk ? undefined : "var(--accent)" }}
        title={qtyOk ? undefined : "Целое ≥ 0, напр. 2"}
      />
      <input
        placeholder="Вес"
        value={draft.weight}
        onChange={(e) => onChange({ ...draft, weight: e.target.value })}
          style={{ flex: "1 1 60px", borderColor: wOk ? undefined : "var(--accent)" }}
          title={wOk ? "Число ≥ 0 с единицей, напр. 5 кг" : "Число ≥ 0 с единицей, напр. 5 кг"}
      />
      <input
        placeholder="Заметка"
        value={draft.notes}
        onChange={(e) => onChange({ ...draft, notes: e.target.value })}
        style={{ flex: "2 1 120px" }}
      />
      {draft.chargesMax && (
        <input
          placeholder={`Заряды (макс ${draft.chargesMax})`}
          title="Остаток зарядов — числом"
          value={draft.chargesLeft ?? ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange({ ...draft, chargesLeft: v === "" ? null : Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : draft.chargesLeft ?? null });
          }}
          style={{ flex: "1 1 70px" }}
        />
      )}
      <label className="row" style={{ gap: 4, flex: "0 0 auto" }}>
        <input
          type="checkbox"
          checked={!!draft.equipped}
          onChange={(e) => onChange({ ...draft, equipped: e.target.checked })}
        />
        Надето
      </label>
      {(draft.requiresAttunement || draft.attuned) && (
        <label className="row" style={{ gap: 4, flex: "0 0 auto" }} title="Настройка занимает слот (максимум 3)">
          <input
            type="checkbox"
            checked={!!draft.attuned}
            onChange={(e) => onChange({ ...draft, attuned: e.target.checked })}
          />
          Настроено
        </label>
      )}
      <label className="row" style={{ gap: 4, flex: "0 0 auto" }} title="Проклятый предмет: снятие — с подтверждением">
        <input
          type="checkbox"
          checked={!!draft.cursed}
          onChange={(e) => onChange({ ...draft, cursed: e.target.checked })}
        />
        Проклят
      </label>
      <button type="button" className="primary" onClick={onSave} disabled={!draft.name.trim()}>
        Сохранить
      </button>
      <button type="button" onClick={onCancel}>
        Отмена
      </button>
      {onRemove && (
        <button type="button" className="danger" onClick={onRemove}>
          Удалить
        </button>
      )}
    </div>
  );
}

// Same read-only rows as DndEquipmentView, but a row's ✎ opens inline
// editing, clicking the name (for compendium-linked items) shows the
// description instead, an equipped toggle sits on the left, and each
// section gets three add affordances (свой ввод / компендиум / мешок) plus
// drag-drop straight from the bag/search — no need to open the full
// DndCharacterEdit form for a quick inventory tweak at the table.
// Стартовые наборы класса и предыстории, связанные ссылками на записи
// снаряжения (data.equipment_a_items / equipment_b_items). Пока набор не
// размечен ссылками, здесь пусто — текстовое описание набора живёт в
// компендиуме и переносится вручную, как и раньше.
// Порядок и подписи монет — от медной к платиновой. Электрум стоит между
// серебром и золотом, как в книге, хотя пользуются им редко.
const COIN_FIELDS = [
  { key: "cp", label: "ММ", title: "Медные монеты" },
  { key: "sp", label: "СМ", title: "Серебряные монеты" },
  { key: "ep", label: "ЭМ", title: "Электрумовые монеты" },
  { key: "gp", label: "ЗМ", title: "Золотые монеты" },
  { key: "pp", label: "ПМ", title: "Платиновые монеты" },
] as const satisfies readonly { key: keyof DndCoins; label: string; title: string }[];

const EMPTY_COINS: DndCoins = { cp: "", sp: "", ep: "", gp: "", pp: "" };

/** Строка состава набора: «Рюкзак [Backpack]» × qty. */
type PackContent = { ru: string; en: string; qty: number };

function readPackContents(entry: CompendiumEntry): PackContent[] {
  const raw = (entry.data as Record<string, unknown> | undefined)?.contents;
  if (!Array.isArray(raw)) return [];
  return (raw as { name?: unknown; qty?: unknown }[]).flatMap((x) => {
    const name = typeof x?.name === "string" ? x.name.trim() : "";
    if (!name) return [];
    const m = /^(.*?)\s*\[(.*)\]$/.exec(name);
    const qty = Number(x.qty);
    return [{ ru: m ? m[1] : name, en: m ? m[2] : "", qty: Number.isFinite(qty) && qty > 0 ? qty : 1 }];
  });
}

/**
 * Вес и число предметов (S-17): отданное (transferOut) исключено — физически
 * его уже нет. Невалидные qty/вес пропускаются (строка помечается чипом
 * «счёт?»/«вес?»). Вес хранится в фунтах; монеты весят по правилу книги:
 * 50 монет = 1 фунт.
 */
function equipmentLoad(sections: DndEquipmentSection[], coins: DndCoins | undefined, strength: number, doublings: number) {
  const all = sections.flatMap((s) => s.items).filter((i) => !i.transferOut);
  const capacityLb = carryCapacityLb(strength, doublings);
  let totalWeight = coinsCount(coins ?? EMPTY_COINS) / 50;
  let hasWeight = totalWeight > 0;
  for (const it of all) {
    const w = parseWeight(String(it.weight ?? ""));
    if (w != null) {
      totalWeight += w * parseQty(String(it.qty ?? ""));
      hasWeight = true;
    }
  }
  return { totalItems: all.length, totalWeight, capacityLb, overloaded: hasWeight && totalWeight > capacityLb };
}

/** Шапка «Снаряжения» (владелец 2026-09-26): трекер веса из макета
 *  боковой колонки — число предметов на месте подписи «Вес», справа вес из
 *  грузоподъёмности, под ними полоса. Перегруз — цветом. */
export function EquipmentLoadPlate({
  sections,
  coins,
  strength,
  doublings,
}: {
  sections: DndEquipmentSection[];
  coins?: DndCoins;
  strength: number;
  doublings: number;
}) {
  const prefs = useDndPrefs();
  const load = equipmentLoad(sections, coins, strength, doublings);
  const pct = Math.min(100, load.capacityLb > 0 ? (load.totalWeight / load.capacityLb) * 100 : 0);
  const [w, cap] = [formatWeight(load.totalWeight, prefs.weightUnit), formatWeight(load.capacityLb, prefs.weightUnit)];
  return (
    <div className={`dnd-load-plate${load.overloaded ? " is-over" : ""}`}>
      <div className="dnd-load-head">
        <span>
          {load.totalItems} {plural(load.totalItems, "предмет", "предмета", "предметов")}
        </span>
        <b>
          {w.replace(/\s*\S+$/, "")} <span>/ {cap}</span>
        </b>
      </div>
      <div className="dnd-weight-bar" role="img" aria-label={`Вес ${w} из ${cap}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Кошелёк: пять чеканных монет с числами, а не пять полей ввода.
 *
 * Монеты читают чаще, чем правят, поэтому по умолчанию это числа — поле
 * появляется по тапу и уходит по Enter/уходу фокуса. Пять пустых рамок в
 * подвале и были той «бухгалтерской формой», от которой уходим.
 * Без `onCommit` кошелёк только показывает: чужой лист у Мастера правится
 * не отсюда.
 */
function DndCoinPurse({
  coins,
  onCommit,
  onOpenCalc,
}: {
  coins: DndCoins;
  onCommit?: (next: DndCoins) => void;
  onOpenCalc?: () => void;
}) {
  const [editingKey, setEditingKey] = useState<keyof DndCoins | null>(null);
  const totalCp = coinsTotalCp(coins);
  const totalGp = Math.floor(totalCp / 100) + ((totalCp % 100) / 100);
  return (
    <div className="dnd-frame dnd-purse">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span className="sb-prop-label">Монеты</span>
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          ≈ {String(Math.round(totalGp * 10) / 10).replace(".", ",")} ЗМ
        </span>
      </div>
      <div className="dnd-purse-row">
        {/* Электрум пока убран (владелец 2026-09-26): «ЭМ» и «ЗМ» мелко не
            различить. Уже лежащий в кошельке — виден, чтобы не пропал. */}
        {COIN_FIELDS.filter(({ key }) => key !== "ep" || Number(coins.ep || 0) > 0).map(({ key, label, title }) => {
          const raw = coins[key] ?? "";
          const empty = raw.trim() === "" || raw.trim() === "0";
          return (
            <div key={key} className={`dnd-purse-coin${empty ? " is-empty" : ""}`}>
              <img className="dnd-purse-img" src={rasterAsset("coins", key) ?? undefined} alt="" aria-hidden="true" draggable={false} />
              {onCommit && editingKey === key ? (
                <input
                  className="dnd-purse-input"
                  inputMode="numeric"
                  autoFocus
                  value={raw}
                  aria-label={title}
                  onChange={(e) =>
                    // Монеты не бывают отрицательными: только цифры, до 6 знаков.
                    onCommit({ ...coins, [key]: e.target.value.replace(/[^\d]/g, "").slice(0, 6) })
                  }
                  onBlur={() => setEditingKey(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") setEditingKey(null);
                  }}
                />
              ) : onCommit ? (
                <button
                  type="button"
                  className="dnd-purse-num"
                  title={`${title} — правка`}
                  aria-label={`${title}: ${raw || 0}`}
                  onClick={() => setEditingKey(key)}
                >
                  {raw || 0}
                </button>
              ) : (
                <span className="dnd-purse-num" title={title}>
                  {raw || 0}
                </span>
              )}
              <span className="dnd-purse-label">{label}</span>
            </div>
          );
        })}
        {onOpenCalc && (
          <button type="button" className="dnd-chip dnd-purse-calc" onClick={onOpenCalc} title="Курс, делёж добычи и рассылка долей">
            Счёты
          </button>
        )}
      </div>
    </div>
  );
}

/** Весь кошелёк в медяках (курс книги: см=10, эм=50, зм=100, пм=1000). */
function coinsTotalCp(c: DndCoins): number {
  const num = (v: string | undefined) => {
    const n = parseInt(String(v ?? "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return num(c.cp) + num(c.sp) * 10 + num(c.ep) * 50 + num(c.gp) * 100 + num(c.pp) * 1000;
}

/** Штук монет в кошельке — для веса: 50 монет = 1 фунт независимо от чекана. */
function coinsCount(c: DndCoins): number {
  const num = (v: string | undefined) => {
    const n = parseInt(String(v ?? "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return num(c.cp) + num(c.sp) + num(c.ep) + num(c.gp) + num(c.pp);
}

export function DndEquipmentQuickView({
  sections,
  systemId,
  coins,
  accentColor,
  armorProfs,
  calcCampaignId,
  calcSenderId,
  calcSenderName,
  onCalcChanged,
  attunementMax,
  attunement,
  onTransferItem,
  onQuickUpdate,
}: {
  sections: DndEquipmentSection[];
  systemId: number | null;
  coins?: DndCoins;
  /** Цвет класса — кромка магических предметов, единственная краска. */
  accentColor?: string;
  /** Имена владений доспехами — надетое без владения помечается в тегах. */
  armorProfs?: readonly string[];
  /** Калькулятор монет: кампания и свой персонаж для дележа/рассылки. */
  calcCampaignId?: number | null;
  calcSenderId?: number | null;
  calcSenderName?: string;
  /** После рассылки долей: дотянуть передачи/входящие. */
  onCalcChanged?: () => void;
  /** Лимит слотов настройки (3 + extra): счёт и подтверждение сверх лимита
   *  живут там, где настраивают, а не только во вкладке магии. */
  attunementMax?: number;
  /** Блок настройки предметов — в боковую колонку рядом с весом и кошельком. */
  attunement?: ReactNode;
  /** Передать эту строку: меню строки открывает тот же диалог передачи,
   *  но с уже выбранным предметом — из строки он выбран, из шапки нет. */
  onTransferItem?: (itemKey: string) => void;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const [editing, setEditing] = useState<{ si: number; ii: number } | null>(null);
  const { detached, campaignConnected } = useDndRuntime();
  const [addingSection, setAddingSection] = useState<number | null>(null);
  const [addMode, setAddMode] = useState<"bag" | null>(null);
  const [draft, setDraft] = useState<DndEquipmentItem>(EMPTY_EQUIPMENT_ITEM);
  // Полноэкранный подбор из компендиума (этап 6): секция, для которой
  // открыта модалка. Пачка добавляется одним сохранением (appendItems).
  const [pickingSection, setPickingSection] = useState<number | null>(null);
  const [descOpen, setDescOpen] = useState<{ si: number; ii: number } | null>(null);
  const [descriptions, setDescriptions] = useState<Record<number, string>>({});
  const [dragOverSection, setDragOverSection] = useState<number | null>(null);
  // Строка «Доспех +N» без базы, для которой открыт выбор основы.
  const [baseRow, setBaseRow] = useState<{ si: number; ii: number } | null>(null);
  const { items: bagItems } = useBag();
  const [confirmDialog, confirm] = useConfirm();
  // Действия принятой передачи (вернуть/сделать своим) идут сервером, а не
  // локальным commit: строки живут в двух листах, и сводит их посредник.
  // Обновление листа после успеха приходит realtime-рассылкой сервера
  // (broadcastCharacterUpdate) — ждать его здесь не надо, только ошибку.
  const [transferBusy, setTransferBusy] = useState<number | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  // Хуки — все до раннего return (rules-of-hooks): поиск/фильтр,
  // калькулятор, цель перемещения, ошибки описаний и их контроллеры.
  const [equipQuery, setEquipQuery] = useState("");
  const [equipFilter, setEquipFilter] = useState<"all" | "equipped" | "magical">("all");
  const [calcOpen, setCalcOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<number | null>(null);
  const [descErrors, setDescErrors] = useState<Record<number, true>>({});
  // Состав наборов снаряжения (data.contents) — по записи набора, приезжает
  // вместе с описанием; есть состав — в окне кнопка «Распаковать».
  const [packContents, setPackContents] = useState<Record<number, PackContent[]>>({});
  const descControllers = useRef(new Map<number, AbortController>());
  // Свежий список после await: saveEdit/removeItem ждут диалог, мешок/пикер —
  // сеть, а пишут поверх того, что было на клик. useEvent свеж только на
  // входе — чтение после await идёт через реф (см. доку useLatest).
  const sectionsRef = useLatest(sections);
  async function settleTransfer(id: number, action: "return" | "claim") {
    setTransferBusy(id);
    setTransferError(null);
    try {
      await transferAction(id, action);
    } catch (e) {
      setTransferError(`Не вышло: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTransferBusy(null);
    }
  }

  // Nested function declarations below don't retain the `if (!onQuickUpdate)
  // return` narrowing above (TS control-flow narrowing doesn't cross
  // function boundaries) — capture a definitely-non-optional reference once
  // the guard has passed instead of re-checking `onQuickUpdate` at each call.
  if (!onQuickUpdate) return <DndEquipmentView sections={sections} coins={coins} />;
  // Пустой список разделов больше не прячет блок целиком: монеты живут здесь,
  // и у персонажа без единого предмета кошелёк всё равно есть.
  const commit = onQuickUpdate;

  function startEdit(si: number, ii: number) {
    setEditing({ si, ii });
    setMoveTarget(si);
    setAddingSection(null);
    setDraft({ ...sections[si].items[ii] });
  }
  function startAdd(si: number, mode: "bag" | null) {
    setAddingSection(si);
    setAddMode(mode);
    setEditing(null);
    setDraft(EMPTY_EQUIPMENT_ITEM);
  }
  function cancel() {
    setEditing(null);
    setMoveTarget(null);
    setAddingSection(null);
    setAddMode(null);
  }
  function saveEdit() {
    if (!editing || !draft.name.trim()) return;
    void (async () => {
      // Снятие проклятия — с подтверждением: замком, а не флажком.
      const original = sections[editing.si]?.items[editing.ii];
      if (original?.cursed && !draft.cursed) {
        const ok = await confirm({
          title: "Снять проклятие?",
          message: `«${original.name || "Предмет"}» перестанет быть проклятым.`,
          confirmLabel: "Снять",
        });
        if (!ok) return;
      }
      // Настройка сверх лимита из формы — тем же подтверждением, что на строке.
      if (draft.attuned && !original?.attuned) {
        const have = sectionsRef.current.flatMap((s) => s.items).filter((it) => it.attuned && !it.transferOut).length;
        if (have >= attuneMax) {
          const ok = await confirm({
            title: "Нет свободных слотов",
            message: `Настроено уже ${have} из ${attuneMax}. Настроить «${draft.name || "предмет"}» всё равно?`,
            confirmLabel: "Настроить",
          });
          if (!ok) return;
        }
      }
      // Перемещение в другой раздел — здесь же, без drag-drop.
      // id строки едет вместе с ней, чтобы ключи не прыгали.
      // Пишем поверх свежего списка: диалог мог висеть, а лист — уехать.
      const fresh = sectionsRef.current;
      if (moveTarget != null && moveTarget !== editing.si && fresh[moveTarget] && fresh[editing.si]?.items[editing.ii]) {
        const next = fresh.map((s) => ({ ...s, items: s.items.slice() }));
        const [moved] = next[editing.si].items.splice(editing.ii, 1);
        next[moveTarget].items.push({ ...draft, id: moved?.id ?? draft.id ?? makeEquipmentId() });
        commit({ equipmentSections: next });
        setEditing(null);
        setMoveTarget(null);
        return;
      }
      const next = fresh.map((s, si) =>
        si !== editing.si ? s : { ...s, items: s.items.map((it, ii) => (ii === editing.ii ? draft : it)) }
      );
      commit({ equipmentSections: next });
      setEditing(null);
    })();
  }
  function appendItem(si: number, item: DndEquipmentItem) {
    const withId = item.id ? item : { ...item, id: makeEquipmentId() };
    const next = sectionsRef.current.map((s, idx) => (idx !== si ? s : { ...s, items: [...s.items, withId] }));
    commit({ equipmentSections: next });
    setAddingSection(null);
    setAddMode(null);
  }
  function saveAdd() {
    if (addingSection == null || !draft.name.trim()) return;
    appendItem(addingSection, draft);
  }
  // «Принять» — снять пометку; больше ничего не меняется: предмет уже здесь.
  function acceptItem(si: number, ii: number) {
    commit({
      equipmentSections: sections.map((sec, idx) =>
        idx !== si
          ? sec
          : {
              ...sec,
              items: sec.items.map((it, jj) => {
                if (jj !== ii) return it;
                const { pendingFrom: _dropped, ...rest } = it;
                return rest;
              }),
            }
      ),
    });
  }

  // Повтор расходника — +1 в строку с тем же entryId, а не вторая строка.
  // Едино для пикера, мешка и дропа: было только в пикере.
  function bumpStackRow(entryId: number): boolean {
    const fresh = sectionsRef.current;
    for (let bi = 0; bi < fresh.length; bi++) {
      const ii = fresh[bi].items.findIndex((it) => it.entryId === entryId);
      if (ii >= 0) {
        const next = fresh.map((s, sIdx) =>
          sIdx !== bi
            ? s
            : {
                ...s,
                items: s.items.map((it, iIdx) =>
                  iIdx !== ii ? it : { ...it, qty: String(parseQty(String(it.qty ?? "")) + 1) }
                ),
              }
        );
        commit({ equipmentSections: next });
        return true;
      }
    }
    return false;
  }
  async function addFromBag(si: number, result: SearchResult) {
    if (result.type === "compendium_entry" && (result.kind === "equipment" || result.kind === "magic_item")) {
      const meta = await fetchEquipmentMeta(result.id);
      if (meta.stackable && bumpStackRow(result.id)) return;
      // Магпредмет из мешка/поиска — сразу с флагом и ссылкой, иначе
      // выглядит обычным и теряет описание.
      appendItem(si, {
        name: result.title,
        qty: "",
        weight: "",
        notes: "",
        ...meta,
        entryId: result.id,
        ...(result.kind === "magic_item" ? { magical: true } : null),
      });
    } else {
      const suffix = result.kind === "spell" ? " (свиток)" : "";
      appendItem(si, { name: `${result.title}${suffix}`, qty: "", weight: "", notes: "" });
    }
  }
  async function removeItem(si: number, ii: number) {
    const name = sections[si]?.items[ii]?.name || "предмет";
    const ok = await confirm({ title: "Удалить предмет?", message: `Удалить «${name}»?`, confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    // Удаляем по id, а не по индексу: пока висел диалог, список мог
    // переупорядочиться — иначе снесём соседа.
    const targetId = sections[si]?.items[ii]?.id;
    const fresh = sectionsRef.current;
    const next = fresh.map((s, sIdx) =>
      sIdx !== si
        ? s
        : {
            ...s,
            items: s.items.filter((it, iIdx) => (targetId ? it.id !== targetId : iIdx !== ii)),
          }
    );
    commit({ equipmentSections: next });
    setEditing(null);
  }
  function toggleEquipped(si: number, ii: number) {
    const next = sections.map((s, sIdx) =>
      sIdx !== si ? s : { ...s, items: s.items.map((it, iIdx) => (iIdx === ii ? { ...it, equipped: !it.equipped } : it)) }
    );
    commit({ equipmentSections: next });
  }
  // Порядок внутри секции кнопками — то же, что в полной правке, но за
  // столом: drag в быстром виде нет, а на таче кнопки — единственный путь.
  function reorderItem(si: number, ii: number, delta: -1 | 1) {
    const items = sectionsRef.current[si]?.items;
    if (!items) return;
    const jj = ii + delta;
    if (jj < 0 || jj >= items.length) return;
    const next = sectionsRef.current.map((s, sIdx) =>
      sIdx !== si ? s : { ...s, items: s.items.slice() }
    );
    const row = next[si].items;
    [row[ii], row[jj]] = [row[jj], row[ii]];
    commit({ equipmentSections: next });
  }
  // Степпер расходника: зелье тратится одним тапом, а не через ✎. Виден там,
  // где есть счёт (qty задано). В ноль — можно, удаление — руками.
  function bumpQty(si: number, ii: number, delta: number) {
    const next = sections.map((s, sIdx) =>
      sIdx !== si
        ? s
        : {
            ...s,
            items: s.items.map((it, iIdx) =>
              iIdx === ii ? { ...it, qty: String(Math.max(0, parseQty(String(it.qty ?? "")) + delta)) } : it
            ),
          }
    );
    commit({ equipmentSections: next });
  }
  // Настройка на строке: пипс ↔ конкретный предмет. Счётчик внизу вкладки
  // синхронизируется сюда же, чтобы не было двух правд.
  // Сверх лимита — только с подтверждением: раньше 4-й настраивался молча,
  // а ругань висела в другой вкладке.
  async function toggleAttuned(si: number, ii: number) {
    const target = sectionsRef.current[si]?.items[ii];
    if (!target) return;
    if (!target.attuned) {
      const have = sectionsRef.current.flatMap((s) => s.items).filter((it) => it.attuned && !it.transferOut).length;
      if (have >= attuneMax) {
        const ok = await confirm({
          title: "Нет свободных слотов",
          message: `Настроено уже ${have} из ${attuneMax}. Настроить «${target.name || "предмет"}» всё равно?`,
          confirmLabel: "Настроить",
        });
        if (!ok) return;
      }
    }
    const next = sectionsRef.current.map((s, sIdx) =>
      sIdx !== si ? s : { ...s, items: s.items.map((it, iIdx) => (iIdx === ii ? { ...it, attuned: !it.attuned } : it)) }
    );
    const counted = next.flatMap((s) => s.items).filter((it) => it.attuned && !it.transferOut).length;
    commit({ equipmentSections: next, attunementCount: counted });
  }
  // Заряды предмета в инвентаре: степпер −/+ в строке. Максимум-кубик
  // («1к8+1») верхней границей не является — работает только пол (0).
  function bumpCharges(si: number, ii: number, delta: number) {
    const next = sections.map((s, sIdx) =>
      sIdx !== si
        ? s
        : {
            ...s,
            items: s.items.map((it, iIdx) => {
              if (iIdx !== ii || !it.chargesMax) return it;
              const maxNum = /^\d+$/.test(it.chargesMax.trim()) ? Number(it.chargesMax.trim()) : null;
              const cur = typeof it.chargesLeft === "number" ? it.chargesLeft : (delta > 0 ? (maxNum ?? 0) : 0);
              const raw = cur + delta;
              const left = Math.max(0, maxNum != null ? Math.min(maxNum, raw) : raw);
              return { ...it, chargesLeft: left };
            }),
          }
    );
    commit({ equipmentSections: next });
  }
  /**
   * Тап по строке раскрывает описание. У вписанных руками строк справочника
   * за спиной нет — там раскрывается заметка: она и есть то описание,
   * которое игрок написал сам (гриллинг 2026-09-10). Если нет и её, строка
   * молчит: открывать правку случайным тапом за столом опасно.
   */
  async function toggleDescription(si: number, ii: number, entryId?: number | null, hasNote = false) {
    if (!entryId && !hasNote) return;
    if (descOpen && descOpen.si === si && descOpen.ii === ii) {
      if (!entryId) {
        setDescOpen(null);
        return;
      }
      descControllers.current.get(entryId)?.abort();
      descControllers.current.delete(entryId);
      setDescOpen(null);
      return;
    }
    setDescOpen({ si, ii });
    if (!entryId || entryId in descriptions) return;
    await loadDescription(entryId);
  }
  // Догрузка описания с ретраем: «не загрузилось» — строка с кнопкой повтора,
  // а не тупик. Повторный тап бьёт прошлый запрос, протухший ответ игнится.
  async function loadDescription(entryId: number) {
    descControllers.current.get(entryId)?.abort();
    const controller = new AbortController();
    descControllers.current.set(entryId, controller);
    setDescErrors((d) => {
      if (!(entryId in d)) return d;
      const next = { ...d };
      delete next[entryId];
      return next;
    });
    try {
      // Отмена здесь — отказ от ответа, а не от запроса: запись справочника
      // ложится в кэш слоя, и повторный тап возьмёт её оттуда.
      const entry = await readResource<CompendiumEntry>(`/systems/entries/${entryId}`);
      if (controller.signal.aborted) return;
      setDescriptions((d) => ({ ...d, [entryId]: entry.description || "Нет описания." }));
      const contents = readPackContents(entry);
      if (contents.length > 0) setPackContents((m) => ({ ...m, [entryId]: contents }));
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      setDescErrors((d) => ({ ...d, [entryId]: true }));
    } finally {
      if (descControllers.current.get(entryId) === controller) descControllers.current.delete(entryId);
    }
  }
  // Распаковка набора (гриллинг 2026-09-26): строка набора уходит, предметы
  // ложатся в её раздел в конец, не надетыми. Повтор расходника — прибавка
  // к его строке, прочее — новой строкой с количеством. Ссылки в составе
  // устарели, поэтому предмет ищется по имени: «Рюкзак [Backpack]» — русское
  // имя или name_original.
  async function unpackPack(si: number, ii: number) {
    const row = sectionsRef.current[si]?.items[ii];
    const contents = row?.entryId ? packContents[row.entryId] : undefined;
    if (!row || !contents || systemId == null) return;
    const ok = await confirm({
      title: `Распаковать «${row.name}»?`,
      message: `В инвентарь ${plural(contents.length, "ляжет", "лягут", "лягут")} ${contents.length} ${plural(contents.length, "предмет", "предмета", "предметов")}, сам набор уберётся.`,
      confirmLabel: "Распаковать",
    });
    if (!ok) return;
    setDescOpen(null);
    const catalog = await loadDndEquipmentEntries(systemId);
    const find = (c: PackContent) =>
      catalog.find((e) => e.name === c.ru) ?? (c.en ? catalog.find((e) => e.name_original === c.en) : undefined);
    const resolved = await Promise.all(
      contents.map(async (c) => {
        const e = find(c);
        return { c, e, meta: e ? await fetchEquipmentMeta(e.id) : null };
      })
    );
    // База — свежая после сети; набор ищется по id, а не по индексу.
    const base = sectionsRef.current.map((sec) => ({ ...sec, items: sec.items.map((it) => ({ ...it })) }));
    const at = row.id ? base[si]?.items.findIndex((it) => it.id === row.id) : ii;
    if (at == null || at < 0) return;
    base[si].items.splice(at, 1);
    for (const { c, e, meta } of resolved) {
      const stackable = e ? isStackableEquipmentEntry(e) : false;
      const existing = e && stackable ? base.flatMap((sec) => sec.items).find((it) => it.entryId === e.id) : undefined;
      if (existing) {
        existing.qty = String(parseQty(String(existing.qty ?? "")) + c.qty);
        continue;
      }
      base[si].items.push({
        name: e?.name ?? c.ru,
        weight: "",
        notes: "",
        ...meta,
        qty: stackable || c.qty > 1 ? String(c.qty) : "",
        id: makeEquipmentId(),
        ...(e ? { entryId: e.id } : null),
      });
    }
    commit({ equipmentSections: base });
  }
  async function handleDrop(e: DragEvent<HTMLDivElement>, si: number) {
    e.preventDefault();
    setDragOverSection(null);
    const result = readSearchDrop(e);
    if (!result) return;
    await addFromBag(si, result);
  }

  const totalItems = sections.flatMap((s) => s.items).filter((i) => !i.transferOut).length;
  const attuneMax = attunementMax ?? 3;
  // Видимые строки под поиском/фильтром. Настроенное — всегда наверху, под
  // ним надетое, дальше ручной порядок секции (владелец 2026-09-26; раньше
  // автосортировки не было — «прыгала под пальцем»). Индексы исходные.
  const rowRank = (it: DndEquipmentItem) => (it.attuned ? 0 : it.equipped ? 1 : 2);
  const equipQ = equipQuery.trim().toLowerCase();
  const filtering = equipQ !== "" || equipFilter !== "all";
  const visibleSections = sections
    .map((section, si) => ({
      section,
      si,
      rows: section.items
        .map((item, ii) => ({ item, ii }))
        .filter(
          ({ item }) =>
            (!equipQ || `${item.name} ${item.notes}`.toLowerCase().includes(equipQ)) &&
            (equipFilter === "all" || (equipFilter === "equipped" ? !!item.equipped : !!item.magical))
        )
        .sort((a, b) => rowRank(a.item) - rowRank(b.item)),
    }))
    .filter(({ section, rows }) => rows.length > 0 || (!filtering && section.items.length === 0));
  return (
    <div className="dnd-equipment-view">
      {confirmDialog}
      <div className="dnd-equipment-main">
      {baseRow && sections[baseRow.si]?.items[baseRow.ii] && (
        <DndReplicaBasePicker
          title={sections[baseRow.si].items[baseRow.ii].name}
          only={baseChoiceWithoutBase(sections[baseRow.si].items[baseRow.ii]) ?? undefined}
          systemId={systemId}
          onClose={() => setBaseRow(null)}
          onPick={(base) => {
            const { si, ii } = baseRow;
            setBaseRow(null);
            const fresh = sectionsRef.current;
            const row = fresh[si]?.items[ii];
            const replace = (merged: DndEquipmentItem) =>
              commit?.({
                equipmentSections: fresh.map((sec, sIdx) =>
                  sIdx !== si ? sec : { ...sec, items: sec.items.map((it, iIdx) => (iIdx === ii ? merged : it)) }
                ),
              });
            if (row && baseChoiceWithoutBase(row)) {
              // Своя запись (эффекты, настройка, бонус) остаётся, от основы —
              // КЗ и тип доспеха либо урон и свойства оружия.
              const m = base.meta;
              replace({
                ...row,
                armorType: m.armorType,
                ac: m.ac,
                maxDexBonus: m.maxDexBonus,
                dexBonus: m.dexBonus,
                weaponDamage: m.weaponDamage,
                weaponAttackMelee: m.weaponAttackMelee,
                weaponAttackRanged: m.weaponAttackRanged,
                weaponProperties: m.weaponProperties,
                weaponMastery: m.weaponMastery,
                weaponCategory: m.weaponCategory,
                name: `${row.name} (${base.name})`,
                magical: true,
              });
              return;
            }
            const bonus = row ? magicPlusWithoutBase(row) : null;
            if (!row || bonus == null) return;
            // Одна строка: базовый предмет со своими КЗ и уроном плюс прибавка
            // и пометка «магический» — как у реплик Артефактора. Настройка,
            // количество и заметка строки остаются.
            const merged: DndEquipmentItem = {
              ...row,
              ...base.meta,
              id: row.id,
              name: `${base.name} +${bonus}`,
              entryId: base.entryId,
              magical: true,
              magicBonus: bonus,
              equipped: row.equipped,
              attuned: row.attuned,
              qty: row.qty,
              notes: row.notes,
              rarity: row.rarity,
            };
            replace(merged);
          }}
        />
      )}
      <div className="dnd-equipment-head">Снаряжение</div>
      {/* Поиск по снаряжению: имя и заметка. Фильтр надето/магия — те же два
          вопроса за столом. */}
      <div className="row dnd-equipment-search" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        <input
          placeholder="Поиск по снаряжению…"
          value={equipQuery}
          onChange={(e) => setEquipQuery(e.target.value)}
          aria-label="Поиск по снаряжению"
          style={{ flex: "1 1 160px" }}
        />
        {(["all", "equipped", "magical"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`dnd-chip${equipFilter === f ? " is-on" : ""}`}
            aria-pressed={equipFilter === f}
            onClick={() => setEquipFilter(f)}
          >
            {f === "all" ? "Все" : f === "equipped" ? "Активно" : "Магия"}
          </button>
        ))}
      </div>
      {/* Монеты — в самом низу вкладки, все в одну строку: добычу делят
          после боя, когда список уже пролистан. Порядок — от медной к
          платиновой, как в кошельке. */}
      {transferError && (
        <p className="sb-save-error" role="status">
          {transferError}
        </p>
      )}
      {filtering && visibleSections.length === 0 && (
        <p className="muted">Ничего не нашлось — ослабьте поиск или фильтр.</p>
      )}
      {/* Пустая вкладка (§1.11): не «пустоту», а приглашение с действием.
          Пока открыта форма «+ Свой», приглашение уступает место разделам —
          иначе форма, которая живёт в разделе, не появлялась вовсе. */}
      {!filtering && totalItems === 0 && sections.length > 0 && addingSection === null ? (
        <div className="sb-entry">
          <p className="muted" style={{ margin: "0 0 8px" }}>
            Имущества пока нет — возьмите из компендиума или запишите своё.
          </p>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            <button type="button" className="primary" onClick={() => setPickingSection(0)}>
              + Из компендиума
            </button>
            <button type="button" onClick={() => startAdd(0, null)}>
              + Свой
            </button>
          </div>
        </div>
      ) : (
      visibleSections.map(({ section, si, rows }) => (
        <div
          key={si}
          className={`sb-entry${dragOverSection === si ? " drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverSection(si);
          }}
          onDragLeave={() => setDragOverSection(null)}
          onDrop={(e) => handleDrop(e, si)}
        >
          {sections.length > 1 &&   <div className="dnd-section-title">{section.name}</div>}
          <ul className="dnd-equipment-view-list">
            {/* Порядок — см. visibleSections выше. */}
            {rows
              .map(({ item, ii }) =>
              editing && editing.si === si && editing.ii === ii ? (
                <li key={item.id ?? ii}>
                  {sections.length > 1 && (
                    <label className="row muted" style={{ gap: 6, margin: "4px 0", fontSize: "var(--fs-meta)" }}>
                      Раздел:
                      <select
                        value={moveTarget ?? si}
                        onChange={(e) => setMoveTarget(Number(e.target.value))}
                        aria-label="Переместить в раздел"
                      >
                        {sections.map((sec, idx) => (
                          <option key={idx} value={idx}>
                            {sec.name || `Раздел ${idx + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <EquipmentInlineForm
                    draft={draft}
                    onChange={setDraft}
                    onSave={saveEdit}
                    onCancel={cancel}
                    onRemove={() => removeItem(si, ii)}
                  />
                </li>
              ) : (
                <li
                  key={item.id ?? ii}
                  className={[
                    item.transferOut
                      ? "is-transfer-out"
                      : item.transferIn
                        ? item.transferIn.kind === "replica"
                          ? "is-transfer-created"
                          : "is-transfer-in"
                        : "",
                    item.magical ? "is-magical" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                  style={item.magical && accentColor ? { borderLeftColor: accentColor } : undefined}
                >
                  {/* Строка-предмет: плитка типа, имя в полный голос, тихая
                      вторая строка (цена · вес · заметка) и правая клетка.
                      В правой клетке только то, чем строка владеет сама и что
                      меняется за столом, — счёт и заряды: КЗ и бонус атаки
                      живут на карте и во вкладке «Действия», третье место
                      разошлось бы с ними при первой же правке эффектов
                      (гриллинг 2026-09-10). Тап по строке — окно описания,
                      как у заклинаний и действий (владелец 2026-09-26). */}
                  <div
                    className="dnd-equipment-quick-row"
                    onClick={() => void toggleDescription(si, ii, item.entryId, !!item.notes)}
                  >
                    <button
                      type="button"
                      className={`dnd-item-icon-btn${item.equipped ? " is-active" : ""}`}
                      title={
                        item.transferOut
                          ? "Передано — пометить нельзя"
                          : item.equipped
                            ? "Активно — под рукой"
                            : "В рюкзаке"
                      }
                      aria-label={`${item.name || "Предмет"}: ${item.equipped ? "активно" : "в рюкзаке"}`}
                      aria-pressed={!!item.equipped}
                      disabled={!!item.transferOut}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleEquipped(si, ii);
                      }}
                    >
                      <EquipmentIcon item={item} />
                    </button>
                    <div className="dnd-equipment-name">
                      <button
                        type="button"
                        className="dnd-equipment-name-link"
                        aria-label={`${item.name} — открыть описание`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleDescription(si, ii, item.entryId, !!item.notes);
                        }}
                      >
                        {item.name}
                      </button>
                      {(() => {
                        const parts = equipmentSubParts(item);
                        const marks = equipmentMarks(
                          item,
                          item.equipped && item.armorType && armorProfs ? isArmorProficient(item.armorType, armorProfs) : null
                        );
                        if (parts.length === 0 && marks.length === 0) return null;
                        return (
                          <div className="dnd-item-sub">
                            {parts.length > 0 && <span className="dnd-item-sub-text">{parts.join(" · ")}</span>}
                            {marks.map((m) => (
                              <span key={m.text} className="dnd-mark-chip" title={m.title}>
                                {m.text}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    {(() => {
                      // Количество и трата — одна кнопка (макет 2026-09-25):
                      // «×3» рядом с отдельным «−» читались как два минуса.
                      // Тап тратит один: тратят за столом, пополняют в меню.
                      // Правая клетка держит своё место даже пустой: иначе
                      // имена соседних строк разъезжаются по ширине.
                      const qty = String(item.qty ?? "").trim();
                      if (item.chargesMax) {
                        return (
                          <button
                            type="button"
                            className="dnd-item-rt dnd-spend-btn"
                            aria-label={`${item.name || "Предмет"}: заряды ${item.chargesLeft ?? "?"} из ${item.chargesMax} — потратить заряд`}
                            title="Потратить заряд"
                            disabled={(item.chargesLeft ?? 0) <= 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              bumpCharges(si, ii, -1);
                            }}
                          >
                            <span className="dnd-item-rt-top">
                              {item.chargesLeft ?? "?"}/{item.chargesMax}
                            </span>
                            <span className="dnd-item-rt-bot">заряды · −1</span>
                          </button>
                        );
                      }
                      if (qty !== "") {
                        return (
                          <button
                            type="button"
                            className="dnd-item-rt dnd-spend-btn"
                            aria-label={`${item.name || "Предмет"}: ${qty} — использовать, потратить один`}
                            title="Использовать — потратить 1"
                            disabled={qty === "0"}
                            onClick={(e) => {
                              e.stopPropagation();
                              bumpQty(si, ii, -1);
                            }}
                          >
                            <span className="dnd-item-rt-top">{qty}</span>
                            <span className="dnd-item-rt-bot">{isRationRow(item) ? "дня" : "шт."} · −1</span>
                          </button>
                        );
                      }
                      return <div className="dnd-item-rt" />;
                    })()}
                    {/* Переданное чужой репликой: пока не принято, строка
                        стоит с пометкой — это и есть всё «уведомление»,
                        которого в приложении нет (R2/W8). */}
                    {item.pendingFrom && (
                      <details className="dnd-transfer-fold" onClick={(e) => e.stopPropagation()}>
                        <summary className="dnd-transfer-chip" title="Передача требует решения">
                          не принято ···
                        </summary>
                        <span className="row" style={{ gap: 4 }}>
                          <button type="button" className="comp-mini" onClick={() => acceptItem(si, ii)}>
                            Принять
                          </button>
                          <button type="button" className="comp-mini" onClick={() => void removeItem(si, ii)}>
                            Вернуть
                          </button>
                        </span>
                      </details>
                    )}
                    {item.transferOut && (
                      <span className="dnd-transfer-chip">передано → {item.transferOut.toName}</span>
                    )}
                    {item.transferIn && (
                      <details className="dnd-transfer-fold" onClick={(e) => e.stopPropagation()}>
                        <summary className="dnd-transfer-chip" title="Передача требует решения">
                          {item.transferIn.kind === "replica"
                            ? `создал ${item.transferIn.fromName} ···`
                            : `принято ← ${item.transferIn.fromName} ···`}
                        </summary>
                        <span className="row" style={{ gap: 4 }}>
                          <button
                            type="button"
                            className="comp-mini"
                            disabled={transferBusy === item.transferIn.id}
                            onClick={() => void settleTransfer(item.transferIn!.id, "return")}
                          >
                            Вернуть
                          </button>
                          <button
                            type="button"
                            className="comp-mini"
                            disabled={transferBusy === item.transferIn.id}
                            onClick={() => void settleTransfer(item.transferIn!.id, "claim")}
                          >
                            Сделать своим
                          </button>
                        </span>
                      </details>
                    )}
                    <EquipmentRowMenu
                      label={item.name || "Предмет"}
                      items={[
                        { text: "Править", onPick: () => startEdit(si, ii) },
                        ...(ii > 0 ? [{ text: "Выше", onPick: () => reorderItem(si, ii, -1) }] : []),
                        ...(ii < section.items.length - 1 ? [{ text: "Ниже", onPick: () => reorderItem(si, ii, 1) }] : []),
                        ...(item.chargesMax
                          ? [{ text: "Вернуть заряд", onPick: () => bumpCharges(si, ii, 1) }]
                          : String(item.qty ?? "").trim() !== ""
                            ? [{ text: "Добавить одну", onPick: () => bumpQty(si, ii, 1) }]
                            : []),
                        ...(magicPlusWithoutBase(item) != null || baseChoiceWithoutBase(item)
                          ? [{ text: "Выбрать основу", onPick: () => setBaseRow({ si, ii }) }]
                          : []),
                        ...(item.requiresAttunement || item.attuned
                          ? [{ text: item.attuned ? "Снять настройку" : "Настроить", onPick: () => void toggleAttuned(si, ii) }]
                          : []),
                        ...(onTransferItem && !item.transferOut && !item.transferIn && !item.pendingFrom
                          ? [{ text: "Передать", onPick: () => onTransferItem(item.id ?? `${si}:${ii}`) }]
                          : []),
                        { text: "Выбросить", danger: true, onPick: () => void removeItem(si, ii) },
                      ]}
                    />
                  </div>
                </li>
              )
            )}
          </ul>
          {addingSection === si ? (
            addMode === "bag" ? (
              <div className="stack" style={{ gap: 4 }}>
                {bagItems.length === 0 && <span className="muted">В мешке ничего нет.</span>}
                {bagItems.map((b, bi) => (
                  <button
                    key={bi}
                    type="button"
                    className="comp-mini"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => addFromBag(si, b)}
                  >
                    {b.title}
                  </button>
                ))}
                <button type="button" onClick={cancel}>
                  Отмена
                </button>
              </div>
            ) : (
              <EquipmentInlineForm draft={draft} onChange={setDraft} onSave={saveAdd} onCancel={cancel} />
            )
          ) : (
            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
              <button type="button" className="dnd-chip" onClick={() => startAdd(si, null)}>
                + Свой
              </button>
              {!detached && <button type="button" className="dnd-chip" onClick={() => setPickingSection(si)}>
                + Из компендиума
              </button>}
              {!detached && campaignConnected && <button type="button" className="dnd-chip" onClick={() => startAdd(si, "bag")}>
                + Из мешка
              </button>}
            </div>
          )}
        </div>
      ))
      )}
      {/* Окно описания: у справочной строки — описание записи, у вписанной
          руками — её заметка. Заметка и есть то описание, которое игрок
          написал сам. */}
      {descOpen && sections[descOpen.si]?.items[descOpen.ii] && (() => {
        const item = sections[descOpen.si].items[descOpen.ii];
        const tags = equipmentTagsLine(item);
        return (
          <Modal onClose={() => setDescOpen(null)}>
            <div className="stack dnd-spell-modal">
              <SheetModalHead title={item.name} onClose={() => setDescOpen(null)} />
              {tags && <div className="dnd-equipment-tags">{tags}</div>}
              {!item.entryId ? (
                <MentionText text={item.notes} />
              ) : descErrors[item.entryId] ? (
                <span className="row" style={{ gap: 6, alignItems: "center" }}>
                  <span className="muted">Описание не загрузилось.</span>
                  <button type="button" className="comp-mini" onClick={() => void loadDescription(item.entryId!)}>
                    Повторить
                  </button>
                </span>
              ) : (
                <>
                  <MentionText text={descriptions[item.entryId] ?? "Загрузка…"} />
                  {item.notes?.trim() ? <MentionText text={item.notes} /> : null}
                  {packContents[item.entryId] && !item.transferOut && (
                    <button
                      type="button"
                      className="primary"
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => void unpackPack(descOpen.si, descOpen.ii)}
                    >
                      Распаковать
                    </button>
                  )}
                </>
              )}
            </div>
          </Modal>
        );
      })()}
      {pickingSection != null && (
        <DndEquipmentPickerModal
          systemId={systemId}
          ownedIds={
            new Set(
              sections
                .flatMap((s) => s.items.map((i) => i.entryId))
                .filter((id): id is number => typeof id === "number")
            )
          }
          onPick={(entries) => {
            const si = pickingSection;
            setPickingSection(null);
            if (entries.length === 0) return;
            // Пачка одним сохранением: мета догружается, строки ложатся разом.
            // Повтор расходника — +1 в его строку, а не вторая строка.
            void (async () => {
              const items: DndEquipmentItem[] = [];
              let bumped = false;
              // База — свежая на момент догрузки меты, а не на момент открытия
              // пикера: мета едет по сети, лист за это время мог измениться.
              const base = sectionsRef.current.map((s) => ({ ...s, items: s.items.map((it) => ({ ...it })) }));
              const findRow = (entryId: number) => {
                for (let bi = 0; bi < base.length; bi++) {
                  const ii = base[bi].items.findIndex((it) => it.entryId === entryId);
                  if (ii >= 0) return { si: bi, ii };
                }
                return null;
              };
              for (const e of entries) {
                const at = findRow(e.id);
                if (at && isStackableEquipmentEntry(e)) {
                  const row = base[at.si].items[at.ii];
                  row.qty = String(parseQty(String(row.qty ?? "")) + 1);
                  bumped = true;
                  continue;
                }
                const meta = await fetchEquipmentMeta(e.id);
                items.push({
                  name: e.name,
                  qty: "",
                  weight: "",
                  notes: "",
                  ...meta,
                  // Ссылку и флаг магии держим явно поверх спреда.
                  entryId: e.id,
                  ...(e.kind === "magic_item" ? { magical: true } : null),
                });
              }
              if (bumped) commit({ equipmentSections: base.map((s) => ({ ...s })) });
              if (items.length > 0) {
                const next = base.map((s, idx) =>
                  idx !== si
                    ? s
                    : {
                        ...s,
                        items: [
                          ...s.items,
                          ...items.map((it) => (it.id ? it : { ...it, id: makeEquipmentId() })),
                        ],
                      }
                );
                commit({ equipmentSections: next });
              }
              setAddingSection(null);
              setAddMode(null);
            })();
          }}
          onClose={() => setPickingSection(null)}
        />
      )}
      {/* Монеты — в самом низу вкладки, в своей рамке отдельно от настройки.
          Порядок — от медной к платиновой. Подписи столбиком (М над М), иначе
          пятая монета не влезает. */}
      {calcOpen && (
        <DndCoinCalculator
          campaignId={calcCampaignId}
          senderId={calcSenderId}
          senderName={calcSenderName ?? ""}
          ownCoins={coins ?? EMPTY_COINS}
          onCommitCoins={(c) => commit({ coins: c })}
          onChanged={() => onCalcChanged?.()}
          onClose={() => setCalcOpen(false)}
        />
      )}
      </div>
      {/* Боковая колонка (макет 2026-09-25): настройка, кошелёк; вес —
          в шапке вкладки (2026-09-26). */}
      <aside className="dnd-equipment-aside">
        {attunement}
        <DndCoinPurse coins={coins ?? EMPTY_COINS} onCommit={(c) => commit({ coins: c })} onOpenCalc={() => setCalcOpen(true)} />
      </aside>
    </div>
  );
}

/**
 * Подбор снаряжения пачкой (этап 6): та же механика, что у заклинаний, —
 * выкладка каталогом вместо пустого поля, поиск вторым эшелоном, отметить
 * несколько и добавить разом. Группы — по виду записи: магические предметы
 * отдельно от обычного снаряжения.
 */
/** Подписи редкости в фильтре пикера — во множественном там, где так
 *  назвал владелец; значение фильтра — как в справочнике. */
const RARITY_LABELS: Record<string, string> = { Обычный: "Обычные", Необычный: "Необычные" };

function DndEquipmentPickerModal({
  systemId,
  ownedIds,
  onPick,
  onClose,
}: {
  systemId: number | null;
  ownedIds: ReadonlySet<number>;
  onPick: (entries: CompendiumEntry[]) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<CompendiumEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [failed, setFailed] = useState(false);
  // Фильтры пикера: тип, редкость, «требует настройки», сортировка.
  // До добавления видна характеристика строки.
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [rarityFilter, setRarityFilter] = useState<string>("mundane");
  const [attuneOnly, setAttuneOnly] = useState(false);
  const [sortMode, setSortMode] = useState<"name" | "ac" | "cost">("name");

  useEffect(() => {
    if (!systemId) {
      setAll([]);
      return;
    }
    let alive = true;
    loadDndEquipmentEntries(systemId)
      .then((rows) => {
        if (alive) setAll(rows);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [systemId]);

  const q = query.trim().toLowerCase();
  // Тип записи для фильтра: категория снаряжения или тип магпредмета,
  // оружие/броня — ещё и по полям урона/КЗ.
  function entryTypeKey(e: CompendiumEntry): string {
    const data = (e.data ?? {}) as Record<string, unknown>;
    const cat = typeof data.category === "string" ? data.category : "";
    const type = typeof data.item_type === "string" ? data.item_type : "";
    if (typeof data.damage === "string" && data.damage) return "Оружие";
    if (typeof data.armor_type === "string" && data.armor_type) return "Доспехи";
    if (/доспех|щит/i.test(`${cat} ${type}`)) return "Доспехи";
    if (/оружие/i.test(`${cat} ${type}`)) return "Оружие";
    if (/инструмент/i.test(cat)) return "Инструменты";
    if (cat === "Расходники" || isStackableEquipmentEntry(e)) return "Расходники";
    return type || cat || "Прочее";
  }
  // Характеристика записи до добавления: КЗ/урон/тип/редкость/цена.
  function entrySpecLine(e: CompendiumEntry): string {
    const data = (e.data ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const ac = str(data.ac);
    if (ac) parts.push(`КЗ ${ac}`);
    const dmg = str(data.damage);
    if (dmg) parts.push(dmg);
    const t = str(data.item_type) || str(data.category);
    if (t) parts.push(t);
    const rarity = str(data.rarity);
    if (rarity) parts.push(rarity);
    if (entryRequiresAttunement(data)) parts.push("настройка");
    const cost = str(data.cost);
    if (cost) parts.push(cost);
    return parts.join(" · ");
  }
  // Цена в медяки: «200 мм» дешевле «100 зм», голое число без единицы —
  // золотые (так пишет справочник). Раньше сравнивались голые числа.
  function costToCp(raw: unknown): number | null {
    const text = String(raw ?? "").toLowerCase().replace(",", ".");
    const re = /(\d+(?:\.\d+)?)\s*(мм|см|эм|зм|пм|cp|sp|ep|gp|pp|медн\w*|серебр\w*|электрум\w*|золот\w*|платин\w*)?/g;
    let total = 0;
    let found = false;
    for (let m; (m = re.exec(text)) !== null; ) {
      const n = parseFloat(m[1]);
      if (!Number.isFinite(n)) continue;
      const u = m[2] ?? "";
      const mult =
        u.startsWith("мм") || u.startsWith("медн") || u === "cp" ? 1
        : u.startsWith("см") || u.startsWith("серебр") || u === "sp" ? 10
        : u.startsWith("эм") || u.startsWith("электрум") || u === "ep" ? 50
        : u.startsWith("пм") || u.startsWith("платин") || u === "pp" ? 1000
        : 100;
      total += n * mult;
      found = true;
    }
    return found ? total : null;
  }
  function entrySortVal(e: CompendiumEntry): number {
    const data = (e.data ?? {}) as Record<string, unknown>;
    if (sortMode === "ac") {
      const m = /^[\d.,]+/.exec(String(data.ac ?? ""));
      return m ? -parseFloat(m[0].replace(",", ".")) : Number.POSITIVE_INFINITY;
    }
    const cp = costToCp(data.cost);
    return cp != null ? -cp : Number.POSITIVE_INFINITY;
  }
  const rarities = useMemo(() => {
    const set = new Set<string>();
    for (const e of all ?? []) {
      const r = (e.data as Record<string, unknown> | undefined)?.rarity;
      if (typeof r === "string" && r.trim()) set.add(r.trim());
    }
    // Порядок — по возрастанию редкости (владелец 2026-09-26); незнакомые
    // значения (другая система) — в конец по алфавиту.
    const order = ["Обычный", "Необычный", "Редкий", "Очень редкий", "Легендарный", "Артефакт", "Варьируется"];
    const rest = [...set].filter((r) => !order.includes(r)).sort((a, b) => a.localeCompare(b, "ru"));
    return [...order.filter((r) => set.has(r)), ...rest];
  }, [all]);
  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of all ?? []) set.add(entryTypeKey(e));
    const preferred = ["Оружие", "Доспехи", "Инструменты", "Расходники", "Зелья", "Свитки", "Кольца", "Чудесные предметы"];
    const rest = [...set].filter((t) => !preferred.includes(t)).sort((a, b) => a.localeCompare(b, "ru"));
    return [...preferred.filter((t) => set.has(t)), ...rest];
  }, [all]);
  const beforeRarity = (all ?? [])
    // Поиск — по имени и по характеристике (тип, редкость, цена, КЗ/урон):
    // «кольчуга» находится и как «средний доспех», и как «необычный».
    .filter((e) => !q || e.name.toLowerCase().includes(q) || entrySpecLine(e).toLowerCase().includes(q))
    .filter((e) => typeFilter === "all" || entryTypeKey(e) === typeFilter)
    .filter((e) => !attuneOnly || entryRequiresAttunement((e.data ?? {}) as Record<string, unknown>));
  // Поиск уважает редкость (владелец 2026-09-26: «Немагические» + «Све»
  // выдавали магию). Что скрыто редкостью — строкой «ещё N… показать» под
  // списком: так «зелье лечения» под «Немагическими» всё равно находится.
  const matching = beforeRarity
    .filter((e) => {
      if (rarityFilter === "any") return true;
      if (rarityFilter === "mundane") return e.kind !== "magic_item";
      const r = (e.data as Record<string, unknown> | undefined)?.rarity;
      return r === rarityFilter;
    })
    .sort((a, b) =>
      sortMode === "name" ? a.name.localeCompare(b.name, "ru") : entrySortVal(a) - entrySortVal(b) || a.name.localeCompare(b.name, "ru")
    );
  const groups = [
    { title: "Магические предметы", entries: matching.filter((e) => e.kind === "magic_item") },
    { title: "Снаряжение", entries: matching.filter((e) => e.kind !== "magic_item") },
  ].filter((g) => g.entries.length > 0);

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal wide onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Снаряжение из компендиума</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        <input
          placeholder="Поиск: название, тип, редкость, цена"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }} role="group" aria-label="Фильтр по типу">
          {["all", ...typeOptions].map((t) => (
            <button
              key={t}
              type="button"
              className={`dnd-chip${typeFilter === t ? " is-on" : ""}`}
              aria-pressed={typeFilter === t}
              onClick={() => setTypeFilter(t)}
            >
              {t === "all" ? "Все" : t}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
            Редкость:
            <select value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)} aria-label="Фильтр по редкости">
              <option value="mundane">Немагические</option>
              {rarities.map((r) => (
                <option key={r} value={r}>
                  {RARITY_LABELS[r] ?? r}
                </option>
              ))}
              <option value="any">Любая</option>
            </select>
          </label>
          <label className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
            <input type="checkbox" checked={attuneOnly} onChange={(e) => setAttuneOnly(e.target.checked)} />
            требует настройки
          </label>
          <label className="row muted" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
            Сорт:
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as "name" | "ac" | "cost")}
              aria-label="Сортировка"
            >
              <option value="name">по имени</option>
              <option value="ac">по КЗ</option>
              <option value="cost">по цене</option>
            </select>
          </label>
        </div>
        {failed && <p className="muted">Не удалось загрузить справочник снаряжения.</p>}
        {!failed && all === null && <p className="muted">Загрузка…</p>}
        {all !== null && groups.length === 0 && <p className="muted">Ничего не нашлось.</p>}
        {q && beforeRarity.length > matching.length && (
          <button type="button" className="dnd-replica-add" onClick={() => setRarityFilter("any")}>
            Ещё {beforeRarity.length - matching.length} другой редкости — показать
          </button>
        )}
        {/* Список: только вертикальный скролл — панорама вбок мешала вести
            пальцем и список «плавал». */}
        <div className="stack picker-list" style={{ gap: 8, overflowX: "hidden", touchAction: "pan-y" }}>
          {groups.map((g) => (
            <div key={g.title} className="stack" style={{ gap: 4 }}>
              <div className="sb-prop-label">{g.title}</div>
              {g.entries.map((e) => {
                const isOwned = ownedIds.has(e.id);
                // Расходник берут повторно как +1 в ту же строку,
                // нерасходуемое — второй строкой: два одинаковых меча
                // для двуручки/партии больше не запрещены.
                const stackable = isStackableEquipmentEntry(e);
                const isPicked = picked.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={`dnd-picker-row${isPicked ? " is-picked" : ""}`}
                    aria-pressed={isPicked}
                    onClick={() => toggle(e.id)}
                  >
                    <span className="dnd-picker-check" aria-hidden="true">
                      {isPicked ? "●" : "○"}
                    </span>
                    <span style={{ flex: "1 1 auto", minWidth: 0, textAlign: "left" }}>
                      <span style={{ display: "block" }}>{e.name}</span>
                      {entrySpecLine(e) && (
                        <span style={{ display: "block", opacity: 0.7, fontSize: "var(--fs-meta)" }}>
                          {entrySpecLine(e)}
                        </span>
                      )}
                    </span>
                    {isOwned && (
                      <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                        {stackable ? "есть — будет +1" : "есть — второй строкой"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="row picker-footer" style={{ gap: 8 }}>
          <button
            type="button"
            className="primary"
            disabled={picked.size === 0}
            onClick={() => {
              const byId = new Map((all ?? []).map((e) => [e.id, e]));
              onPick([...picked].map((id) => byId.get(id)).filter((e): e is CompendiumEntry => !!e));
            }}
          >
            Добавить{picked.size > 0 ? ` (${picked.size})` : ""}
          </button>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}
