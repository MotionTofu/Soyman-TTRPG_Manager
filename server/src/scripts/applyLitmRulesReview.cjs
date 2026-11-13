// node server/src/scripts/applyLitmRulesReview.cjs <копия/app.db> <system_id>
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

const [, , filename, id] = process.argv;
if (!filename || !/^[1-9]\d*$/.test(id ?? "")) throw new Error("Укажите путь к копии базы и ID системы LitM");
const target = fs.realpathSync(filename);
if (target.toLowerCase() === path.resolve(__dirname, "../../data/app.db").toLowerCase()) {
  throw new Error("Для проверки используйте копию базы");
}
const db = new Database(target, { fileMustExist: true });
const system = db.prepare("SELECT code FROM systems WHERE id = ?").get(id);
if (system?.code !== "litm") throw new Error("Указанная система не является LitM");

const blocked = "Герой упускает шанс действовать, достичь цели или найти зацепку либо должен искать другой способ.";
const revelation = "Героя заметили, его действия привлекли внимание или раскрылась тайна.";
const accumulation = "Отвлечён-2 и ещё отвлечён-2 дают отметку в третьей клетке, итог — отвлечён-3.";
const separate = "Когда действие Героя порождает Последствия, Рассказчик может применить Последствия без Угрозы независимо от того, объявлялась ли Угроза.";
const sourceMight = "Сравните Могущество источника Последствий с Могуществом Героя в подходящем аспекте. При превосходстве источника на одну ступень усильте Эффекты на 3 уровня статуса или 1 тег, на две ступени — на 6 уровней или 3 тега. При превосходстве Героя ослабьте их на те же величины. При равных ступенях поправки нет. Поправка может свести Эффект к нулю. Уровень отдельного статуса ограничен шестью. Поправку к Силе действия не переносите в реакцию.";
const newNames = new Map([
  ["Заблокировано", "Возможность закрыта"],
  ["Разоблачение", "Обнаружение"],
  ["«Да, но…»", "Да, но…"],
  ["„Да, но…“", "Да, но…"],
]);

function rewriteLabels(text) {
  return text.replace(/\*\*([^*]+)\*\*/g, (whole, label) => {
    const name = newNames.get(label.replace(/:$/, ""));
    return name ? `**${name}${label.endsWith(":") ? ":" : ""}**` : whole;
  }).replace(/\((Заблокировано|Разоблачение)\)/g, (_, name) => `(${newNames.get(name)})`);
}

function rewriteRussian(value, change, key = "") {
  if (/En$|^en$|_en$|^name_original$/.test(key)) return value;
  if (typeof value === "string") return change(value);
  if (Array.isArray(value)) return value.map((part) => rewriteRussian(part, change));
  if (value && typeof value === "object") {
    for (const field of Object.keys(value)) value[field] = rewriteRussian(value[field], change, field);
  }
  return value;
}

function replaceLine(text, prefix, replacement) {
  return text.split("\n").map((line) => line.startsWith(prefix) ? replacement : line).join("\n");
}

function section(data, key) {
  const found = data.sections?.find((item) => item.headEn === key);
  if (!found) throw new Error(`Не найден раздел «${key}»`);
  return found;
}

function addParagraph(text, paragraph) {
  return text.includes(paragraph) ? text : `${text}\n\n${paragraph}`;
}

function rename(entry, name) {
  if (entry.name === name) return;
  entry.aliases = [...new Set([...entry.aliases, entry.name])];
  entry.name = name;
}

const statusNames = new Map([
  ["oblivious", ["рассеян", "не-замечает-происходящего"]],
  ["tight-lipped", ["молчалив", "держит-язык-за-зубами"]],
  ["fatigued", ["измотан", "утомлён"]],
  ["faction-respect", ["уважение-фракции", "уважение-со-стороны-фракции"]],
  ["hidden", ["спрятан", "скрыт"]],
  ["exposed", ["открыт", "на-виду"]],
]);

const replaceStatus = (text, before, after) => text.replaceAll(`*${before}*`, `*${after}*`).replaceAll(`*${before}-`, `*${after}-`);
const auditedStatuses = new Set(["Загадка", "Статусы", "Как ещё работают статусы", "Ремесло и мастерство", "Погони", "Как пользоваться"]);

function reviseEntry(entry) {
  const data = entry.data;
  const uid = entry.uid;
  const name = entry.name;
  if (entry.kind === "mechanic_item" && /^litm\.mech\.stat\./.test(uid ?? "")) {
    const status = statusNames.get(entry.name_original.toLowerCase());
    if (status) rename(entry, status[1]);
  }
  if (auditedStatuses.has(name)) {
    const replaceStatuses = (text) => {
      for (const [before, after] of statusNames.values()) text = replaceStatus(text, before, after);
      return text;
    };
    entry.description = replaceStatuses(entry.description);
    rewriteRussian(data, replaceStatuses);
  }
  if (entry.kind === "mechanic_consequence_item" && (data.consequence_type === "blocked" || data.consequence_type === "revelation")) {
    const isBlocked = data.consequence_type === "blocked";
    rename(entry, newNames.get(isBlocked ? "Заблокировано" : "Разоблачение"));
    entry.description = isBlocked ? blocked : revelation;
    section(data, "What it is").text = entry.description;
  }
  if (entry.kind === "mechanic_consequence_item" && data.consequence_type === "yes_but") rename(entry, "Да, но…");

  switch (uid) {
    case "litm.mech.statuses":
      entry.description = entry.description.replace("наложение (stacking)", "накопление статусов")
        .replace("полярные статусы", "противоположные статусы");
      break;
    case "litm.ref.rule.consequences":
    case "litm.ref.rule.delivering_consequences": {
      const short = uid.endsWith(".consequences");
      const rules = section(data, short ? "Types Of Consequences" : "Delivering Consequences");
      rules.text = replaceLine(rules.text, "• **Возможность закрыта:**", `• **Возможность закрыта:** ${blocked}`);
      rules.text = replaceLine(rules.text, "• **Обнаружение:**", `• **Обнаружение:** ${revelation}`);
      rules.text = addParagraph(rules.text, separate);
      data.steps = data.steps.map((step) => step.replace("Заблокировано, Осложнение, Разоблачение", "Возможность закрыта, Осложнение, Обнаружение")
        .replace("«Да, но…»", "Да, но…"));
      if (!short) {
        const sidebar = data.sidebars.find((item) => item.title === "Последствия и Могущество");
        if (!sidebar) throw new Error("Не найдена врезка «Последствия и Могущество»");
        sidebar.text = sourceMight;
        data.steps[2] = sourceMight;
      }
      break;
    }
    case "litm.ref.rule.reactions": {
      const reaction = section(data, "Reactions");
      reaction.text = reaction.text
        .replace("• **10 и больше** — потратьте Силу плюс 1 на любой Эффект.", "• **10 и больше** — потратьте Силу + 1, минимум 2, на подходящие Эффекты.")
        .replace("• **7–9** — потратьте Силу, но только на смягчение Последствий.", "• **7–9** — потратьте Силу, минимум 1, только на смягчение Последствий.")
        .replace(/\n\nПотратить у вас всегда есть[^\n]+/, "");
      break;
    }
    case "litm.ref.rule.spending_power_on_effects": {
      const effects = section(data, "Tag And Status Effects");
      effects.text = effects.text
        .replace("снять полезный тег или статус цели: *щит*, *уверен* или *в-ярости*.", "вычеркнуть полезный тег цели, например *щит*, или снизить её полезный статус, например *уверен* или *в-ярости*.")
        .replace("ослабить или снять вредный статус или тег (*ранен*, *в-отчаянии*, *лающий кашель*) или вернуть вычеркнутый тег.", "вычеркнуть вредный тег, снизить вредный статус или восстановить вычеркнутый тег.");
      break;
    }
    case "litm.ref.rule.statuses":
      entry.description = "Статус описывает состояние и имеет уровень от 1 до 6. Карточка учёта показывает накопление и снижение статуса.";
      section(data, "Increasing Statuses (Stacking)").head = "Накопление статусов";
      data.steps[2] = `Отметьте клетку уровня входящего статуса. Если она занята, отметьте следующую свободную справа. Уровень задаёт самая правая отметка. ${accumulation}`;
      break;
    case "litm.ref.rule.advanced_use_of_statuses": {
      entry.description = "Противоположные статусы гасят уровни друг друга. Побуждающий статус даёт указание. Защитный статус влияет на Силу или служит барьером перед Пределом.";
      const polar = section(data, "Polar Statuses");
      polar.head = "Противоположные статусы";
      polar.text = polar.text.replace("двух противоположных полярных статусов", "двух противоположных статусов");
      const compelling = section(data, "Compelling Statuses");
      compelling.text = compelling.text.replace("В побуждающем статусе есть указание — явное или подразумеваемое, — которое толкает цель поступать определённым образом.", "Побуждающий статус содержит явное или подразумеваемое указание.");
      compelling.text = addParagraph(compelling.text, "Игрок может попросить заменить побуждающий статус другим того же уровня, который отражает последствия сопротивления указанию.");
      const defensive = section(data, "Defensive Statuses");
      defensive.text = defensive.text.split("\n\n")[0] + "\n\n"
        + "Снимаемая защита служит отдельным барьером. Сначала потратьте уровни Эффекта на снижение защиты до нуля. Только оставшиеся уровни можно дать противоположным статусом против Предела. Например, у чудовища Предел «Сыт (4)» и статус *голоден-3*. Четырёх уровней Эффекта хватит, чтобы снять *голоден-3* и дать *сыт-1* против Предела. Сам по себе *голоден-3* в этом примере не уменьшает Силу действий, которыми кормят чудовище.\n\n"
        + "Защитный статус может работать обоими способами. Например, *фанатичен-4* мешает действию, которым хотят убедить Вызов, и его нужно снять, прежде чем засчитывать *убеждён* против Предела. Рассказчик определяет, как работает защита, и сообщает об этом игрокам.";
      data.steps[0] = "Противоположные статусы (*враждебен* и *дружелюбен*) взаимно гасят уровни. Остаток принадлежит большей стороне. При равенстве статус снимается.";
      data.steps[3] = "Потратьте уровни Эффекта на снятие защиты до нуля. Засчитайте остаток противоположным статусом против Предела.";
      break;
    }
    case "litm.ref.rule.quintessences": {
      const quintessences = section(data, "Quintessences");
      quintessences.text = replaceLine(quintessences.text, "**Живая легенда.**", "**Живая легенда.** Когда ваше действие под угрозой из-за меньшего Могущества, вы теряете 2 Силы вместо 3. Статусы в Последствиях против вас усиливаются на 2 уровня вместо 3. Если Последствия усиливают тегом, по-прежнему добавляют 1 тег.");
      break;
    }
    case "litm.ref.rule.limits": {
      const progress = section(data, "Progress Limits");
      progress.text = addParagraph(progress.text, "Стрелка у Предела в профиле Вызова указывает на результат. В двустороннем Пределе противоположные статусы гасят друг друга. Когда оставшийся статус достигает порога, наступает результат его стороны.");
      break;
    }
  }

  if (name === "Как устроено путешествие" && entry.name_original === "Journeys") {
    entry.description = replaceLine(entry.description, "**Путь перекрыт.**", "**Путь перекрыт.** Рассказчик может заранее назначить виньетку обязательной или перекрыть путь по итогам виньетки. Чтобы перейти к следующему шагу, Герои преодолевают препятствие. Если Рассказчик разрешает идти дальше, виньетку можно засчитать с Последствиями.")
      .replace("Вместо того чтобы довести Предел до максимума, герои одолевают путешествие, преодолевая череду маленьких вызовов — виньеток.", "Вызов с Пределом можно одолеть, доведя до него соответствующий статус. В путешествии Герои проходят заданное число коротких Вызовов — виньеток.");
  }
  if (name === "Общие дорожные виньетки") {
    const trap = data.groups?.find((group) => group.name === "Замки и ловушки")?.vignettes
      ?.find((vignette) => vignette.name === "Растяжка или нажимная плита");
    if (trap) {
      trap.threat = trap.threat.replace(/ \(там \*хорошо спрятанная\* растяжка или нажимная плита\)\./, ".");
      trap.narratorNote = "Здесь скрыта растяжка или нажимная плита.";
    }
  }
  if (name === "Погони" && entry.name_original === "Chases") {
    entry.description = entry.description.replace(/^Сцена погони[^\n]+/, "Сцена погони обычно Развёрнутая и вращается вокруг двустороннего Предела «Догнать / Оторваться». Статусы *догоняет* и *отрывается* взаимно гасят уровни. При достижении Предела первым статусом преследователи настигают беглецов, вторым — беглецы уходят. Порог задаёт Рассказчик.")
      .replaceAll("*оторвался*", "*отрывается*");
  }
  if (name === "Влияние" && uid === "litm.mech.role.4") {
    section(data, "Consequences").text = section(data, "Consequences").text
      .replace("*очарован*", "*обольщён*").replace("*туго-с-деньгами*", "*на-мели*");
  }
  if (name === "Как пользоваться" && entry.name_original === "A Guide To Countless Paths") {
    const weaken = data.effects?.find((item) => item.key === "WEAKEN");
    const restore = data.effects?.find((item) => item.key === "RESTORE");
    if (weaken) weaken.text = "вычеркнуть полезный тег цели или снизить её полезный статус";
    if (restore) restore.text = "вычеркнуть вредный тег, снизить вредный статус или восстановить вычеркнутый тег";
  }
  if (name === "Финты и отвлекающие атаки") {
    const weaken = data.success?.find((item) => item.effects.includes("WEAKEN"));
    if (weaken) weaken.text = "вычеркнуть полезный тег цели, например *отработанный манёвр*, или снизить полезный статус, например *боевой-дух* или *полон-сил*.";
  }
  if (name === "Землепластичество" && entry.name_original === "Landshaping") {
    const erosion = section(data, "Depleting The Land");
    erosion.text = erosion.text.replace("дойдя до максимума, навсегда обратить участок земли в пустыню (*опустошение-6*)", "достигнув Предела «Опустошение (6)», навсегда обратить участок земли в пустыню");
  }
  if (uid === "litm.themebook.companion") {
    const revenge = data.improvements?.find((item) => item.name === "Возмездие");
    if (revenge) revenge.text = revenge.text.replace("разъярён-2", "спровоцирован-2");
  }
}

const arrows = new Map([
  ["House Hob", ["Задобрить"]], ["Pastoral Priest or Priestess", ["Обряд"]],
  ["An Honest Day’s Work", ["Закат"]], ["Boggart", ["Развеселить"]], ["Hedge Witch", ["Обряд"]],
  ["Megalith", ["Связать", "Разрушить"]], ["Rampaging Giant", ["Перекормить"]],
  ["Obsessive Cultist", ["Обряд"]], ["Rival Bard", ["Переиграть"]],
]);

const polarLimits = new Map([
  ["Kraken", ["Сбежать или проглотить", [
    { status: "сбежать", outcome: "При *сбежать-5* судно уходит." },
    { status: "проглотить", outcome: "При *проглотить-5* кракен уничтожает судно, и гибнет множество моряков (**Дурные вести**)." },
  ]]],
  ["Raiding Longboat", ["Сбежать или настичь", [
    { status: "сбежать", outcome: "При *сбежать-3* преследуемое судно уходит." },
    { status: "настичь", outcome: "При *настичь-3* налётчики готовы к абордажу. **Новый вызов**: кровожадные грабители со *щитами* (с. 139)." },
  ]]],
  ["Outlaw Overlord", ["Исполнить / сорвать замысел", [
    { status: "замысел", outcome: "При *замысел-4* владыка осуществляет план." },
    { status: "срыв", outcome: "При *срыв-4* Герои срывают план владыки." },
  ]]],
]);

function splitThreat(content, name, count) {
  if (content.threatList.some((block) => block.withoutThreat)) return;
  const threat = content.threatList.find((block) => block.name === name);
  if (!threat || threat.consequences.length <= count) throw new Error(`Не удалось разделить Угрозу «${name}»`);
  content.threatList.push({
    name: "", lead: "", withoutThreat: true,
    consequences: threat.consequences.splice(-count),
    consequencesEn: threat.consequencesEn?.splice(-count),
  });
}

function effect(content, threatName, prefix, text, ...actions) {
  const block = content.threatList.find((item) => item.name === threatName);
  const index = block?.consequences.findIndex((line) => typeof prefix === "string" ? line.startsWith(prefix) : prefix.test(line)) ?? -1;
  if (index < 0) throw new Error(`Не найдено Последствие «${prefix}»`);
  block.effects ??= {};
  if (block.consequences[index] !== text) delete block.effects[block.consequences[index]];
  block.consequences[index] = text;
  block.effects[text] = actions;
}

const status = (name, tier, extra = {}) => ({ kind: "status", name, tier, self: false, all: false, ...extra });
const reduce = (name, by, extra = {}) => ({ kind: "reduce", name, by, ...extra });
const compound = (effect) => ({ kind: "compound", effect });
const chooseTarget = { chooseTarget: true };

function reviseChallenge(content, entry) {
  const name = entry.name_original;
  for (const limitName of arrows.get(name) ?? []) {
    const limit = content.limitList?.find((item) => item.name === limitName);
    if (!limit) throw new Error(`Не найден Предел «${limitName}» у «${entry.name}»`);
    limit.arrow = true;
  }
  if (polarLimits.has(name)) {
    const [limitName, sides] = polarLimits.get(name);
    const limit = content.limitList.find((item) => item.name === limitName);
    if (!limit) throw new Error(`Не найден двусторонний Предел «${limitName}»`);
    limit.arrow = true;
    limit.note = "";
    limit.sides = sides;
  }

  switch (name) {
    case "Crafty Rumormonger":
      splitThreat(content, "Строить козни", 1);
      break;
    case "Protective Bear":
      splitThreat(content, "Броситься", 2);
      content.threatList.find((item) => item.name === "Защищать").lead = "Встревоженно следить за источником опасности";
      effect(content, "", "Обнюхать", "Обнюхать всё вокруг (снизить *скрыт* у цели на 2 уровня)", reduce("скрыт", 2, chooseTarget));
      break;
    case "Rampaging Giant":
      splitThreat(content, "Драться", 2);
      effect(content, "", "Догадаться", "Догадаться, где прячется Герой (**Обнаружение**)", { kind: "named", name: "Обнаружение", type: "revelation" });
      effect(content, "", "Сообразить", "Сообразить, что делает Герой, который вцепился в великана (**Обнаружение**)", { kind: "named", name: "Обнаружение", type: "revelation" });
      break;
    case "Obsessive Cultist":
      effect(content, "Петь", "Шептать странные слоги", "Шептать странные слоги (продвинуть Предел «Обряд» статусом *обряд-1*)", status("обряд", 1, { self: true, limit: "Обряд" }));
      effect(content, "Петь", "Восстановить защитные чары", "Восстановить защитные чары (культист получает *защищён-2*)", status("защищён", 2, { self: true }));
      break;
    case "Plotting Courtier": {
      const conspiracy = content.limitList.find((l) => l.nameEn === "Conspiracy");
      if (conspiracy) conspiracy.note = "Применить одно Последствие «Захвата власти» с Могуществом Величия в аспекте «Далеко идущее политическое влияние».";
      const grasp = content.threatList.find((t) => t.nameEn === "Grasp For Power");
      if (grasp) {
        grasp.consequences = grasp.consequences.map((line) => line.replace("получить «Власть»", "получить Могущество Приключения в аспекте «Власть»")
          .replace("получить «Крепость»", "получить Могущество Приключения в аспекте «Крепость»"));
      }
      break;
    }
    case "Compactor Trap":
      effect(content, "Ползти", "Стены ползут", "Стены ползут всё ближе (продвинуть Предел «Сомкнуться» статусом *сомкнуться-1*)", status("сомкнуться", 1, { self: true, limit: "Сомкнуться" }));
      break;
    case "Kraken":
      effect(content, "Затаиться", "Подняться", "Подняться к поверхности (продвинуть Предел статусом *проглотить-1*)",
        status("проглотить", 1, { self: true, limit: "Сбежать или проглотить" }));
      effect(content, "Раздавить", "Продолжить заглатывать", "Продолжить заглатывать судно (продвинуть Предел статусом *проглотить-2* и дать судну *повреждён-1*)",
        status("проглотить", 2, { self: true, limit: "Сбежать или проглотить" }), status("повреждён", 1, chooseTarget));
      break;
    case "Raiding Longboat":
      effect(content, "Погоня", "Судно всё ближе", "Судно всё ближе и ближе (продвинуть Предел статусом *настичь-1*)",
        status("настичь", 1, { self: true, limit: "Сбежать или настичь" }));
      break;
    case "Outlaw Overlord":
      effect(content, "Замысел", "Владыка продвигает", "Владыка продвигает свой замысел или оправляется от неудач (*замысел-1* к двустороннему Пределу)", status("замысел", 1, { self: true, limit: "Исполнить / сорвать замысел" }));
      break;
    case "Battlefield Leader":
      effect(content, "Командовать", "Приказать", "Приказать отряду атаковать (отряд получает *в-атаке-1*) или лично повести атаку (полководец получает *в-атаке-3* и лишается защиты «Под охраной»)",
        compound("orderCharge"), compound("leadCharge"));
      break;
    case "Frontier Healer":
      effect(content, "Исцелять и хранить", "Исцелить товарища", "Исцелить товарища (снизить его статус ранения на 3 и *жизненную-силу* лекаря на 1)",
        compound("healAlly"));
      effect(content, "Исцелять и хранить", "Исцелить себя", "Исцелить себя (снизить своё ранение на 1 и *жизненную-силу* на 1)",
        compound("healSelf"));
      effect(content, "Исцелять и хранить", /^(Оживить товарища|Вернуть в строй)/, "Вернуть в строй павшего товарища, если он ещё жив (**Новый вызов** и снизить *жизненную-силу* лекаря на 1)",
        compound("revive"));
      effect(content, "Исцелять и хранить", "Наложить", "Наложить оберег на товарища (он получает *защищён-от-вреда-1*, *жизненная-сила* лекаря снижается на 1)",
        compound("ward"));
      break;
    case "Immortal Vampire":
      rewriteRussian(content, (line) => line.replaceAll("принуждающий статус", "побуждающий статус"));
      break;
  }

  if (["Unshriven Revenant", "Bombardier", "Soldier"].includes(name)) {
    for (const tag of content.tagList) {
      tag.text = replaceStatus(tag.text, "неснимаемое-проклятие", "стойкое-проклятие");
      const options = tag.text.split(" или ");
      if (options.length > 1 && options.every((option) => /^\*[^*]+-[1-6]\*$/.test(option))) tag.alternatives = options;
    }
  }
  const object = name === "Heartless Warlock" ? "предмет силы" : name === "Compactor Trap" ? "высокий узкий проём" : null;
  if (object) {
    const index = content.tagList.findIndex((tag) => tag.text.startsWith(`*${object}*, который `));
    if (index >= 0) {
      const tag = content.tagList[index];
      const [text, state] = tag.text.split(", который ");
      const [textEn, stateEn] = tag.textEn?.split(/,? (?:that is|which is) /) ?? [];
      content.tagList.splice(index, 1, { ...tag, text, textEn: textEn ?? tag.textEn }, { text: state, textEn: stateEn, object });
    }
  }

  const { limitList, tagList, threatList } = content;
  if (limitList && (arrows.has(name) || polarLimits.has(name) || name === "Plotting Courtier")) {
    content.limits = limitList.map((l) => `${l.name} ${l.max}${l.arrow ? " ↻" : ""}${l.note ? ` — ${l.note}` : ""}${l.sides ? ` — ${l.sides.map((s) => s.outcome).join(" ")}` : ""}`).join("\n");
  }
  if (threatList && (name === "Plotting Courtier" || threatList.some((t) => t.withoutThreat || t.effects))) {
    content.threatsConsequences = threatList.map((t) => [
      t.withoutThreat ? "**Последствия без Угрозы**" : t.name ? `**${t.name}** — ${t.lead}` : `*${t.lead}*`,
      ...t.consequences.map((line) => `• ${line}`),
    ].join("\n")).join("\n\n");
  }
  if (tagList?.some((tag) => tag.object || tag.alternatives)) {
    content.tagsAndStatuses = content.tagsAndStatuses.replace("неснимаемое-проклятие", "стойкое-проклятие");
  }
}

const entries = db.prepare(`SELECT e.id, e.uid, e.kind, e.name, e.name_original, e.aliases, e.description, e.data, s.name AS section
  FROM compendium_entries e JOIN system_sections s ON s.id = e.section_id WHERE e.system_id = ?`);
const statblocks = db.prepare("SELECT id, content FROM statblocks WHERE owner_type = 'compendium_entry' AND owner_id = ? AND format = 'litm_challenge'");
const updateEntry = db.prepare("UPDATE compendium_entries SET name = ?, aliases = ?, description = ?, data = ? WHERE id = ?");
const updateStatblock = db.prepare("UPDATE statblocks SET content = ? WHERE id = ?");
const count = db.transaction(() => {
  const changes = { entries: 0, statblocks: 0 };
  for (const raw of entries.all(Number(id))) {
    const entry = { ...raw, data: JSON.parse(raw.data || "{}"), aliases: JSON.parse(raw.aliases || "[]") };
    if (entry.section !== "Вызовы" || entry.data.location !== "Свои") {
      entry.description = rewriteLabels(entry.description ?? "");
      rewriteRussian(entry.data, rewriteLabels);
      reviseEntry(entry);
    }
    const aliases = JSON.stringify(entry.aliases);
    const data = JSON.stringify(entry.data);
    if (entry.name !== raw.name || aliases !== JSON.stringify(JSON.parse(raw.aliases || "[]")) ||
        entry.description !== raw.description || data !== JSON.stringify(JSON.parse(raw.data || "{}"))) {
      updateEntry.run(entry.name, aliases, entry.description, data, entry.id);
      changes.entries++;
    }
    if (entry.section !== "Вызовы" || entry.data.location === "Свои" || !entry.name_original) continue;
    for (const row of statblocks.all(entry.id)) {
      const content = JSON.parse(row.content);
      const before = JSON.stringify(content);
      rewriteRussian(content, rewriteLabels);
      reviseChallenge(content, entry);
      if (before !== JSON.stringify(content)) {
        updateStatblock.run(JSON.stringify(content), row.id);
        changes.statblocks++;
      }
    }
  }
  return changes;
})();
console.log(JSON.stringify(count));
db.close();
