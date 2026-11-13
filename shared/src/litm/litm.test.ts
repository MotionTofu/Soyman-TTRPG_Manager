import { describe, expect, it } from "vitest";
import { consequenceAdjustment, consequenceTier } from "./consequence";
import { BOOK_POLAR_LIMITS, updateRibbonLimit } from "./compound";
import {
  formatStatus,
  giveOppositeStatus,
  giveStatus,
  heroCondition,
  normalizeStatuses,
  parseStatusTag,
  reduceMarks,
  reduceStatus,
  spendStatusDefense,
  stackMarks,
  statusTier,
} from "./status";

describe("Могущество источника Последствий", () => {
  it("сравнивает ступени источника с Героем и ограничивает итог Эффекта", () => {
    expect(consequenceAdjustment("greatness", "origin")).toEqual({ tiers: 6, tags: 3 });
    expect(consequenceAdjustment("adventure", "origin")).toEqual({ tiers: 3, tags: 1 });
    expect(consequenceAdjustment("origin", "adventure")).toEqual({ tiers: -3, tags: -1 });
    expect(consequenceAdjustment("origin", "greatness")).toEqual({ tiers: -6, tags: -3 });
    expect(consequenceAdjustment("origin", "origin")).toEqual({ tiers: 0, tags: 0 });
    expect(consequenceAdjustment("greatness", "")).toEqual({ tiers: 0, tags: 0 });
    expect(consequenceAdjustment("adventure", "origin", true)).toEqual({ tiers: 2, tags: 1 });
    expect(consequenceTier(3, 6, 6)).toBe(6);
    expect(consequenceTier(2, -3, 6)).toBe(0);
    expect(consequenceTier(1, 3)).toBe(4);
  });

  it("тратит уровни только на выбранную защиту и сохраняет остальные отметки", () => {
    const statuses = [{ name: "защищён", marks: [1, 3] }, { name: "настороже", marks: [2] }];
    expect(spendStatusDefense(statuses, 1, "защищен")).toEqual({
      statuses: [{ name: "защищён", marks: [2] }, statuses[1]], spent: 1, remaining: 0,
    });
    expect(spendStatusDefense(statuses, 4, "защищён")).toEqual({ statuses: [statuses[1]], spent: 3, remaining: 1 });
  });
});

it("переносит все отметки двустороннего Предела только на известную или выбранную сторону", () => {
  const definition = BOOK_POLAR_LIMITS.Kraken;
  const profile = challengeStateFromProfile({ limitList: [{ ...definition, max: "5", arrow: true }] }).limits[0];
  const saved = { ...profile, sides: undefined, status: definition.name, marks: [2, 5], defense: "течение" };
  expect(updateRibbonLimit(saved, profile)).toBeNull();
  expect(updateRibbonLimit(saved, profile, "сбежать")).toMatchObject({ status: "сбежать", marks: [2, 5], defense: "течение" });
  expect(updateRibbonLimit({ ...saved, status: "проглочен" }, profile)).toMatchObject({ status: "проглотить", marks: [2, 5] });
  expect(updateRibbonLimit({ ...saved, status: "", marks: [] }, profile)).toMatchObject({ status: "", marks: [], sides: definition.sides });
});
import {
  campDo,
  campPeriod,
  campStep,
  challengeStateFromProfile,
  giveToLimit,
  journeyArrived,
  limitOutcome,
  overcomeBy,
  parseChallengeState,
  parseSceneState,
  passSpotlight,
  passStep,
  reduceLimit,
  startCamp,
  turnedLimits,
  vignetteState,
  type LitmJourneyState,
  type LitmSpotlight,
} from "./conflict";

it("снимает защиту до зачёта в Предел и сохраняет назначение при перезагрузке", () => {
  const start = challengeStateFromProfile({ limitList: [{ name: "Сыт", max: "4" }], tagList: [{ text: "голоден-3" }] });
  const partial = giveToLimit(start, 0, "сыт", 2, "голоден");
  expect(partial.statuses).toEqual([{ name: "голоден", marks: [1] }]);
  expect(partial.limits[0].marks).toEqual([]);
  const saved = parseChallengeState(JSON.stringify(partial));
  const equal = giveToLimit(saved, 0, "сыт", 1);
  expect(equal.statuses).toEqual([]);
  expect(equal.limits[0].marks).toEqual([]);
  const overflow = giveToLimit(saved, 0, "сыт", 3);
  expect(overflow.statuses).toEqual([]);
  expect(overflow.limits[0]).toMatchObject({ status: "сыт", marks: [2], defense: "голоден" });
  expect(overcomeBy(giveToLimit(overflow, 0, "сыт", 4))?.name).toBe("Сыт");
  expect(giveToLimit(saved, 0, "сыт", 2, null).statuses).toEqual(saved.statuses);
});

describe("статусы LitM — примеры книги (A167–A168)", () => {
  it("противоположный статус оставляет разницу уровней у сильнейшей стороны", () => {
    const prior = [{ name: "враждебен", marks: [2, 3] }];
    expect(giveOppositeStatus(prior, "дружелюбен", 2, "враждебен")).toEqual([{ name: "враждебен", marks: [1] }]);
    expect(giveOppositeStatus(prior, "дружелюбен", 3, "враждебен")).toEqual([]);
    expect(giveOppositeStatus(prior, "дружелюбен", 4, "враждебен")).toEqual([{ name: "дружелюбен", marks: [1] }]);
  });
  it("складывает: отвлечён-2 + отвлечён-4 = 4, отвлечён-2 + отвлечён-2 = 3", () => {
    expect(stackMarks([2], 4)).toEqual([2, 4]);
    expect(statusTier(stackMarks([2], 4))).toBe(4);
    expect(stackMarks([2], 2)).toEqual([2, 3]);
    expect(statusTier(stackMarks([2], 2))).toBe(3);
  });

  it("занятая клетка → следующая свободная справа, сверх шестой не растёт", () => {
    expect(stackMarks([1, 2, 3], 1)).toEqual([1, 2, 3, 4]);
    expect(stackMarks([1, 2, 3, 4, 5, 6], 2)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(stackMarks([6], 6)).toEqual([6]);
  });

  it("ослабляет сдвигом влево: благословлён-4 − 3 = 1; ниже 1 — снят", () => {
    expect(reduceMarks([4], 3)).toEqual([1]);
    expect(reduceMarks([1, 3], 1)).toEqual([2]);
    expect(reduceStatus([{ name: "ранен", marks: [2] }], "Ранен", 2)).toEqual([]);
  });

  it("одинаковое имя складывается само, «Сложить с» — в чужую карточку", () => {
    let list = giveStatus([], "ранен", 2);
    list = giveStatus(list, "Ранен ", 2);
    expect(list).toEqual([{ name: "ранен", marks: [2, 3] }]);
    list = giveStatus(list, "истекает кровью", 1, "ранен");
    expect(list.map(formatStatus)).toEqual(["ранен-3"]);
    list = giveStatus(list, "напуган", 1);
    expect(list.map(formatStatus)).toEqual(["ранен-3", "напуган-1"]);
  });

  it("читает разметку: имя с дефисами, уровень — последнее число", () => {
    expect(parseStatusTag("*настороже-1*")).toEqual({ name: "настороже", tier: 1 });
    expect(parseStatusTag("*застигнут-врасплох-3*")).toEqual({ name: "застигнут-врасплох", tier: 3 });
    expect(parseStatusTag("*плащ и кинжал*")).toBeNull();
    expect(parseStatusTag("*охраняет-территорию-2*, *кочевник-2*")).toBeNull();
  });

  it("герой: 5 — повержен, 6 — необратимо", () => {
    const list = [{ name: "ранен", marks: [2, 4, 5] }, { name: "отравлен", marks: [3] }];
    expect(heroCondition(list).overcome?.name).toBe("ранен");
    expect(heroCondition(list).beyond).toBeNull();
    expect(heroCondition([{ name: "проклят", marks: [6] }]).beyond?.name).toBe("проклят");
  });

  it("битые статусы из листа выбрасываются", () => {
    expect(normalizeStatuses([{ name: "ранен", marks: [3, 1, 3, 9] }, { name: "", marks: [1] }, null, { name: "х", marks: [] }]))
      .toEqual([{ name: "ранен", marks: [1, 3] }]);
  });
});

describe("строка вызова", () => {
  const catspaw = {
    limitList: [{ name: "Ранить", max: "3" }, { name: "Поймать или сбежать", max: "5" }, { name: "Убедить", max: "-" }],
    tagList: [{ text: "*плащ и кинжал*" }, { text: "*идеальная-позиция-2*" }],
  };

  it("собирается из профиля: пределы, «—», стартовые статусы из тегов (Q6)", () => {
    const s = challengeStateFromProfile(catspaw);
    expect(s.limits.map((l) => l.max)).toEqual([3, 5, null]);
    expect(s.statuses).toEqual([{ name: "идеальная-позиция", marks: [2] }]);
    expect(s.declaredThreat).toBeNull();
  });

  it("предел достигнут — преодолён; «—» статус не принимает", () => {
    let s = challengeStateFromProfile(catspaw);
    s = giveToLimit(s, 0, "ранен", 2);
    expect(overcomeBy(s)).toBeNull();
    s = giveToLimit(s, 0, "ранен", 2);
    expect(s.limits[0]).toMatchObject({ status: "ранен", marks: [2, 3] });
    expect(overcomeBy(s)?.name).toBe("Ранить");
    expect(giveToLimit(s, 2, "убеждён", 4)).toBe(s);
  });

  it("предел ↻ меняет вызов, а не убирает (Q9)", () => {
    let s = challengeStateFromProfile({ limitList: [{ name: "Задетая честь", max: "3", arrow: true, note: "Вызывает на дуэль" }] });
    s = giveToLimit(s, 0, "задета-честь", 3);
    expect(overcomeBy(s)).toBeNull();
    expect(turnedLimits(s).map((l) => l.name)).toEqual(["Задетая честь"]);
  });

  it("двусторонний предел гасит уровни и показывает исход достигшей стороны после загрузки", () => {
    const sides = [{ status: "замысел", outcome: "План исполнен" }, { status: "срыв", outcome: "План сорван" }];
    const empty = challengeStateFromProfile({ limitList: [{ name: "Исполнить / сорвать замысел", max: "4", arrow: true, sides }] });
    const started = giveToLimit(empty, 0, "замысел", 3);
    expect(giveToLimit(started, 0, "срыв", 3).limits[0]).toMatchObject({ status: "", marks: [] });
    const flipped = giveToLimit(started, 0, "срыв", 5);
    expect(flipped.limits[0]).toMatchObject({ status: "срыв", marks: [2] });
    const reloaded = parseChallengeState(JSON.stringify(giveToLimit(flipped, 0, "срыв", 4)));
    expect(turnedLimits(reloaded).map(limitOutcome)).toEqual(["План сорван"]);
    expect(turnedLimits(giveToLimit(empty, 0, "замысел", 4)).map(limitOutcome)).toEqual(["План исполнен"]);
    expect(giveToLimit(empty, 0, "ранен", 4)).toBe(empty);
  });

  it("«снять 1 уровень с *убежать*» ослабляет предел", () => {
    let s = challengeStateFromProfile({ limitList: [{ name: "Убежать", max: "3" }] });
    s = giveToLimit(s, 0, "отстал", 2);
    s = reduceLimit(s, 0, 1);
    expect(s.limits[0].marks).toEqual([1]);
    s = reduceLimit(s, 0, 1);
    expect(s.limits[0]).toMatchObject({ marks: [], status: "" });
  });

  it("переживает сохранение в колонку state", () => {
    const s = giveToLimit(challengeStateFromProfile(catspaw), 1, "схвачен", 1);
    expect(parseChallengeState(JSON.stringify(s))).toEqual(s);
    expect(parseChallengeState("не json").limits).toEqual([]);
  });
});

describe("спотлайт", () => {
  const order = [1, 2, 3, 4];

  it("передаётся следующему несходившему и считается", () => {
    let sp = passSpotlight({ current: null, acted: [], counts: {} }, order);
    expect(sp.current).toBe(1);
    sp = passSpotlight(sp, order);
    expect(sp).toEqual({ current: 2, acted: [1], counts: { 1: 1, 2: 1 } });
  });

  it("повергнутого пропускает; сходили все — круг заново", () => {
    let sp: LitmSpotlight = { current: 2, acted: [1], counts: {} };
    sp = passSpotlight(sp, order, [3]);
    expect(sp.current).toBe(4);
    sp = passSpotlight(sp, order, [3]);
    expect(sp).toMatchObject({ current: 1, acted: [] });
  });

  it("Мастер даёт спотлайт любому — тот перестаёт быть сходившим", () => {
    const sp = passSpotlight({ current: 2, acted: [1], counts: { 1: 3 } }, order, [], 1);
    expect(sp).toEqual({ current: 1, acted: [2], counts: { 1: 4 } });
  });

  it("сцена из пустого state — пустая", () => {
    expect(parseSceneState("")).toEqual({ tags: [], statuses: [], progress: [], spotlight: { current: null, acted: [], counts: {} }, sceneId: null, journey: null, camp: null });
  });
});

describe("путешествие", () => {
  const forest: LitmJourneyState = { entryId: 17130, name: "Тёмный лес", kind: "Местность", tags: ["тени повсюду"], consequences: [], steps: 2, gap: "часы", passed: [] };

  it("шаги засчитываются до «Прибыли», дальше не растут", () => {
    let j = passStep(forest, "Мшистая поляна", "consequences");
    expect(journeyArrived(j)).toBe(false);
    j = passStep(j, "Замёрзший ручей", "overcome");
    expect(journeyArrived(j)).toBe(true);
    expect(passStep(j, "лишний", "skip").passed).toHaveLength(2);
  });

  it("без выбранного числа шагов не прибывает", () => {
    expect(journeyArrived(passStep({ ...forest, steps: 0 }, "Мшистая поляна", "overcome"))).toBe(false);
  });

  it("виньетка и путешествие переживают сохранение в колонку state", () => {
    const v = vignetteState({ name: "Замёрзший ручей", nameEn: "Frozen Stream", threat: "*скользкий лёд*", consequences: ["Мёрзнете (*замёрз-2*)."], blocksPath: true, journeyId: 17130 });
    expect(parseChallengeState(JSON.stringify(v))).toEqual(v);
    const j = passStep(forest, "Мшистая поляна", "overcome");
    expect(parseSceneState(JSON.stringify({ journey: j })).journey).toEqual(j);
    expect(parseSceneState(JSON.stringify({ journey: { name: "без записи" } })).journey).toBeNull();
  });
});

describe("привал (A180)", () => {
  it("Отдых и Размышление — по разу за привал, Действие — сколько угодно", () => {
    let c = campStep(startCamp(), 3);
    expect(campPeriod(c)).toBe(true);
    c = campDo(campDo(c, 7, "rest"), 8, "action");
    expect(c.done).toEqual([7, 8]);
    c = campStep(c, 4);
    expect(c.done).toEqual([]);
    c = campDo(campDo(c, 7, "reflect"), 8, "action");
    expect(c.used).toEqual({ 7: ["rest", "reflect"] });
    expect(campPeriod(campStep(c, 6))).toBe(false);
  });

  it("шаг не выходит за 1–7 и переживает сохранение в колонку state", () => {
    expect(campStep(startCamp(), 9).step).toBe(7);
    const c = campDo(campStep(startCamp(true), 3), 7, "rest");
    expect(parseSceneState(JSON.stringify({ camp: c })).camp).toEqual(c);
    expect(parseSceneState(JSON.stringify({ camp: { step: 0, used: { x: ["rest"], 5: ["sleep", "reflect"] } } })).camp).toEqual({ sojourn: false, step: 1, used: { 5: ["reflect"] }, done: [] });
  });
});
