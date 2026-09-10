/**
 * Типы D&D 5.5: сохранённый лист персонажа и статблок существа.
 *
 * Переехали сюда из `client/src/types.ts` 2026-09-10. Причина не в
 * аккуратности: `normalizeDndCharacter` — барьер совместимости форматов листа —
 * был заперт в React-файле, и семь серверных мест разбирали тот же JSON мимо
 * него. Чтобы нормализация стала общей, общим должен стать и тип.
 *
 * `client/src/types.ts` реэкспортирует всё отсюда, поэтому 213 файлов клиента
 * ничего не заметили.
 */

import type { DndCheck, DndEffect, DndCost } from "./effects";

export interface DndAbilityScores {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

// Действие / Бонусное действие / Реакция / Иное (needs a free-text note on
// how long it actually takes) — shared by manual attacks and spells so both
// can be bucketed into the same four "Бой" tab sections.
export type DndActionTiming = "action" | "bonus" | "reaction" | "other";

// A hand-typed row in the "Атаки" list — distinct from DndFeature (used by
// species/class/feats/special-ability lists, none of which have an
// action-economy timing) so adding `timing` here doesn't leak into those.
export interface DndManualAttack {
  name: string;
  description: string;
  timing: DndActionTiming;
  // Free-text note, only shown/used when timing === "other" (e.g. "10 минут",
  // or a passive note like "Не требует действия" for things like Sneak Attack).
  timingOther?: string;
}

export interface DndFeature {
  name: string;
  description: string;
  // Ссылка на запись компендиума, если умение пришло оттуда. Живые поля
  // (время накладывания, эффекты) читаются по ней при отрисовке, а не
  // копируются в лист — см. resolveFeature в DndCharacterForm.
  entryId?: number | null;
  // Set only for features auto-filled from a class/subclass/species pick —
  // the id of that class/subclass/species compendium entry, so picking a
  // different one can find-and-replace just its own features without
  // touching features from other classes (multiclass) or hand-added ones.
  sourceParentId?: number | null;
  // The compendium feature entry's own level (class/subclass features only),
  // shown next to the name.
  level?: number | null;
  // Снято с записи компендиума: умение с временем накладывания попадает во
  // вкладку «Действия» наравне с заклинаниями (Второе дыхание, Наложение рук).
  castingTiming?: DndActionTiming;
  castingTimingOther?: string;
  checks?: DndCheck[];
  effects?: DndEffect[];
  cost?: DndCost;
}

// One class entry in a (possibly multiclassed) character's class list.
// *Id fields are set when picked from the system's compendium (enables
// hit-die lookup for requirement 8); the Name fields are always kept in sync
// so the statblock still displays sensibly for freehand/legacy entries with
// no compendium link (id null).
export interface DndClassEntry {
  classId: number | null;
  className: string;
  subclassId: number | null;
  subclassName: string;
  level: number;
  // The class's "choose N of these skills" pool/count (from its compendium
  // entry's skill_choice_options/skill_choice_count), captured when picked so
  // the sheet can show a remaining-picks counter and highlight which checked
  // skills came from this class. Empty/0 for freehand classes with no
  // compendium link.
  skillChoiceOptions: string[];
  skillChoiceCount: number;
  // The class's spellcasting ability (compendium entry's data.spellcasting_ability,
  // a single Russian ability name e.g. "Харизма"), used to compute the
  // character's spell save DC / spell attack bonus. Empty for non-casters.
  spellcastingAbility: string;
}

export type DndAbilityKey = keyof DndAbilityScores;

// 0 = not proficient, 1 = proficient (bonus once), 2 = expertise (bonus x2).
export type DndSkillProfLevel = 0 | 1 | 2;

// 0 = not prepared, 1 = prepared, 2 = always prepared (same star, click cycles through).
export type DndSpellPreparedState = 0 | 1 | 2;

export interface DndCharacterData {
  // Which system's compendium (classes/species/backgrounds/spells) powers
  // this statblock's pickers. Independent of owner type — a Character
  // defaults it from the campaign's system, a Being has none to infer so it's
  // picked explicitly.
  systemId: number | null;

  characterName: string;
  playerName: string;

  classes: DndClassEntry[];
  raceId: number | null;
  raceName: string;
  raceTypeName: string; // creature type of the picked species, e.g. "гуманоид"
  backgroundId: number | null;
  backgroundName: string;
  // Skills granted by the picked background (from its compendium entry's
  // `skills` field), captured at pick time so the sheet can highlight which
  // checked skills came from the background regardless of later edits.
  backgroundSkillNames: string[];
  alignment: string;
  experiencePoints: string;

  abilities: DndAbilityScores;
  proficiencyBonus: string;
  inspiration: boolean;

  savingThrowProfs: Record<DndAbilityKey, boolean>;
  skillProfs: Record<string, DndSkillProfLevel>;

  armorClass: string;
  /**
   * БРОШЕННОЕ число инициативы — то, что игрок назвал за столом, записанное,
   * «чтобы помнить». Не модификатор: модификатор производный и живёт в
   * `deriveSheet(...).initiative`.
   *
   * Смысл сменился 2026-09-10. До этого здесь лежал вписанный руками
   * модификатор, который устаревал при любой правке Ловкости молча: у одного
   * живого листа стояло «0» при Ловкости 14. Тип тогда же стал числом — это
   * число уезжает Мастеру в очередь боя, а очередь держит `number | null`.
   */
  initiative: number | null;
  /**
   * Ручная поправка к бонусу инициативы — «прочее, чего модуль не знает».
   *
   * Названа по образцу `spellDcMisc`, а не `manualAcBonus`: смысл тот же, а
   * третьей манеры именования одного и того же в листе быть не должно.
   * Сам бонус инициативы НЕ хранится: он производный (`deriveSheet`).
   */
  initiativeMisc: string;
  speed: string;
  // Structured speeds (walk/fly/swim/climb/burrow), same shape as
  // DndCreatureSpeed — added alongside the legacy free-text `speed` above
  // rather than replacing it, since existing characters only ever filled
  // that in and normalizeDndCharacter() can't reliably parse arbitrary
  // free text back into numbers.
  speeds: DndCreatureSpeed;
  sensesList: DndCreatureSense[];
  damageResistances: string[];
  damageImmunities: string[];
  damageVulnerabilities: string[];
  conditionImmunities: string[];
  // Conditions currently affecting the character (Poisoned, Prone, etc.,
  // from the same "Состояния" compendium mechanics group used by
  // InitiativeTracker's condition picker) — a live tracker, not a defense
  // list like the four above.
  conditions: string[];
  hitPointMax: string;
  hitPointsCurrent: string;
  hitPointsTemp: string;
  // Temporary bonus to max HP (e.g. Aid) — stacks on top of hitPointMax for
  // the healing cap, tracked separately so restoring/removing the effect
  // doesn't require editing the character's real max HP.
  hitPointMaxTemp: string;
  hitDice: string;
  // Израсходованные кости хитов по пулам: ключ — сам куб («к10»), значение —
  // сколько потрачено. При мультиклассе пулы независимы (5к10 + 3к6), одной
  // дорожкой они не описываются. Тратятся на коротком отдыхе ради лечения,
  // половина возвращается на длинном.
  hitDiceUsed: Record<string, number>;
  // Движок хитов визарда левелапа (аддитивен к плоскому hitPointMax: старые
  // листы живут как lump = всё). lump — ручная порция (миграция с чужого
  // чарника); hpRolls — результаты костей по автоуровням; hpMiscPerLevel —
  // прочие бонусы за уровень числом. Итог = lump + Σrolls + ВЫН×уровень +
  // 2×уровень (Крепкий) + misc×уровень. Не заполнено — легаси-режим.
  hpLump?: number | null;
  hpRolls?: number[];
  hpMiscPerLevel?: number;
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  // Уровень истощения 0–6 (5.5): каждый уровень даёт −2 к любому броску к20
  // и −5 футов скорости, шестой — смерть. Длинный отдых снимает один.
  exhaustion: number;
  // Заклинание, на котором персонаж сейчас концентрируется («» — ни на чём).
  // Одно на весь лист: по правилам вторая концентрация снимает первую.
  concentration: string;

  attacks: DndManualAttack[];
  equipmentSections: DndEquipmentSection[];
  attunementCount: number;
  /** Дополнительные слоты настройки сверх трёх базовых (кнопка [+]). */
  attunementExtra?: number;
  coins: DndCoins;

  speciesFeatures: DndFeature[];
  classFeatures: DndFeature[];
  feats: DndFeature[];
  specialAbilities: DndFeature[];
  /** Освоенные типы оружия («Оружейные приёмы» Воина). Пусто — воин без
   *  выбора, не-воин или старый лист: подсветка мастерства не меняется. */
  masteredWeapons: DndMasteredWeapon[];
  proficiencies: DndProficiencyEntry[];

  personalityTraits: string;
  ideals: string;
  bonds: string;
  flaws: string;

  spellcasting: string;
  // Extra flat bonus to the computed spell save DC (feats, magic items, …),
  // editable only in edit mode — the base 8 + ability mod + proficiency
  // bonus is always derived, never stored directly.
  spellDcMisc: string;
  // Same idea as spellDcMisc, but for the spell attack bonus.
  spellAttackMisc: string;
  // Cantrips (level 0) — no slots, always shown regardless of spellSlotLevels.
  cantrips: DndSpellEntry[];
  // Requirement 11/12: 0-9 configurable count of active spell-level sections;
  // slot/spell arrays are always length 9 (indices 0-8 = levels 1-9) so data
  // beyond the current count survives lowering it and reappears if raised.
  spellSlotLevels: number;
  spellSlotPips: number[];
  // Ячейки считаются из таблиц развития классов (dndSlots.ts). Флаг
  // поднимается, когда мастер правит их руками: у самодельного класса без
  // заполненной таблицы или у нестандартной раздачи расчёт мешал бы.
  spellSlotsManual?: boolean;
  // Договор магии Колдуна: считается отдельно от обычных ячеек и хранится
  // только израсходованное — максимум всегда выводится из таблицы класса.
  pactSlotsUsed?: number;
  // Slots currently expended per level (0..spellSlotPips[i]) — separate from
  // the max-slots-per-level pips above, which only change on level-up/edit.
  // Quick-clicked in view mode during play, reset manually on a long rest.
  spellSlotsUsed: number[];
  spellsByLevel: DndSpellEntry[][];
  notes: string;
  // Extra flat КЗ bonus not captured by equipped items (e.g. Shield/Mage
  // Armor spell effects) — added on top of computeArmorClass()'s result.
  manualAcBonus: string;
  // Class-resource pools (Ресурсы tab) keyed by dndResources.ts's resource
  // key, e.g. "sorcery_points". Max is always computed from classes + this
  // bonus; only current-used and the external bonus are ever stored.
  resourceUsed: Record<string, number>;
  resourceBonus: Record<string, number>;
  /** Реплики Артефактора: известные схемы и созданное по ним. */
  replicaSchemes?: DndReplicaScheme[];
  replicaItems?: DndReplicaItem[];

  // --- карта персонажа (гриллинг 2026-09-04) ---
  // Точка фокуса портрета в долях 0..1. Само изображение заводить не надо —
  // у Персонажа уже есть avatar_image_path; но портреты бывают квадратные и в
  // полный рост, а зона на карте узкая и высокая, и обрезка по центру
  // промахивается по лицу. Игрок ставит точку один раз при загрузке.
  // Живёт в статблоке, а не в записи Персонажа, чтобы работать и у Существа.
  portraitFocus?: { x: number; y: number };
  // До трёх закладок «оружие/заклинание» на лицевой стороне карты. Лист
  // предлагает их сам; закреплённые перекрывают предложенные. Хранят имя
  // рядом с id — правило №3: id не переживает переустановку модуля.
  pinnedActions?: DndPinnedAction[];
  // Фамильяры и спутники — ряд жетонов внизу карты. Не картинка, а ссылка на
  // статблок существа: жетон открывает его лист, чтобы Мастер видел КЗ волка.
  companions?: DndCompanion[];
  /** Эликсиры алхимика на руках: эффект — ключом таблицы (data.elixirTable
   *  у умения), остальное читается оттуда. На долгом отдыхе сгорают вместе
   *  с флаконами — лист чистит сам. */
  elixirs?: DndElixir[];
}

/** Эликсир на руках: что внутри — по таблице умения. */
export interface DndElixir {
  id: string;
  /** Ключ эффекта из elixirTable записи умения. */
  effect: string;
}

/** Закрепление строки «Действий» на карте персонажа. */
export interface DndPinnedAction {
  /** Запись справочника, если строка пришла оттуда. */
  entryId: number | null;
  /** Имя рядом с id — по нему строка находится, когда id умер. */
  name: string;
  kind: "weapon" | "spell" | "feature" | "manual";
}

/** Жетон спутника внизу карты — ссылка на статблок существа. */
export interface DndCompanion {
  entryId: number | null;
  name: string;
  /** Свой статблок в приложении, если спутник заведён отдельной записью. */
  statblockId?: number | null;
  /** Тело спутника (пушка/защитник Артефактора): хиты и состояние.
   *  Максимум считается по чертежу (data.companion у фичи-хозяина) из
   *  уровня класса и модов характеристик — хранится только израсходованное. */
  hpUsed?: number;
  /** Развеян досрочно (пушка) — не мёртв, вернуть можно кнопкой. */
  dismissed?: boolean;
  /** Хиты на нуле: воскрешение/пересоздание — через карточку умения. */
  dead?: boolean;
  /** Откуда выведен: фича-чертёж и класс (для пересчёта формул при апе). */
  featureEntryId?: number | null;
  classId?: number | null;
  /** Призыв заклинанием (data.summon): id заклинания и круг ячейки, которым
   *  призвано — от него зависит мощь (хиты гомункула 5+5×круг). */
  spellEntryId?: number | null;
  spellLevel?: number;
  /** Вид тела из variants чертежа («Наземный зверь»): имя вида. Без поля —
   *  первый вид списка. Смена вида = новое тело: хиты считаются заново. */
  variant?: string | null;
}

// Освоенное оружие Воина («Оружейные приёмы», тикет 06): свойство
// мастерства оружия применимо только к освоенному. entryId — ссылка на
// тип оружия в справочнике (не на экземпляр в инвентаре): освоение не
// зависит от того, что сейчас в рюкзаке.
export interface DndMasteredWeapon {
  entryId: number | null;
  name: string;
}

export interface DndEquipmentItem {
  /** Стабильный ключ строки: переживает сортировку, drag-drop и удаление.
   *  Генерируется при создании, старые листы добираются нормализацией. */
  id?: string;
  name: string;
  qty: string;
  weight: string;
  /** Цена строкой из справочника («15 зм») — снимок на момент добавления.
   *  В расчётах пока не участвует (купить/продать — позже), только показ. */
  cost?: string;
  /** Запись-расходник (стакан зелий, стрелы): повтор ложится +1 в ту же
   *  строку во всех путях добавления, а не второй строкой. Снимок эвристики
   *  на момент добавления — хоумбрю правится флагом вручную. */
  stackable?: boolean;
  notes: string;
  // Set when added from the compendium (picker/drag-drop) rather than typed
  // by hand — enables click-to-view-description and, for armor/magic items,
  // participation in the computed КЗ.
  entryId?: number | null;
  equipped?: boolean;
  // Snapshotted armor/AC-bonus fields from the compendium entry at add time
  // (same idea as DndSpellEntry's cached meta) — computeArmorClass() reads
  // these without a live lookup.
  armorType?: string;
  ac?: string;
  maxDexBonus?: string;
  // Тяжёлый доспех размечен в компендиуме не пределом, а флагом
  // `dex_bonus: false` — без него Латы давали 18 + Ловкость.
  dexBonus?: boolean;
  acBonus?: string;
  /**
   * Эффекты записи справочника, снятые при добавлении, — тем же приёмом, что
   * `ac`/`acBonus` выше: `deriveSheet` читает их без похода в сеть.
   *
   * Нужны надетым предметам, дающим прибавку к броску (кольцо на инициативу).
   * У живых предметов пока не заполнены: разметка записей идёт отдельным
   * шагом.
   */
  effects?: DndEffect[];
  // Same idea, for weapons — set only when the compendium entry has a
  // damage value, so an equipped item can be told apart from armor/plain
  // gear without a separate "is this a weapon" flag.
  weaponDamage?: string;
  weaponAttackMelee?: boolean;
  weaponAttackRanged?: boolean;
  weaponProperties?: string;
  weaponMastery?: string;
  /** Снапшот зарядов магического предмета на момент добавления в инвентарь:
   *  chargesMax — строка шаблона («7», «1к8+1»), chargesRecharge — правило
   *  восстановления, chargesLeft — текущий остаток (null = не задан, напр.
   *  для максимума-кубика, пока игрок не бросит). */
  chargesMax?: string;
  chargesRecharge?: "dawn" | "none";
  chargesLeft?: number | null;
  // Категория из справочника («Простое оружие» / «Воинское оружие») — нужна,
  // чтобы отличить монашеское оружие. Снимок с момента добавления; у старых
  // строк её нет — там категория резолвится живьём по entryId (см. dndMonk).
  weaponCategory?: string;
  /** Предмет магический — своя пометка в списке. Ставится репликой
   *  Артефактора и вручную. */
  magical?: boolean;
  /** Прибавка к КЗ/атаке и урону от магии предмета: «Оружие +1» и «Доспех
   *  +1» не заводят второй строки инвентаря, а ложатся сюда поверх базового
   *  предмета (решение R3). */
  magicBonus?: number;
  /** Предмет настроен: связь «пипс ↔ строка», счётчик считается сам. */
  attuned?: boolean;
  // Снапшот магпредмета из справочника: редкость, требование настройки,
  // проклятие и тип — теги строки и фильтры пикера без живого лукапа.
  rarity?: string;
  requiresAttunement?: boolean;
  cursed?: boolean;
  itemType?: string;
  /** Реплика Артефактора, создавшая эту строку: по ней строка убирается
   *  вместе с исчезновением реплики. */
  replicaId?: string;
  /** Предмет передан другим персонажем и ещё не принят (решение R2/W8).
   *  Системы уведомлений в приложении нет, поэтому «уведомление» — это сама
   *  строка в инвентаре с пометкой и двумя кнопками. */
  pendingFrom?: string;
  /** Этап 4б: вещь отдана, но ещё не своя. transferOut — моя строка серая
   *  («передано → имя»): снята с носки, из расчётов исключена. transferIn —
   *  чужая строка у меня зелёная («принято ← имя») или фиолетовая, если вещь
   *  создана умением («создал имя»): ею пользуются как своей. Имя рядом с id —
   *  по правилу ссылок: id персонажа переживёт всё, а читается имя. */
  transferOut?: { id: number; toCharacterId: number; toName: string; qty: number };
  transferIn?: { id: number; fromCharacterId: number; fromName: string; kind: "item" | "replica" };
}

/** Схема реплики, известная Артефактору (решение W7): хранится у листа, а не
 *  считается по уровню — какие именно четыре из 161 он знает, решает игрок. */
export interface DndReplicaScheme {
  /** Запись магического предмета в справочнике. */
  entryId: number;
  name: string;
  /** Класс, чьё умение дало схему — у мультикласса их может быть несколько. */
  classId: number | null;
  /** Выбор из общей строки («любой обычный…»): id шаблона. Каждый такой выбор —
   *  отдельная схема (по книге), дубли одного предмета разрешены. */
  genericId?: string | null;
}

/** Созданный по схеме предмет. Живёт счётчиком во вкладке «Ресурсы» и
 *  строкой в инвентаре. */
export interface DndReplicaItem {
  /** Свой id: инвентарная строка ссылается на него, а не на схему —
   *  одну и ту же схему можно создать дважды. */
  id: string;
  schemeEntryId: number;
  name: string;
  classId: number | null;
  /** Для «Оружие +1» и «Доспех +1» — базовый предмет, к которому прибавка. */
  baseName?: string;
  baseEntryId?: number | null;
}

export interface DndCoins {
  cp: string;
  sp: string;
  ep: string;
  gp: string;
  pp: string;
}

export interface DndEquipmentSection {
  name: string;
  items: DndEquipmentItem[];
}

// A dropped/typed proficiency or language. abilityKey is set only for
// entries that compute a bonus (tools/weapons/armor); languages and other
// non-computed proficiencies leave it null and show no value.
export interface DndProficiencyEntry {
  entryId: number | null;
  name: string;
  abilityKey: DndAbilityKey | null;
}

export interface DndSpellEntry {
  entryId: number | null;
  name: string;
  // Оригинальное (английское) название — снимок `name_original` записи
  // компендиума, вторичный опознаватель в строке списка и в окне (тот же
  // приём, что у плиток бестиария, .monster-tile__en). Пусто у листов,
  // записанных до появления поля, и у заклинаний, вписанных руками: строка
  // тогда показывает одно русское имя, как показывала всегда.
  nameOriginal?: string;
  // Структурные броски и эффекты, снятые с записи компендиума (см.
  // components/dnd/effects.ts). Поля category/attackSave/damage/healing ниже
  // — то, чем это было раньше; они сохраняются только для листов, записанных
  // до перехода, и читаются лишь когда checks/effects пусты.
  checks?: DndCheck[];
  effects?: DndEffect[];
  prepared: DndSpellPreparedState;
  // Set only for spells auto-filled from a species/subclass's "Обретаемые
  // заклинания" pick — the id of that compendium entry, so picking a
  // different species/subclass can find-and-replace just its own granted
  // spells without touching hand-added ones (mirrors DndFeature.sourceParentId).
  sourceParentId?: number | null;
  // Таинственный арканум колдуна (тикет 03 warlock): заклинание 6–9 круга,
  // сотворяемое 1/долгий отдых без ячейки. Метка отличает его от обычных
  // заклинаний тех же кругов у мультиклассовых (там лежат настоящие ячейки):
  // по ней секции подписываются «Арканум», а пипсы выводятся из самих пиков.
  arcanum?: boolean;
  // «Не в счёт лимита»: «Починка» Артефактора, заклинания подкласса и выбор
  // «Посвящённого в магию» не занимают мест среди заговоров и подготовленных
  // (см. счётчик в разделе заклинаний и dndGrants.ts).
  outsideLimit?: boolean;
  // Snapshotted from the compendium entry when added, so the row can show
  // "школа | время накладывания | компоненты | концентрация | ритуал"
  // without re-fetching on every render.
  concentration?: boolean;
  ritual?: boolean;
  school?: string;
  // Legacy free-text casting time, kept only as a display fallback for
  // spells added before castingTiming existed (see DndActionTiming).
  castingTime?: string;
  castingTiming?: DndActionTiming;
  castingTimingOther?: string;
  range?: string;
  duration?: string;
  componentV?: boolean;
  componentS?: boolean;
  componentM?: boolean;
  materialComponent?: string;
  category?: string;
  attackSave?: string;
  damage?: string;
  healing?: string;
  upcast?: string;
}

export interface DndCreatureSpeed {
  walk: number | null;
  fly: number | null;
  swim: number | null;
  climb: number | null;
  burrow: number | null;
  hover: boolean;
  note: string;
}

export interface DndCreatureHitPoints {
  diceCount: number | null;
  dieSize: number | null; // 4|6|8|10|12
  bonus: number | null;
  // Legacy free-text formula, e.g. "45 (6к10+18)" — kept as a display
  // fallback for statblocks whose HP couldn't be parsed into the fields
  // above (see normalizeDndCreature).
  formula: string;
}

export interface DndCreatureArmorClass {
  value: number | null;
  note: string; // "натуральная броня", "кольчуга" и т.п.
}

export interface DndCreatureChallenge {
  rating: string; // "1/4", "5" и т.д.
  proficiencyBonus: number | null;
}

export type DndCreatureSpellFrequency = "atwill" | "perday" | "slots";

export interface DndCreatureSpellSlotLevel {
  level: number;
  slots: number;
}

export type DndAttackRollType = "attack" | "save";

export interface DndCreatureSpell {
  name: string;
  level: number; // 0 = заговор
  frequency: DndCreatureSpellFrequency;
  perDayCount: number | null;
  description: string;
  // Mechanical fields mirrored from DndCreatureAction, filled in only for
  // combat spells — lets a spell be added as an action row (see "Добавить
  // из заклинаний" in the wizard) without re-typing its bonus/save/damage.
  rollType?: DndAttackRollType;
  bonus?: number | null;
  saveAbility?: DndAbilityKey | "";
  saveDC?: number | null;
  damage?: string;
}

export interface DndCreatureSpellcasting {
  enabled: boolean;
  ability: DndAbilityKey | "";
  slots: DndCreatureSpellSlotLevel[];
  spells: DndCreatureSpell[];
}

export interface DndCreatureSense {
  name: string;
  distance: string;
}

export type DndActionCategory = "attack" | "movement" | "healing" | "defense" | "other";

export interface DndCreatureAction {
  name: string;
  category: DndActionCategory;
  // Category "attack" only: marks this row as a multiattack summary — no
  // roll/bonus/damage of its own, just descriptive text referencing the
  // creature's other attacks (matches how real 5e statblocks phrase it).
  isMultiattack?: boolean;
  rollType?: DndAttackRollType;
  bonus?: number | null;
  saveAbility?: DndAbilityKey | "";
  saveDC?: number | null;
  damage?: string;
  description: string;
  // Set when this row was added via "Добавить из заклинаний" — the source
  // spell's name, so it isn't offered for re-adding.
  sourceSpellName?: string;
}

export interface DndLegendaryActionEntry extends DndCreatureAction {
  cost: number;
}

export interface DndCreatureLegendary {
  resistanceEnabled: boolean;
  resistanceCount: number | null;
  actionsEnabled: boolean;
  actionPoints: number | null;
  actions: DndLegendaryActionEntry[];
  lairEnabled: boolean;
  lairActions: DndCreatureAction[];
}

export interface DndCreatureEquipmentItem {
  name: string;
  qty: string;
  notes: string;
  entryId?: number | null;
}

export interface DndCreatureLootItem {
  name: string;
  qty: string;
}

export interface DndCreatureLootCurrency {
  label: string;
  formula: string;
}

export interface DndCreatureLoot {
  items: DndCreatureLootItem[];
  currency: DndCreatureLootCurrency[];
}

export interface DndCreatureData {
  name: string;
  size: string;
  creatureType: string;
  alignment: string;
  armorClass: DndCreatureArmorClass;
  hitPoints: DndCreatureHitPoints;
  speed: DndCreatureSpeed;
  initiativeBonus: number | null;
  challenge: DndCreatureChallenge;
  abilities: DndAbilityScores;
  savingThrowProfs: Record<DndAbilityKey, boolean>;
  skillProfs: Record<string, boolean>;
  damageVulnerabilities: string[];
  damageResistances: string[];
  damageImmunities: string[];
  conditionImmunities: string[];
  saveAdvantageConditions: string[];
  saveAdvantageMagic: boolean;
  defenseNotes: string;
  sensesList: DndCreatureSense[];
  perceptionNote: string;
  passivePerception: number | null;
  languages: string;
  spellcasting: DndCreatureSpellcasting;
  traits: DndFeature[];
  actions: DndCreatureAction[];
  bonusActions: DndCreatureAction[];
  reactions: DndCreatureAction[];
  legendary: DndCreatureLegendary;
  habitat: string;
  treasure: string;
  equipment: DndCreatureEquipmentItem[];
  loot: DndCreatureLoot;
  notes: string;
  // Точка фокуса портрета — как у персонажа (этап 9): кадрирование узкой
  // зоны перетаскиванием. Живёт в статблоке, а не в записи существа.
  portraitFocus?: { x: number; y: number };
}
