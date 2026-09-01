import type { DndCheck, DndCost, DndEffect } from "./components/dnd/effects";

export interface System {
  id: number;
  name: string;
  /** Короткое сокращение модуля — «phb». См. Setting.code. */
  code: string | null;
  description: string;
  folder_path: string | null;
  thumbnail_image_path: string | null;
  thumbnail_image_url: string | null;
  created_at: string;
  archived_at: string | null;
  imported_at: string | null;
}

export interface SystemSection {
  id: number;
  system_id: number;
  position: number;
  name: string;
  kind: string;
  created_at: string;
}

export interface CompendiumEntry {
  id: number;
  system_id: number;
  section_id: number;
  parent_id: number | null;
  kind: string;
  name: string;
  level: number | null;
  data: Record<string, unknown>;
  description: string;
  /** Синонимы и оригинальное название — ищутся наравне с именем. */
  aliases: string[];
  name_original: string;
  /** Подпись пина на карте локации, если запись перетащили на карту. */
  short_name: string | null;
  position: number;
  created_at: string;
  /** Сколько карточек статблока у записи: бестиарий помечает значком те, у которых хотя бы одна. */
  statblock_count?: number;
  /** Собственный портрет записи (вкладка «Изображения») — плитка раздела, карточка существа, окна предпросмотра. */
  avatar_image_url?: string | null;
  /** Звезда бестиария — своя у каждого мастера. Приходит только со списком раздела. */
  favourite?: boolean;
  /** История и Поведение существа бестиария — приходят только в GET одной записи. */
  chapters?: CompendiumEntryChapter[];
}

export interface CompendiumEntryChapter {
  id: number;
  entry_id: number;
  section: string;
  title: string;
  content: string;
  created_at: string;
}

export interface StorageProfile {
  id: string;
  name: string;
  dbDir: string;
  vaultRoot: string;
  createdAt: string;
}

export interface GalleryImage {
  id: number;
  owner_type: "character" | "being" | "location" | "community" | "campaign_player_section";
  owner_id: number;
  image_path: string;
  image_url: string;
  caption: string;
  position: number;
  created_at: string;
}

export interface Module {
  id: number;
  type: "system" | "setting";
  name: string;
  source: "local" | "imported";
  enabled: number;
  system_id: number | null;
  setting_id: number | null;
  created_at: string;
  remote_id?: string | null;
  remote_version?: string | null;
}

// One entry from the GitHub module catalog (GET /modules/catalog),
// cross-referenced server-side against what's already installed.
export interface ModuleCatalogEntry {
  remoteId: string;
  type: "system" | "setting";
  name: string;
  description: string;
  version: string;
  installedModuleId: number | null;
  installedVersion: string | null;
  updateAvailable: boolean;
  /** Минимальная версия приложения для этой записи каталога, если задана. */
  minAppVersion: string | null;
  /** Эта сборка старше минимальной: файл она прочтёт неправильно. */
  tooOld: boolean;
}

export type PaymentType = "free" | "paid" | "negotiable";
export type CampaignType = "campaign" | "oneshot";
export type PaymentFrequency = "per_session" | "per_month";
export type RateSplit = "per_person" | "per_table";

export interface SettingGenre {
  genre: string;
  subgenre?: string;
}

export interface Setting {
  id: number;
  name: string;
  /** Короткое сокращение модуля — «wdh». Идёт в ссылки внутри текстов вместо
      полного имени: см. client/src/mentions.ts. Пустой — значит имя. */
  code: string | null;
  description: string;
  genres?: SettingGenre[];
  background_image_path: string | null;
  background_image_url: string | null;
  thumbnail_image_path: string | null;
  thumbnail_image_url: string | null;
  folder_path: string | null;
  calendar_era: string;
  pinned_calendar_year: number | null;
  pinned_calendar_month: number | null;
  created_at: string;
  archived_at: string | null;
  imported_at: string | null;
}

export interface SettingGroup {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface CampaignGroup {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface SystemGroup {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface PlayerGroup {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface CalendarMonth {
  id: number;
  setting_id: number;
  position: number;
  name: string;
  days: number;
}

export interface CalendarWeekday {
  id: number;
  setting_id: number;
  position: number;
  name: string;
}

export interface SettingCalendar {
  months: CalendarMonth[];
  weekdays: CalendarWeekday[];
  era: string;
}

export type DateRecurrence = "once" | "annual" | "monthly" | "weekly" | "custom";

export interface CustomRule {
  kind: "every" | "ordinal";
  every_n?: number;
  every_unit?: string;
  ordinal?: number;
  ordinal_unit?: string;
  in_unit?: string;
}

export interface ImportantDate {
  id: number;
  owner_type: "being" | "community" | "location" | "setting";
  owner_id: number;
  owner_name?: string;
  title: string;
  description: string;
  date_type: string;
  color: string;
  recurrence: DateRecurrence;
  custom_rule: string;
  year: number | null;
  month: number | null;
  day: number;
  created_at: string;
}

export interface CampaignCalendarEvent extends EventTimeFields {
  id: number;
  campaign_id: number;
  title: string;
  description: string;
  inworld_year: number;
  inworld_month: number;
  inworld_day: number;
  important: number;
  created_at: string;
}

/** Точность даты события: её задаёт масштаб, на котором событие поставили. */
export type DatePrecision = "century" | "decade" | "year" | "month" | "day";
/** Предстоит / случилось / отменено. */
export type EventStatus = "upcoming" | "happened" | "cancelled";

/** Общие поля времени у обеих таблиц событий. */
export interface EventTimeFields {
  date_precision: DatePrecision;
  /** Конец периода. Пусто — событие точечное, а не растянутое. */
  inworld_year_end: number | null;
  inworld_month_end: number | null;
  inworld_day_end: number | null;
  status: EventStatus;
  /** Чем отменилось: что игроки сделали, чтобы этого не произошло. */
  cancel_note: string;
}

/** Цикл сеттинга: «каждые N дней, начиная с такой-то даты». */
export interface SettingCycle {
  id: number;
  setting_id: number;
  name: string;
  period_days: number;
  anchor_year: number;
  anchor_month: number;
  anchor_day: number;
  position: number;
  points: SettingCyclePoint[];
}

/** Именованная точка внутри оборота: «полнолуние» на 14-м дне. */
export interface SettingCyclePoint {
  id: number;
  cycle_id: number;
  name: string;
  day_offset: number;
  position: number;
}

export interface SettingCalendarEvent extends EventTimeFields {
  id: number;
  setting_id: number;
  title: string;
  /** Короткая строка для хроники; развёрнутый текст — в профиле события. */
  description: string;
  full_description: string;
  consequences: string;
  inworld_year: number;
  inworld_month: number;
  inworld_day: number;
  important: number;
  visible_to_players: number;
  created_at: string;
  /** Приходит только у одиночного события — для хлебных крошек профиля. */
  setting_name?: string;
}

export type CampaignRole = "gm" | "player";

export interface Campaign {
  id: number;
  name: string;
  role: CampaignRole;
  system_id: number | null;
  system_name?: string;
  setting_id: number | null;
  setting_name?: string;
  status: string;
  type: CampaignType;
  payment_type: PaymentType;
  payment_frequency: PaymentFrequency;
  rate_split: RateSplit;
  session_rate: number;
  currency: string;
  background_image_path: string | null;
  background_image_url: string | null;
  thumbnail_image_path: string | null;
  thumbnail_image_url: string | null;
  group_theme_litm: string | null;
  pinned_calendar_year: number | null;
  pinned_calendar_month: number | null;
  player_count?: number;
  held_sessions_count?: number;
  next_planned_date?: string | null;
  folder_path: string | null;
  created_at: string;
  archived_at: string | null;
}

export type RosterStatus = "active" | "left";

export interface RosterPlayer extends Player {
  roster_status: RosterStatus;
}

export interface CampaignDetail extends Campaign {
  roster: RosterPlayer[];
  finance: { earned: number; heldSessions: number };
}

export interface Player {
  id: number;
  name: string;
  notes: string;
  folder_path: string | null;
  created_at: string;
  archived_at: string | null;
  thumbnail_image_url: string | null;
  avatar_image_path: string | null;
  avatar_image_url: string | null;
  next_planned_date?: string | null;
}

export interface CharacterChapter {
  id: number;
  character_id: number;
  section: "personality" | "backstory" | "personal_arc" | "current_situation" | "future_thoughts" | "inventory";
  title: string;
  content: string;
  image_path: string | null;
  image_url: string | null;
  created_at: string;
}

export interface Character {
  id: number;
  player_id: number;
  player_name?: string;
  campaign_id: number | null;
  campaign_name?: string | null;
  campaign_setting_id?: number | null;
  character_name: string;
  short_name: string | null;
  backstory: string;
  statblock: string;
  current_situation: string;
  personal_arc: string;
  future_thoughts: string;
  connections_notes: string;
  avatar_image_path: string | null;
  avatar_image_url: string | null;
  thumbnail_image_path: string | null;
  thumbnail_image_url: string | null;
  folder_path: string | null;
  created_at: string;
  archived_at: string | null;
  chapters?: CharacterChapter[];
  important_dates?: ImportantDate[];
}

export interface PlayerDetail extends Player {
  characters: Character[];
}

export interface GmReminder {
  id: number;
  target_type: "player" | "campaign";
  target_id: number;
  message: string;
  created_at: string;
}

export type StatblockFormat =
  | "text"
  | "litm_character"
  | "litm_challenge"
  | "dnd_character"
  | "dnd_creature";

export interface Statblock {
  id: number;
  owner_type: "character" | "being" | "compendium_entry";
  owner_id: number;
  kind: "short" | "full";
  format: StatblockFormat;
  content: string;
  note: string;
  theme: string | null;
  density: string | null;
  avatar_image_path: string | null;
  avatar_image_url: string | null;
  created_at: string;
}

export type LitMPower = "" | "origin" | "adventure" | "greatness" | "variable";

export interface LitMImprovement {
  text: string;
  active: boolean;
}

export interface LitMThemeCard {
  power: LitMPower;
  themeType: string;
  name: string;
  powerTags: string[];
  weaknessTags: string[];
  quest: string;
  improve: number;
  abandon: number;
  milestone: number;
  specialImprovements: LitMImprovement[];
}

export interface LitMCharacterData {
  characterName: string;
  playerName: string;
  promise: string;
  quest: string;
  fellowshipRelationship: string;
  companionCharacterType?: string;
  companionCharacterId?: number;
  companionCharacterName?: string;
  companionRelationshipTag: string;
  quintessences: string;
  backpack: string[];
  specialImprovements: string;
  notes: string;
  themes: LitMThemeCard[];
  storyThemes: LitMThemeCard[];
  fellowshipTheme: LitMThemeCard;
}

export interface LitMChallengeData {
  title: string;
  role: string;
  mightLevel: "origin" | "adventure" | "greatness" | "variable";
  might: number;
  tagsAndStatuses: string;
  limits: string;
  threatsConsequences: string;
  specialFeatures: string;
}

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
  initiative: string;
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
  deathSaveSuccesses: number;
  deathSaveFailures: number;

  attacks: DndManualAttack[];
  equipmentSections: DndEquipmentSection[];
  attunementCount: number;

  speciesFeatures: DndFeature[];
  classFeatures: DndFeature[];
  feats: DndFeature[];
  specialAbilities: DndFeature[];
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
}

export interface DndEquipmentItem {
  name: string;
  qty: string;
  weight: string;
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
  acBonus?: string;
  // Same idea, for weapons — set only when the compendium entry has a
  // damage value, so an equipped item can be told apart from armor/plain
  // gear without a separate "is this a weapon" flag.
  weaponDamage?: string;
  weaponAttackMelee?: boolean;
  weaponAttackRanged?: boolean;
  weaponProperties?: string;
  weaponMastery?: string;
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
}

// «Перенесена» была четвёртым статусом при старом «переносе», который
// заводил новую сессию вместо правки даты. Перенос убран, дата правится
// прямо на сессии — статус больше не нужен.
export type SessionStatus = "planned" | "held" | "cancelled";

// A session that @-mentions some other entity — see GET /links/mentioning-sessions.
export interface MentioningSession {
  id: number;
  date: string;
  title: string | null;
  session_number: number | null;
  campaign_id: number;
  campaign_name: string;
}

export interface SessionSummary {
  id: number;
  campaign_id: number;
  campaign_name?: string;
  date: string;
  title: string | null;
  status: SessionStatus;
  payment_override: PaymentType | null;
  effective_payment_type: PaymentType;
  session_number?: number;
  campaign_role?: CampaignRole;
  main_events?: string;
  idea_notes?: string;
  inworld_year: number | null;
  inworld_month: number | null;
  inworld_day: number | null;
  inworld_year_end: number | null;
  inworld_month_end: number | null;
  inworld_day_end: number | null;
  start_time: string | null;
}

export interface AttendanceRow {
  player_id: number;
  name: string;
  attended: number;
  amount_paid: number;
}

export interface SessionDetail extends SessionSummary {
  stake_override: number | null;
  idea_notes: string;
  main_events: string;
  main_events_visible: number;
  combat_active: number;
  combat_turn_entry_id: number | null;
  battle_playlist_id: number | null;
  folder_path: string | null;
  campaign_payment_type: PaymentType;
  campaign_session_rate: number;
  currency: string;
  attendance: AttendanceRow[];
  resources: Resource[];
  earned: number;
  archived_at: string | null;
  cheatsheet_data: string | null;
}

export interface Resource {
  id: number;
  name: string;
  type: string;
  // Sub-grouping within the "link" type (folder/pdf/image/audio/link/other)
  // — see client/src/resourceCategories.ts. Only session Ресурсы rows set
  // this today; other resource lists leave it null.
  category?: string | null;
  scope: "global" | "campaign" | "session" | "setting" | "system";
  campaign_id: number | null;
  session_id: number | null;
  setting_id: number | null;
  system_id: number | null;
  system_name?: string;
  setting_name?: string;
  template_kind: "short" | "full" | null;
  template_format?: StatblockFormat;
  file_path: string | null;
  file_url?: string | null;
  link_url: string | null;
  tags: string;
  notes: string;
  created_at: string;
  archived_at: string | null;
  // Only populated by GET /resources — settings this resource was tagged
  // into additionally, on top of its single "home" setting_id (see
  // resource_setting_links / POST|DELETE /resources/:id/settings).
  also_in_settings?: number[];
  // Only populated by GET /resources — computed on read via fs.stat, not
  // stored; null when there's no file_path or the file is missing.
  size_bytes?: number | null;
}

export interface PlaylistItem {
  id: number;
  position: number;
  resource_id: number;
  name: string;
  resource_name: string;
  custom_name: string | null;
  src: string | null;
}

// Единственный оставшийся вид плейлиста — боевая тема: глобальная, без
// владельца. Плейлисты сессий и сеттингов убраны вместе с их разделами,
// музыку теперь держит набор своими треками.
export interface Playlist {
  id: number;
  name: string;
  scope: "battle";
  session_id: number | null;
  setting_id: number | null;
  created_at: string;
  item_count: number;
}

export interface PlaylistDetail extends Playlist {
  items: PlaylistItem[];
}

export interface MasteringSection {
  id: number;
  category: "prep" | "live" | "knowledge";
  name: string;
  system_id: number | null;
  system_name?: string | null;
  position: number;
  created_at: string;
}

export interface MasteringNote {
  id: number;
  category: "prep" | "live" | "knowledge";
  section_id: number | null;
  section_name?: string | null;
  system_id: number | null;
  system_name?: string;
  title: string;
  content: string;
  created_at: string;
  archived_at: string | null;
}

export interface Preproduction {
  campaign_id: number;
  adventure_challenge: string;
  gameplay_styles: string;
  background: string;
  adventure_stakes_hooks: string;
  threads_clues_lore: string;
}

export interface SettingLocation {
  id: number;
  setting_id: number;
  parent_id: number | null;
  name: string;
  short_name: string | null;
  kind: string;
  /** Другие названия: переводы, сокращения, прозвища. */
  aliases: string[];
  /** Название в оригинале книги: «Sea Ward». */
  name_original: string;
  description: string;
  folder_path: string | null;
  avatar_image_path: string | null;
  avatar_image_url: string | null;
  thumbnail_image_path: string | null;
  thumbnail_image_url: string | null;
  map_image_path: string | null;
  map_image_url: string | null;
  map_max_zoom: number | null;
  map_start_zoom: number | null;
  map_goto_zoom: number | null;
  map_labels_always: number;
  created_at: string;
  archived_at: string | null;
}

export interface LocationPin {
  id: number;
  location_id: number;
  target_type: string;
  target_id: number;
  x: number;
  y: number;
  color: string | null;
  size: number | null;
  border_color: string | null;
  created_at: string;
}

export interface LocationChapter {
  id: number;
  location_id: number;
  title: string;
  content: string;
  visible_to_players: boolean | number;
  created_at: string;
}

export interface CreatureMeta {
  size: string;
  creatureType: string;
  alignment: string;
}

export interface LocationInhabitantBeing extends SettingBeing {
  communities: { id: number; name: string }[];
  // Only populated on nested_inhabitant_beings — names of the descendant
  // locations this being actually inhabits, shown as "(location)" suffixes.
  location_names?: string[];
}

export interface SettingLocationDetail extends SettingLocation {
  children: SettingLocation[];
  ancestors: { id: number; name: string }[];
  pins: LocationPin[];
  chapters: LocationChapter[];
  inhabitant_beings: LocationInhabitantBeing[];
  nested_inhabitant_beings: LocationInhabitantBeing[];
  inhabitant_communities: { id: number; name: string }[];
  important_dates: ImportantDate[];
}

export type BeingCategory = "bestiary" | "key_figure" | "influential" | "notable";

export interface SettingBeing {
  id: number;
  setting_id: number;
  name: string;
  short_name: string | null;
  category: BeingCategory;
  /** Другие названия: переводы, сокращения, прозвища. */
  aliases: string[];
  /** Название в оригинале книги: «Sea Ward». */
  name_original: string;
  location_id: number | null;
  locations: { id: number; name: string }[];
  base_monster_id: number | null;
  base_monster_name: string | null;
  statblock_short: string;
  statblock_full: string;
  history: string;
  behavior: string;
  description: string;
  creature_meta: CreatureMeta | null;
  /** Сколько карточек статблока заведено: списки помечают значком тех, у кого хотя бы одна. */
  statblock_count?: number;
  tags: string[];
  avatar_image_path: string | null;
  avatar_image_url: string | null;
  thumbnail_image_path: string | null;
  thumbnail_image_url: string | null;
  folder_path: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface SettingCommunity {
  id: number;
  setting_id: number;
  parent_id: number | null;
  name: string;
  description: string;
  /** Другие названия: переводы, сокращения, прозвища. */
  aliases: string[];
  /** Название в оригинале книги: «Sea Ward». */
  name_original: string;
  history: string;
  current_situation: string;
  features: string;
  goals: string;
  tags: string[];
  folder_path: string | null;
  avatar_image_path: string | null;
  avatar_image_url: string | null;
  thumbnail_image_path: string | null;
  thumbnail_image_url: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface CommunityChapter {
  id: number;
  community_id: number;
  section: string;
  title: string;
  content: string;
  created_at: string;
}

export interface CommunityMemberBeing extends SettingBeing {
  // Total number of factions this being belongs to (not just this one) —
  // drives the "belongs to several factions" icon in the members list.
  community_count: number;
}

export interface SettingCommunityDetail extends SettingCommunity {
  members: CommunityMemberBeing[];
  children: SettingCommunity[];
  ancestors: { id: number; name: string }[];
  chapters: CommunityChapter[];
  locations: { id: number; name: string }[];
  important_dates: ImportantDate[];
}

export interface BeingEvent {
  id: number;
  being_id: number;
  session_id: number | null;
  session_date?: string;
  campaign_name?: string;
  title: string;
  description: string;
  created_at: string;
}

export interface BeingRelation {
  id: number;
  being_a_id: number;
  being_b_id: number;
  being_a_name: string;
  being_b_name: string;
  relation_type: string;
  description: string;
  created_at: string;
}

export type RelationTone = "positive" | "negative" | "neutral" | "mixed";
export type RelationEntityType =
  | "being"
  | "character"
  | "community"
  | "compendium_entry"
  | "location"
  | "artifact";

// Directional: from_* feels `tone` about to_* — not assumed mutual. The API
// always returns each row alongside `other_type`/`other_id`/`other_name`,
// pre-resolved to whichever side isn't the entity the request was scoped to.
export interface EntityRelation {
  id: number;
  from_type: RelationEntityType;
  from_id: number;
  to_type: RelationEntityType;
  to_id: number;
  other_type: RelationEntityType;
  other_id: number;
  other_name: string | null;
  tone: RelationTone;
  label: string;
  description: string;
  created_at: string;
}

export interface EntityRelationsResponse {
  outgoing: EntityRelation[];
  incoming: EntityRelation[];
}

export interface BeingChapter {
  id: number;
  being_id: number;
  section: "history" | "behavior" | "current_situation";
  title: string;
  content: string;
  campaign_id: number | null;
  campaign_name: string | null;
  important: boolean | number;
  visible_to_players: boolean | number;
  created_at: string;
}

// Monster templates from any system's compendium linked to this being —
// used by бестиарий entries, which may carry several systems' versions of
// the same creature kind.
export interface CompendiumLink {
  id: number;
  name: string;
  system_id: number | null;
  system_name: string | null;
}

export interface SettingBeingDetail extends SettingBeing {
  events: BeingEvent[];
  relations: BeingRelation[];
  communities: { id: number; name: string }[];
  compendium_links: CompendiumLink[];
  important_dates: ImportantDate[];
  chapters: BeingChapter[];
}

// "Приключения" — see schema.sql's story_arcs / story_scenes for the
// copy-on-write campaign layer these types mirror.
export type SceneKind = "scene" | "encounter" | "branch" | "ending";
export type SceneStatus = "pending" | "done" | "skipped";

export interface StoryArc {
  id: number;
  setting_id: number;
  parent_id: number | null;
  name: string;
  kind: "adventure" | "chapter";
  description: string;
  hook: string;
  recommended_level: string;
  player_count: string;
  duration: string;
  source: string;
  tags: string;
  thumbnail_image_path: string | null;
  // The setting's single auto-created "Сцены вне приключений" bucket: can't
  // be renamed or archived.
  is_default: number;
  position: number;
  /** Сцены дуги вместе со сценами её глав. */
  scene_count: number;
  /** Только в списке приключений: сколько у дуги глав. */
  chapter_count?: number;
  created_at: string;
  archived_at: string | null;
  // Приходят при чтении из кампании: тексты подменены её собственной копией
  // приключения, а override_id — id этой копии. Сам id остаётся id оригинала:
  // главы, сцены, вехи и тайны висят именно на нём.
  is_override?: boolean;
  override_id?: number | null;
  /** Есть ли у кампании хоть какие-то свои правки или прогресс по нему. */
  has_campaign_edits?: boolean;
}

/** Приключение кампании вместе с его главами и сценами (раздел «Главы и сцены»). */
export interface CampaignAdventureTree extends StoryArc {
  scenes: StoryScene[];
  chapters: (StoryArc & { scenes: StoryScene[] })[];
}

/**
 * Вехи или тайны кампании, разложенные по её приключениям. `own` — записи
 * самой кампании, не привязанные ни к одному приключению.
 */
export interface CampaignGrouped<T> {
  groups: { arc: { id: number; name: string; is_default: number }; items: T[] }[];
  own: T[];
}

export interface StoryMilestone {
  id: number;
  /** Пусто у собственной вехи кампании, не привязанной к приключению. */
  arc_id: number | null;
  /** Заполнено у собственной вехи кампании — своей или доложенной в чужое приключение. */
  campaign_id?: number | null;
  scene_id: number | null;
  scene_name: string | null;
  title: string;
  description: string;
  position: number;
  state?: { achieved: number; note: string } | null;
}

export interface StorySecret {
  id: number;
  /** Пусто у собственной тайны кампании, не привязанной к приключению. */
  arc_id: number | null;
  /** Заполнено у собственной тайны кампании. */
  campaign_id?: number | null;
  kind: "secret" | "clue" | "thread";
  title: string;
  content: string;
  position: number;
  state?: { revealed: number; note: string } | null;
}

export interface CastMember {
  type: string;
  id: number;
  name: string;
  sections: string[];
  scenes: string[];
}

export interface StoryArcDetail extends StoryArc {
  chapters: StoryArc[];
  scenes: StoryScene[];
  milestones: StoryMilestone[];
  secrets: StorySecret[];
  rewards: (SceneReward & { scene_name: string | null; arc_id: number | null })[];
  cast: CastMember[];
}

export interface StoryScene {
  id: number;
  /** Пусто у заготовки, чей сеттинг удалили: сеттинг — метка, а не владелец. */
  setting_id: number | null;
  arc_id: number | null;
  campaign_id: number | null;
  source_scene_id: number | null;
  /** Эта строка — вставка заготовки и читает её тексты, пока не тронута. */
  library_scene_id: number | null;
  /** Имя и сеттинг заготовки — для пометки «по заготовке». null у обычной сцены. */
  library_name: string | null;
  library_setting_id: number | null;
  /** Сцена лежит на полке заготовок и предлагается к вставке. */
  in_library: number;
  name: string;
  kind: SceneKind;
  summary: string;
  read_aloud: string;
  whats_happening: string;
  entry_condition: string;
  outcomes: string;
  hidden_from_players: number;
  position: number;
  created_at: string;
  archived_at: string | null;
  // Present on campaign-scoped reads: this row is the campaign's edited copy
  // of a setting scene, or a scene that exists only inside this campaign.
  is_override?: boolean;
  campaign_only?: boolean;
  state: { status: SceneStatus; note: string } | null;
}

/**
 * Исход проверки. Подпись — имя разъёма («Успех», «Провал с последствиями»),
 * `consequence` — что происходит словами, target_* — необязательная связь
 * «а дальше сюда». Число исходов задаёт система, а не программа, поэтому
 * список свободный.
 */
export interface CheckOutcome {
  id: number;
  check_id: number;
  label: string;
  consequence: string;
  target_type: string | null;
  target_id: number | null;
  /** Имя сцены, в которую ведёт исход — иначе панель показала бы «ведёт в #37». */
  target_name: string | null;
  position: number;
}

export interface SceneCheck {
  id: number;
  scene_id: number;
  what: string;
  difficulty: string;
  /**
   * on_success/on_failure сервер по-прежнему отдаёт (колонки живы до
   * отдельной миграции), но в типе их нет намеренно: последствия читаются
   * только из outcomes, и поле, которого нет в типе, нельзя случайно
   * показать вместо актуального.
   */
  outcomes: CheckOutcome[];
  position: number;
}

export interface SceneReward {
  id: number;
  scene_id: number;
  what: string;
  where_found: string;
  notes: string;
  artifact_id: number | null;
  artifact_name: string | null;
  position: number;
}

export interface SceneTransition {
  id: number;
  from_scene_id: number;
  to_scene_id: number;
  to_scene_name: string;
  label: string;
  position: number;
}

export interface StorySceneDetail extends StoryScene {
  checks: SceneCheck[];
  rewards: SceneReward[];
  transitions: SceneTransition[];
}

export interface Artifact {
  id: number;
  setting_id: number;
  name: string;
  short_name: string | null;
  description: string;
  owner: string;
  /** Другие названия: переводы, сокращения, прозвища. */
  aliases: string[];
  /** Название в оригинале книги: «Sea Ward». */
  name_original: string;
  power: string;
  history: string;
  notes: string;
  /** Секрет предмета — тайна мастера, скрытая от игроков. */
  secret: string;
  /** Род предмета: magic_item | equipment. От него зависит список типов. */
  item_class: string | null;
  item_type: string | null;
  /** Теги — свободная классификация. */
  tags: string[];
  /** Редкость и настройка есть только у магических предметов. */
  rarity: string | null;
  requires_attunement: boolean | number;
  avatar_image_url: string | null;
  file_path: string | null;
  folder_path: string | null;
  created_at: string;
  archived_at: string | null;
  chapters: ArtifactChapter[];
  /** Записи компендиумов систем, описывающие этот же предмет. */
  compendium_links?: CompendiumLink[];
  /** Важные даты — отмечаются на календаре сеттинга. */
  important_dates: ImportantDate[];
  /** Локация, где находится предмет (подставляется сервером через withRefs). */
  location?: { id: number; name: string } | null;
  /** Владелец-сущность (подставляется сервером через withRefs). */
  owner_entity?: { type: string; id: number; name: string } | null;
}

/** Данные карточки предмета — быстрый взгляд (аналог CreatureCardPayload). */
export interface ArtifactCardPayload {
  id: number;
  name: string;
  short_name: string | null;
  description: string;
  owner: string;
  power: string;
  history: string;
  notes: string;
  secret: string;
  item_class: string | null;
  item_type: string | null;
  rarity: string | null;
  requires_attunement: boolean;
  avatar_image_url: string | null;
  location?: { id: number; name: string } | null;
  owner_entity?: { type: string; id: number; name: string } | null;
}

export interface ArtifactChapter {
  id: number;
  artifact_id: number;
  title: string;
  content: string;
  created_at: string;
}

export interface AppSettings {
  home_background_path: string | null;
  home_background_url: string | null;
  fade_duration_ms: number;
}

export interface SearchResult {
  type: string;
  id: number;
  title: string;
  subtitle?: string;
  system_id?: number;
  section_id?: number;
  // Only populated for type === "compendium_entry": the entry's own kind
  // (item/spell/mechanic_item/…) and level, so a drop target can act on a
  // dragged search result without a second fetch.
  kind?: string;
  level?: number | null;
  // Only set for kind === "mechanic_item" entries that carry a governing
  // ability (tool proficiencies) — see CompendiumSection's TOOL_ABILITY_FIELD.
  ability?: string;
  // Human-readable owning setting/campaign/system, e.g. "Сеттинг: Асгард" —
  // shown next to the type chip so same-named entities across different
  // settings/campaigns are distinguishable.
  context?: string;
}

export interface ArchiveItem {
  type: string;
  id: number;
  title: string;
  subtitle?: string;
  archived_at: string;
}

// A single file moved to _Archive after the last remaining link to its
// content was removed and the user chose "отправить в архив" over "удалить
// навсегда" — see server/src/services/vaultDedup.ts.
export interface ArchivedFile {
  id: number;
  original_owner_type: string;
  original_owner_id: number;
  original_name: string;
  archive_path: string;
  size: number;
  archived_at: string;
}

export interface LinkNote {
  id: number;
  link_id: number;
  title: string;
  content: string;
  created_at: string;
}

export interface CampaignEntry {
  id: number;
  campaign_id: number;
  // secrets переехали в story_secrets: собственные тайны кампании и тайны
  // приключений теперь одна модель.
  category: "notes" | "quotes" | "tasks" | "gm_notes" | "post_production";
  title: string;
  content: string;
  status: "none" | "done" | "failed";
  priority: number;
  created_at: string;
}

export type WorldExplorationKind = "being" | "location" | "item" | "event";

export interface WorldExplorationEntry {
  id: number;
  campaign_id: number;
  player_id: number;
  player_name?: string;
  kind: WorldExplorationKind;
  name: string;
  description: string;
  extra_field: string;
  avatar_image_path: string | null;
  avatar_image_url: string | null;
  folder_path: string;
  created_at: string;
}

export interface InitiativeEntry {
  id: number;
  session_id: number;
  entity_type: string | null;
  entity_id: number | null;
  name: string;
  dex_modifier: number;
  initiative: number | null;
  max_hp: number | null;
  current_hp: number | null;
  temp_hp: number | null;
  dead: boolean | number;
  conditions: string; // JSON-encoded string[], parse before use
  // creature — боец; lair, environment, custom — строки без хитов.
  kind: InitiativeKind;
  created_at: string;
}

export type InitiativeKind = "creature" | "lair" | "environment" | "custom";

export interface SettingEntry {
  id: number;
  setting_id: number;
  category: "notes";
  title: string;
  content: string;
  created_at: string;
}

export interface SettingCalendarEra {
  id: number;
  setting_id: number;
  name: string;
  start_year: number;
  timeline_id: number | null;
  created_at: string;
}

export interface SettingCalendarTimeline {
  id: number;
  setting_id: number;
  name: string;
  position: number;
  created_at: string;
}

export type CampaignPlayerSectionKind = "gallery" | "articles";

export interface CampaignPlayerSection {
  id: number;
  campaign_id: number;
  name: string;
  kind: CampaignPlayerSectionKind;
  folder_path: string | null;
  position: number;
  created_at: string;
}

export interface CampaignPlayerArticle {
  id: number;
  section_id: number;
  title: string;
  content: string;
  position: number;
  created_at: string;
}

// Backs both the campaign "Для игроков" tab and the setting one — see
// schema.sql's comment on player_visibility_grants for the full target_type list.
export type VisibilityTargetType =
  | "campaign_player_section"
  | "campaign_player_article"
  | "setting_location"
  | "setting_being"
  | "setting_community"
  | "setting_calendar_event";

export interface PlayerVisibilityGrant {
  id: number;
  campaign_id: number;
  player_id: number;
  target_type: VisibilityTargetType;
  target_id: number;
  created_at: string;
}

// Player-role campaign view (GET /api/player/campaigns/:id/visible etc.) —
// same shapes the player-app reads, reused here so the desktop client's own
// player-role account gets the same "what the GM revealed" view instead of
// the GM-only CampaignDetailPage. See server/src/routes/player.ts.
export interface VisibleSession {
  id: number;
  date: string;
  title: string | null;
  main_events: string;
}

export interface VisibleSecret {
  id: number;
  title: string;
  content: string;
  created_at: string;
}

export interface VisibleArticle {
  id: number;
  title: string;
  content: string;
  created_at: string;
  location_name?: string;
  being_name?: string;
}

export interface VisibleChronicleEvent {
  id: number;
  title: string;
  description: string;
  inworld_year: number;
  inworld_month: number;
  inworld_day: number;
}

export interface SessionScheduleEntry {
  id: number;
  date: string;
  start_time: string | null;
  title: string | null;
  status: string;
}

export interface VisibleCampaignContent {
  campaign: { id: number; name: string; setting_id: number | null; system_id: number | null };
  sessions: VisibleSession[];
  schedule: SessionScheduleEntry[];
  secrets: VisibleSecret[];
  locationArticles: VisibleArticle[];
  beingArticles: VisibleArticle[];
  chronicleEvents: VisibleChronicleEvent[];
}

export interface PlayerSectionArticle {
  id: number;
  title: string;
  content: string;
}

export interface PlayerSectionImage {
  id: number;
  image_url: string;
  caption: string;
}

export interface PlayerSection {
  id: number;
  name: string;
  kind: "gallery" | "articles";
  articles?: PlayerSectionArticle[];
  images?: PlayerSectionImage[];
}

export interface SettingPlayerLocation {
  id: number;
  name: string;
  description: string;
}

export interface SettingPlayerBeing {
  id: number;
  name: string;
  category: string;
  history: string;
  behavior: string;
}

export interface SettingPlayerCommunity {
  id: number;
  name: string;
  description: string;
}

export interface SettingPlayerChronicleEvent {
  id: number;
  title: string;
  description: string;
  inworld_year: number;
  inworld_month: number;
  inworld_day: number;
}

export interface SettingPlayerContent {
  locations: SettingPlayerLocation[];
  beings: SettingPlayerBeing[];
  communities: SettingPlayerCommunity[];
  chronicleEvents: SettingPlayerChronicleEvent[];
}

export interface MyCampaignSummary {
  campaign_id: number;
  campaign_name: string;
}

export interface PartyMember {
  id: number;
  character_name: string;
  player_name: string;
  avatar_image_path: string | null;
  avatar_image_url: string | null;
}

// ------------------------------------------------------------------ полотно

/**
 * Переход, второй конец которого лежит на другом холсте (блок G6.2, Q17).
 *
 * После того как глава стала узлом-контейнером, 13 переходов из 81 разошлись
 * по двум холстам. Стрелке прийти некуда, но и молчать нельзя — холст не
 * должен врать. Поэтому у сцены остаётся висящий разъём: он называет чужую
 * сцену и знает адрес её холста, а шагает по нему Мастер щелчком.
 */
export interface OutsideLink {
  /** `out` — отсюда туда (разъём справа), `in` — оттуда сюда (слева). */
  dir: "out" | "in";
  label: string;
  scene_id: number;
  scene_name: string;
  arc_id: number;
  arc_name: string;
  setting_id: number;
  /** Холст, на который ведёт щелчок. */
  board_arc_id: number;
}

/** Нода на холсте: ссылка на реальную запись плюс её место. */
export interface CanvasNode {
  /** Ключ ноды «вид:номер»: сцена 41 и существо 41 — разные ноды. */
  key: string;
  node_type: "scene";
  node_id: number;
  x: number;
  y: number;
  /** false — позицию ещё ни разу не сохраняли, показана раскладка по умолчанию. */
  placed: boolean;
  scene: {
    id: number;
    name: string;
    kind: SceneKind;
    summary: string;
    arc_id: number | null;
    is_override: boolean;
    campaign_only: boolean;
    /** Сцена лежит на полке заготовок. */
    in_library: boolean;
    /** Вставка заготовки: id и имя источника, пока вставку не тронули. */
    library_scene_id: number | null;
    library_name: string | null;
    /** Сколько ссылок сцены ведёт в другой сеттинг. */
    foreign_links: number;
    /** Переходы, чей второй конец на другом холсте (блок G6.2). */
    outside?: OutsideLink[];
  };
}

/**
 * Ссылка сцены, ведущая за пределы её сеттинга: вставленная заготовка тащит
 * за собой существ и локации того мира, где её писали.
 */
export interface ForeignLink {
  to_type: string;
  to_id: number;
  type_label: string;
  name: string;
  setting_id: number | null;
  setting_name: string | null;
  /** Структурных связей и упоминаний в текстах — чинятся по-разному. */
  links: number;
  mentions: number;
  candidates: {
    id: number;
    name: string;
    tier: "exact" | "likely" | "doubtful";
    /** Чем поймалось: имя, оригинал, синоним. */
    via: string;
  }[];
}

/** Строка состава сцены: кто участвует и сколько их. */
export interface SceneCastRow {
  link_id: number;
  section: string;
  role: "location" | "plot_characters" | "obstacles" | "loot";
  to_type: string;
  to_id: number;
  name: string;
  /** «4», «1к6», «2к4+1». Пусто — значит один. */
  qty: string;
}

/** Строка полки наборов. */
export interface LibraryBundle {
  id: number;
  name: string;
  content_type: string | null;
  setting_id: number | null;
  setting_name: string | null;
  members: number;
  foreign: boolean;
}

/** Строка полки заготовок. */
export interface LibraryScene {
  id: number;
  name: string;
  kind: SceneKind;
  summary: string;
  setting_id: number | null;
  setting_name: string | null;
  arc_id: number | null;
  arc_name: string | null;
  /** Сколько вставок этой заготовки сейчас стоит в приключениях. */
  insertions: number;
  /** Заготовка написана в другом сеттинге, чем открытый на холсте. */
  foreign: boolean;
}

/**
 * Ребро холста. Два вида: `transition` — переход между сценами, `outcome` —
 * исход проверки, ведущий в другую сцену. id строковый, вида
 * `вид:строка:нода-начало` — нумерация у видов своя, а одна заготовка может
 * стоять в приключении дважды, и тогда её переход даёт два разных ребра.
 */
export interface CanvasEdge {
  id: string;
  /**
   * transition — переход между сценами, outcome — исход проверки,
   * cast — сущность втекает в сцену, member — член набора, thread — нить между пинами.
   */
  kind: "transition" | "outcome" | "cast" | "member" | "thread";
  /** Ключи нод, а не номера: на холсте рядом со сценами стоят сущности. */
  source: string;
  target: string;
  /** В какой разъём воткнуто: story | location | participants | items | members. */
  target_handle: string;
  label: string;
  width?: number;
  color?: string;
}

/** Нода сущности на холсте — существо, локация, предмет, запись компендиума,
 *  персонаж игрока. */
export interface CanvasEntityNode {
  key: string;
  node_type:
    | "being"
    | "location"
    | "artifact"
    | "community"
    | "compendium_entry"
    | "character";
  node_id: number;
  x: number;
  y: number;
  placed: boolean;
  entity: {
    id: number;
    name: string;
    kind: string | null;
    thumbnail_image_url: string | null;
    /** Сколько сцен упоминает её в текстах, не подцепляя. */
    mentioned_in: number;
  };
}

/** Нода события хроники или расписания. */
export interface CanvasEventNode {
  key: string;
  node_type: "setting_event" | "campaign_event";
  node_id: number;
  x: number;
  y: number;
  placed: boolean;
  event: {
    id: number;
    title: string;
    year: number;
    month: number;
    day: number;
    precision: DatePrecision;
    status: EventStatus;
    important: boolean;
  };
}

/** Нода набора: имя, вид содержимого и перечисление членов. */
export interface CanvasBundleNode {
  key: string;
  node_type: "bundle";
  node_id: number;
  x: number;
  y: number;
  placed: boolean;
  bundle: {
    id: number;
    name: string;
    content_type: string | null;
    in_library: boolean;
    library_bundle_id: number | null;
    members: { link_id: number; to_type: string; to_id: number; qty: string; name: string }[];
  };
}

/** Нода приключения на холсте сеттинга (Q2). */
export interface CanvasAdventureNode {
  key: string;
  node_type: "adventure";
  node_id: number;
  x: number;
  y: number;
  placed: boolean;
  adventure: {
    id: number;
    name: string;
    setting_id: number;
    chapter_count: number;
    scene_count: number;
    /** Только на карте кампании (блок D4). */
    progress?: "done" | "active" | "untouched";
    /** Приключение переписано под эту кампанию. */
    is_override?: boolean;
    /** Оригинал в сеттинге правили после того, как кампания сняла копию. */
    setting_changed_at?: string | null;
    /** Добавлено в кампанию после того, как карту разложили. */
    is_new?: boolean;
  };
}

/**
 * Узел главы на холсте приключения (блок G6.2).
 *
 * До этого блока глава была рамкой, обнимавшей свои сцены. Рамок стало много,
 * а вместе с ними на холст приезжали 184 сцены из 201 — и держались видимыми
 * только свёрткой. Теперь глава — такой же контейнер, как приключение: в неё
 * входят, и её сцены лежат на её собственном холсте.
 */
export interface CanvasChapterNode {
  key: string;
  node_type: "chapter";
  node_id: number;
  x: number;
  y: number;
  placed: boolean;
  chapter: {
    id: number;
    name: string;
    /** Приключение, которому глава принадлежит, — ради адреса «Войти». */
    arc_id: number;
    setting_id: number;
    scene_count: number;
  };
}

/** Стикер — свободная заметка, 6 пастелей §5 */
export interface CanvasStickerNode {
  key: string;
  node_type: "sticker";
  node_id: number;
  x: number;
  y: number;
  placed: boolean;
  sticker: { id: number; text: string; name: string; note: string; color: string };
}

/** Изображение на полотне — png/webp/gif */
export interface CanvasImageNode {
  key: string;
  node_type: "image";
  node_id: number;
  x: number;
  y: number;
  placed: boolean;
  image: { id: number; file_url: string; w: number; h: number };
}

/** Рамка-группа на фриформ-доске */
export interface CanvasFrameNode {
  key: string;
  node_type: "frame";
  node_id: number;
  x: number;
  y: number;
  placed: boolean;
  frame: {
    id: number;
    name: string;
    color: string;
    w: number;
    h: number;
    /** Свёрнута ли рамка (блок G6.3). Механизм переехал сюда с главы, когда
     *  та стала узлом-контейнером. Хранимые `w/h` относятся к развёрнутому
     *  виду и свёртку переживают нетронутыми. */
    collapsed?: boolean;
  };
}
export interface CanvasPinNode {
  key: string;
  node_type: "pin";
  node_id: number;
  x: number;
  y: number;
  z_index?: number;
  placed: boolean;
  pin: { id: number; name: string; color: string; shape: string; size: string; z_index: number };
}
export interface CanvasSoundSetNode {
  key: string;
  node_type: "sound_set";
  node_id: number;
  x: number;
  y: number;
  placed: boolean;
  sound_set: { id: number; name: string; battle_playlist_id: number | null };
}
export interface CanvasPlaylistNode {
  key: string;
  node_type: "playlist";
  node_id: number;
  x: number;
  y: number;
  placed: boolean;
  playlist: { id: number; name: string };
}

/** Нода проверки сцены — справа от сцены, исходы — хендлы с чип-рамкой (Q2, Q7). */
export interface CanvasCheckNode {
  key: string;
  node_type: "check";
  node_id: number;
  x: number;
  y: number;
  placed: boolean;
  check: {
    id: number;
    scene_id: number;
    what: string;
    difficulty: string;
    outcomes: { id: number; label: string; consequence: string; target_type: string | null; target_id: number | null }[];
  };
}

export type CanvasAnyNode = CanvasNode | CanvasEntityNode | CanvasBundleNode | CanvasEventNode | CanvasCheckNode | CanvasAdventureNode | CanvasChapterNode | CanvasStickerNode | CanvasImageNode | CanvasFrameNode | CanvasPinNode | CanvasSoundSetNode | CanvasPlaylistNode | CanvasRouteNode;

/**
 * Рераут-нода («Маршрут»): визуальный проход-развязка, который рвёт длинное
 * реальное ребро (переход/каст/исход/нить) на два сегмента вокруг себя.
 * Сам данных не заводит — реальное ребро остаётся одно, а `route` здесь лишь
 * память прохода: каких двух соседей рераут разводит и ребро какого вида несёт.
 * Роль/цвет гнезда перенимаются от ребра (`kind`/`role`), поэтому конфликт
 * ролей на ноде невозможен по построению: одно ребро — одна роль.
 */
export interface CanvasRouteNode {
  key: string;
  node_type: "route";
  node_id: number;
  x: number;
  y: number;
  z_index?: number;
  placed: boolean;
  route: {
    id: number;
    from_key: string;
    to_key: string;
    kind: string;
    role: string;
    /** Имя входа (носителя) — для тела рераута «A → B» (cast/исход/нить). */
    from_name?: string;
    to_name?: string;
    /** Выходы хаба: сцены, куда передаётся носитель. */
    outputs?: { to_key: string; role: string; to_name?: string }[];
    /** У перехода — реальная строка `story_scene_transitions` между соседями:
     *  её id и label и есть «Условие перехода», которое правят в панели. */
    transition_id?: number | null;
    transition_label?: string;
  };
}

/** Строка памяти прохода из `canvas_routes` + выходы — без раскладки. */
export interface CanvasRoute {
  id: number;
  from_key: string;
  to_key: string;
  kind: string;
  role: string;
  /** Выходы хаба: сцены, куда передаётся носитель. */
  outputs?: { to_key: string; role: string }[];
}

/**
 * Рамка главы на холсте приключения — ОТМЕНЕНА блоком G6.2.
 *
 * Глава стала узлом-контейнером (`CanvasChapterNode`), и `groups` в ответе
 * доски теперь всегда пуст. Тип оставлен, пока с ним не разошлись все места
 * чтения; заводить по нему новое не нужно.
 */
export interface CanvasGroup {
  arc_id: number;
  name: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Свёрнута ли глава. Хранится в базе рядом с раскладкой, а не в
   *  localStorage: иначе на другой машине раскладка приехала бы, а свёртка
   *  нет. Свежая глава приходит свёрнутой. */
  collapsed?: boolean;
}

/** Нить между двумя пинами на свободной доске. */
export interface CanvasThread {
  id: number;
  from_pin_id: number;
  to_pin_id: number;
  width: number;
  color: string;
}

/**
 * Нода в составе доски: сама нода плюс то, что о её месте знает доска, а не
 * сущность. Отдельным именем — чтобы это можно было назвать в сигнатуре
 * функции, а не описывать пересечением на каждом вызове.
 */
export type CanvasBoardNode = CanvasAnyNode & {
  z_index?: number;
  /** Рамка, на которую ноду бросили: `chapter:26` или `frame:4`. Только у
   *  тех, у кого своей главы нет — сущность, стикер, картинка, пин. У сцены
   *  и проверки родитель выводится из данных (`scene.arc_id`). */
  parent_key?: string | null;
};

/**
 * Тихая подсказка на ноде сцены (блок G1): «нет места», «упомянут, но не в
 * составе», «развилка никуда не ведёт», «у исхода проверки нет цели».
 *
 * Приходит отдельным запросом после доски, а не в её составе: поиск упоминаний
 * стоит 142 мс против 54–91 мс на всю загрузку холста.
 */
export interface SceneHint {
  kind: "no_place" | "branch_dead_end" | "outcome_no_target" | "mentioned_not_cast";
  text: string;
  /** Только у `mentioned_not_cast` — то, что можно заглушить «это не оно». */
  entity_type?: string;
  entity_id?: number;
}

/**
 * Что заглушено — для меню «Заглушённые подсказки» (находки Н13, Н14).
 * Пустой ответ означает, что пункта меню нет вовсе.
 */
export interface DismissedHints {
  /** Заглушено на весь сеттинг: имя не подсказывается нигде. */
  setting: { entity_type: string; entity_id: number; name: string }[];
  /** Точечно, «это не оно здесь». */
  scenes: { scene_id: number; scene_name: string; entity_type: string; entity_id: number; name: string }[];
}

export interface SceneHintsResponse {
  scenes: { scene_id: number; hints: SceneHint[] }[];
  /** Сколько подсказок внутри каждой главы приключения (блок G6.2, Q22).
   *  Приходит по запросу `chapters_of=<приключение>`: сцены главы на холст
   *  не приезжают, а «что я забыл» с ними уезжать не должно. */
  chapters?: { arc_id: number; count: number }[];
}

export interface CanvasBoard {
  /** null у схемы сеттинга, которую ещё ни разу не сохраняли: строка доски
   *  заводится первым сохранением раскладки, а не чтением (блок D3). */
  board_id: number | null;
  /** `parent` есть только у холста главы: это её приключение, ступень крошек
   *  и адрес выхода наверх (блок G6.2). */
  arc?: { id: number; name: string; setting_id: number; parent?: { id: number; name: string } | null };
  free?: { id: number; name: string };
  /** Схема сеттинга — приключения узлами, связи рёбрами (блок D3). */
  setting?: { id: number; name: string };
  /** Карта кампании — её приключения, покрашенные прохождением (блок D4). */
  campaign_map?: {
    id: number;
    name: string;
    setting_id: number | null;
    /** Кампания ведёт свой набор связей, а не смотрит на заготовку сеттинга. */
    own_transitions: boolean;
  };
  campaign_id: number | null;
  /** Кампания, через которую вошли на холст приключения (Q26, блок E1):
   *  своей доски у неё здесь нет — это путь входа, и в крошках он назван по
   *  имени, а не номером из адреса. */
  campaign?: { id: number; name: string } | null;
  nodes: CanvasBoardNode[];
  groups: CanvasGroup[];
  edges: CanvasEdge[];
  threads?: CanvasThread[];
  /** Память прохода рераут-нод. Приходит вместе с доской, но в стороне от
   *  раскладки: это данные, а не место. */
  routes?: CanvasRoute[];
}


// --------------------------------------------------------- пульт сессии

export interface StageScene {
  id: number;
  name: string;
  kind: string | null;
  arc_id: number | null;
  arc_name: string | null;
}

/** Сцена из заготовки вечера: та же сцена плюс отметка «уже играли». */
export type PlannedScene = StageScene & { played: boolean };

export interface SessionStage {
  /** Заготовка вечера — её собирают в подготовке, а не здесь. */
  planned: PlannedScene[];
  current: StageScene | null;
  exits: { scene: StageScene; label: string }[];
  sound: { id: number; name: string } | null;
  journal: { id: number; scene_id: number; name: string }[];
}

// ------------------------------------------- дерево приключений и глав

export interface TreeScene {
  id: number;
  name: string;
  kind: string | null;
  /** Сколько сущностей в составе — видно, размечена ли сцена вообще. */
  cast: number;
}

/** `id: null` — собственные сцены приключения, у которых главы нет. */
export interface TreeChapter {
  id: number | null;
  name: string;
  scenes: TreeScene[];
}

export interface TreeAdventure {
  id: number;
  name: string;
  chapters: TreeChapter[];
}

/** Строка экстренного поиска сцен на пульте. */
export interface SceneSearchRow {
  id: number;
  name: string;
  in_library: number;
  arc_name: string;
  chapter_name: string;
}

/** Итог вечера — GET /sessions/:id/summary. */
export interface SessionReport {
  held: boolean;
  planned: number;
  played: number;
  revealed: { id: number; title: string }[];
  settingId: number | null;
  from: { year: number; month: number | null; day: number | null } | null;
  to: { year: number; month: number | null; day: number | null } | null;
}

export interface LaunchResult {
  scene: StageScene;
  soundSetId: number | null;
  soundSetName: string | null;
  added: number;
  removed: number;
}

/**
 * Строка объединения: кого сцены сессии обещают в этой панели. Приезжает с
 * GET /sessions/:id/cast-union и живёт рядом со связями, а не вместо них.
 */
export interface SessionUnionRow {
  panel: string;
  to_type: string;
  to_id: number;
  name: string;
  qty: string;
  /** В сцене, запущенной прямо сейчас. */
  inScene: boolean;
  /** В каких сценах вечера встречается — подсказкой на строке. */
  scenes: string[];
}

/** Карточка предпросмотра сцены на пульте — GET /sessions/:id/preview/:sceneId. */
/**
 * Режим репетиции на холсте приключения (блок G3): тихий прогон истории
 * глазами. Карточка — та же `ScenePreview`, что у пульта; своего здесь два
 * поля, которых пульту не нужно.
 */
export interface RehearsalExit {
  scene: StageScene;
  label: string;
  /** Цель в другом приключении: видна и кликабельна, но шагом не является. */
  outside: boolean;
  /** Имя того приключения — заполнено только у `outside`. */
  adventure_name: string;
}

export interface RehearsalStep {
  preview: ScenePreview;
  exits: RehearsalExit[];
  /** Куда идти, когда стрелок нет вовсе: порядок держится на `position`. */
  next_in_order: StageScene | null;
  adventure_id: number | null;
}

export interface ScenePreview {
  scene: StageScene;
  readAloud: string;
  summary: string;
  entryCondition: string;
  cast: { role: string; name: string; qty: string }[];
  checks: { what: string; dc: string; outcomes: string[] }[];
  sound: { id: number; name: string } | null;
  exits: { scene: StageScene; label: string }[];
}
