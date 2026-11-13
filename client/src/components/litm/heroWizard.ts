/**
 * Визард героя LitM (гриллинг 2026-11-13, Q1–Q18; доски Litm-Wiz-*): путь
 * книги задаёт шаги и то, как открывается каждая тема; тему можно сделать
 * иначе — набором, анкетой или вручную (Q14). Здесь — состояние и правила,
 * без React: шаги, готовность, сборка листа, проверки обзора.
 */
import type { LitMCharacterData, LitMPower, LitMThemeCard } from "../../types";
import { findKit, tropeKitRef, type LitmThemeBook, type LitmThemeKit, type LitmTrope } from "./litmCompendium";

export type HeroPath = "simple" | "quick" | "detail";
export type ThemeMode = "kit" | "questions" | "manual";
export type StepId = "path" | "trope" | "types" | "theme0" | "theme1" | "theme2" | "theme3" | "backpack" | "relations" | "dossier" | "review";

/** Тема в работе. `type` — анкета темы по книге (enName: «Personality»), у наборов путей — «Magic». */
export interface ThemeDraft {
  mode: ThemeMode;
  type: string;
  kitId: number | null;
  /** Теги силы: из набора и свои (набор, вручную). */
  power: string[];
  weak: string[];
  /** Ответы анкеты по номеру вопроса. */
  answers: Record<number, string>;
  weakAnswers: Record<number, string>;
  /** Тег-название вручную. */
  title: string;
  quest: string;
}

export interface HeroDraft {
  path: HeroPath | null;
  tropeId: number | null;
  chooseIdx: number | null;
  themes: ThemeDraft[];
  backpack: string;
  relations: Record<number, string>;
  name: string;
  player: string;
  promise: string;
}

export interface WizardBook {
  tropes: LitmTrope[];
  books: LitmThemeBook[];
  kits: LitmThemeKit[];
}

export const POWER_NEED: Record<ThemeMode, number> = { kit: 2, questions: 3, manual: 2 };
export const WEAK_NEED = 1;
const THEMES: StepId[] = ["theme0", "theme1", "theme2", "theme3"];
const TAIL: StepId[] = ["backpack", "relations", "dossier", "review"];

export function emptyThemeDraft(mode: ThemeMode, type = ""): ThemeDraft {
  return { mode, type, kitId: null, power: [], weak: [], answers: {}, weakAnswers: {}, title: "", quest: "" };
}

export function emptyHero(name = "", player = ""): HeroDraft {
  return { path: null, tropeId: null, chooseIdx: null, themes: [0, 1, 2, 3].map(() => emptyThemeDraft("manual")), backpack: "", relations: {}, name, player, promise: "" };
}

const MODE: Record<HeroPath, ThemeMode> = { simple: "manual", quick: "kit", detail: "questions" };

/** Шаги пути (Q15–Q17); до выбора пути — шаги Быстрого как заготовка. */
export function stepsFor(path: HeroPath | null): StepId[] {
  const p = path ?? "quick";
  return ["path", ...(p === "quick" ? (["trope"] as StepId[]) : p === "detail" ? (["types"] as StepId[]) : []), ...THEMES, ...TAIL];
}

export function stepLabel(s: StepId): string {
  if (s.startsWith("theme")) return `Тема ${Number(s.slice(5)) + 1}`;
  return { path: "Путь", trope: "Троп", types: "Типы тем", backpack: "Рюкзак", relations: "Отношения", dossier: "Досье", review: "Обзор" }[s as "path"];
}

/** Смена пути: темы открываются в режиме пути, набранное в темах того же режима остаётся. */
export function setPath(d: HeroDraft, path: HeroPath): HeroDraft {
  if (d.path === path) return d;
  const mode = MODE[path];
  return { ...d, path, themes: d.themes.map((t) => (t.mode === mode ? t : emptyThemeDraft(mode, mode === "kit" ? "" : t.type))) };
}

/** Троп (Быстрый путь): три темы и выбранная четвёртая — наборами тропа. Набранное в той же теме-наборе остаётся. */
export function applyTrope(d: HeroDraft, trope: LitmTrope, chooseIdx: number | null, kits: LitmThemeKit[]): HeroDraft {
  const types = [...trope.data.themes_fixed, ...(chooseIdx === null ? [] : [trope.data.themes_choose_one[chooseIdx]])];
  const themes = d.themes.map((old, i) => {
    const en = types[i];
    if (!en) return emptyThemeDraft("kit");
    const kit = findKit(kits, en, tropeKitRef(trope, en));
    if (old.mode === "kit" && kit && old.kitId === kit.id) return old;
    return { ...emptyThemeDraft("kit", kit?.bookEn ?? en), kitId: kit?.id ?? null, quest: kit?.data.quest ?? "" };
  });
  return { ...d, tropeId: trope.id, chooseIdx, themes, backpack: d.tropeId === trope.id ? d.backpack : "" };
}

/** Тип темы (Подробный путь или «вручную»): ответы анкеты другого типа не переносятся. */
export function setThemeType(t: ThemeDraft, type: string): ThemeDraft {
  if (t.type === type) return t;
  return t.mode === "questions" ? { ...emptyThemeDraft("questions", type), quest: t.quest } : { ...t, type };
}

/** «Сделать эту тему иначе» (Q14): режим меняется, тип темы остаётся. */
export function setThemeMode(t: ThemeDraft, mode: ThemeMode): ThemeDraft {
  return t.mode === mode ? t : { ...emptyThemeDraft(mode, t.type), quest: t.quest };
}

export function chooseKit(t: ThemeDraft, kit: LitmThemeKit): ThemeDraft {
  return t.kitId === kit.id ? t : { ...emptyThemeDraft("kit", kit.bookEn), kitId: kit.id, quest: kit.data.quest ?? "" };
}

/** Переключить тег набора; лишний сверх нормы не выбирается (Q7). */
export function toggleTag(list: string[], tag: string, need: number): string[] {
  if (list.includes(tag)) return list.filter((x) => x !== tag);
  return list.length >= need ? list : [...list, tag];
}

const filled = (r: Record<number, string>) =>
  Object.keys(r)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => r[k].trim())
    .filter(Boolean);

export function themePower(t: ThemeDraft): string[] {
  return t.mode === "questions" ? filled(t.answers) : t.power.map((x) => x.trim()).filter(Boolean);
}

export function themeWeak(t: ThemeDraft): string[] {
  return t.mode === "questions" ? filled(t.weakAnswers) : t.weak.map((x) => x.trim()).filter(Boolean);
}

export function themeTitle(t: ThemeDraft, book: WizardBook): string {
  if (t.mode === "kit") return book.kits.find((k) => k.id === t.kitId)?.name ?? "";
  if (t.mode === "manual") return t.title.trim();
  return book.books.find((b) => b.enName === t.type)?.ruName ?? "";
}

/** Что мешает теме быть готовой; пусто — готова. Квест — не помеха, а предупреждение обзора. */
export function themeGaps(t: ThemeDraft, book: WizardBook): string[] {
  const gaps: string[] = [];
  if (t.mode === "kit" && t.kitId === null) gaps.push("выберите набор");
  if (t.mode !== "kit" && !t.type) gaps.push("выберите тип темы");
  if (t.mode === "manual" && !t.title.trim()) gaps.push("тег-название");
  if (t.mode === "questions" && !(t.answers[0] ?? "").trim()) gaps.push("ответ на первый вопрос");
  const p = themePower(t).length;
  const need = POWER_NEED[t.mode];
  if (p !== need) gaps.push(p > need ? `лишний тег силы (${p} из ${need})` : `теги силы ${p} из ${need}`);
  const w = themeWeak(t).length;
  if (w !== WEAK_NEED) gaps.push(w > WEAK_NEED ? "лишний тег слабости" : "тег слабости");
  if (t.mode === "kit" && t.kitId !== null && !book.kits.some((k) => k.id === t.kitId)) gaps.push("набор не найден в справочнике");
  return gaps;
}

export interface Check {
  ok: boolean;
  /** Нарушение правил книги закрывает «Создать»; иначе — предупреждение. */
  block: boolean;
  text: string;
  step: StepId | null;
}

export function stepReady(d: HeroDraft, s: StepId, book: WizardBook): boolean {
  if (s === "path") return d.path !== null;
  if (s === "trope") return d.tropeId !== null && d.chooseIdx !== null;
  if (s === "types") return d.themes.every((t) => !!t.type);
  if (s.startsWith("theme")) return themeGaps(d.themes[Number(s.slice(5))], book).length === 0;
  if (s === "backpack") return !!d.backpack.trim();
  if (s === "dossier") return !!d.name.trim();
  if (s === "review") return reviewChecks(d, book, []).every((c) => c.ok || !c.block);
  return true;
}

/** Проверки обзора: нарушение — блок, сомнительное — предупреждение со ссылкой на шаг. */
export function reviewChecks(d: HeroDraft, book: WizardBook, heroes: { id: number; name: string }[]): Check[] {
  const out: Check[] = [];
  const bad = d.themes.map((t, i) => ({ i, gaps: themeGaps(t, book) })).filter((x) => x.gaps.length);
  out.push(
    bad.length
      ? { ok: false, block: true, text: `Тема ${bad[0].i + 1}: ${bad[0].gaps.join(", ")}`, step: THEMES[bad[0].i] }
      : { ok: true, block: true, text: "Четыре темы: у каждой тег-название, теги силы и тег слабости", step: null }
  );
  out.push(d.backpack.trim() ? { ok: true, block: true, text: `Тег рюкзака: ${d.backpack.trim()}`, step: null } : { ok: false, block: true, text: "Нет тега рюкзака", step: "backpack" });
  if (!d.name.trim()) out.push({ ok: false, block: true, text: "Нет имени героя", step: "dossier" });
  d.themes.forEach((t, i) => {
    if (!t.quest.trim()) out.push({ ok: false, block: false, text: `Тема ${i + 1}${themeTitle(t, book) ? ` «${themeTitle(t, book)}»` : ""} — Квест пустой`, step: THEMES[i] });
  });
  const missing = heroes.filter((h) => !(d.relations[h.id] ?? "").trim());
  if (missing.length) out.push({ ok: false, block: false, text: `Отношения: не задан тег к ${missing.map((h) => h.name).join(", ")}`, step: "relations" });
  return out;
}

const POWERS = new Set(["origin", "adventure", "greatness", "variable"]);

/** Карта темы листа из черновика: имя — тег-название, особые улучшения — из анкеты типа. */
export function draftTheme(t: ThemeDraft, book: WizardBook): LitMThemeCard {
  const kit = t.mode === "kit" ? book.kits.find((k) => k.id === t.kitId) : undefined;
  const type = kit?.bookEn ?? t.type;
  const bk = book.books.find((b) => b.enName === type);
  const might = kit?.data.might || bk?.data.might || "";
  return {
    power: (POWERS.has(might) ? might : "") as LitMPower,
    themeType: type,
    name: themeTitle(t, book),
    powerTags: themePower(t),
    weaknessTags: themeWeak(t),
    quest: t.quest.trim(),
    improve: 0,
    abandon: 0,
    milestone: 0,
    specialImprovements: (bk?.data.improvements ?? []).map((i) => ({ text: `${i.name} — ${i.text}`, active: false })),
  };
}

/** Поля листа, которые пишет визард, — патчем поверх созданного листа (тема Содружества кампании остаётся). */
export function buildHero(d: HeroDraft, book: WizardBook, heroes: { id: number; name: string }[]): Partial<LitMCharacterData> {
  return {
    characterName: d.name.trim(),
    playerName: d.player.trim(),
    promise: d.promise.trim(),
    themes: d.themes.map((t) => draftTheme(t, book)),
    backpack: d.backpack.trim() ? [d.backpack.trim()] : [],
    relationships: heroes.filter((h) => (d.relations[h.id] ?? "").trim()).map((h) => ({ characterId: h.id, name: h.name, tag: d.relations[h.id].trim() })),
  };
}

/** «компромат на (выберите)» + «старосту Ольху» → «компромат на старосту Ольху». Без пометки — тег как есть. */
export function fillChoice(tag: string, fill: string): string {
  const f = fill.trim();
  return f ? tag.replace(/\((?:выберите|выбрать|choose)\)/i, f) : tag;
}

export const hasChoice = (tag: string) => /\((?:выберите|выбрать|choose)\)/i.test(tag);
