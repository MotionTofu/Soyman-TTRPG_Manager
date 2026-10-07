import type { WorkbookField as F, WorkbookSheet, WorkbookTemplate } from "./workbooks";

const line = (key:string,label:string,hint?:string):F => ({key,label,type:"line",...(hint?{hint}:{})});
const page = (key:string,label:string,hint?:string):F => ({key,label,type:"page",...(hint?{hint}:{})});
const ref = (key:string,label:string,hint?:string):F => ({key,label,type:"reference",...(hint?{hint}:{})});
const choice = (key:string,label:string,options:string[]):F => ({key,label,type:"choice",options});
const table = (key:string,label:string,columns:F[],hint?:string):F => ({key,label,type:"table",columns,...(hint?{hint}:{})});
const group = (key:string,label:string,fields:F[],hint?:string):F => ({key,label,type:"group",fields,...(hint?{hint}:{})});
const sheet = (key:string,title:string,fields:F[],instructions?:string):WorkbookSheet => ({key,title,fields,...(instructions?{instructions}:{})});
const checks = (options:string[]):F => ({key:"checks",label:"Проверить перед игрой",type:"checklist",options,optional:true});
const passport:F = {key:"passport",label:"Паспорт проекта",type:"profile",entity:"passport",hint:"Общие данные проекта: изменения видны и в его профиле."};
const world = (entity:string,label:string):F => ({key:entity,label,type:"profile",entity});

/** These definitions are product templates. Course manuscripts remain separate sources. */
export const ACTIVITY_LINES:F = group("lines","Деятельность НПЦ и сил",[
  line("name","Название линии"),
  ref("actor","НПЦ / сила","Можно выбрать профиль или оставить название временной группы в названии линии."),
  ref("partner","Другой участник","Для совместного плана нескольких НПЦ."),
  page("start","Исходное положение"),
  choice("status","Статус линии",["Активна","На паузе","Завершена","Перенаправлена"]),
  {key:"current",label:"Текущее состояние",type:"state",source:"states"},
  table("states","Состояния",[
    line("name","Состояние"),line("changed","Что изменилось"),line("goal","Цель сейчас"),
    ref("place","Где"),line("action","Действие без героев"),
    choice("trigger_kind","Причина перехода",["Время","Информация","Другая сила","Герои","Ресурс","Успех / провал","Другое"]),
    line("trigger","Условие перехода"),line("traces","Наблюдаемые следы"),
    choice("ending","Итог без вмешательства",["Да"]),
  ],"Каждая линия меняется по собственным причинам. Строки — возможные состояния, их заполнение не меняет мир."),
  page("actual","Что действительно произошло","Запись конкретного проведения; предполагаемые последствия не становятся фактами автоматически."),
],"Добавляйте только силы, самостоятельные действия которых меняют ситуацию.");

const activitySheets = ():WorkbookSheet[] => [
  sheet("activity","Движение мира",[
    {...ACTIVITY_LINES},
    table("intersections","Пересечения сил",[
      ref("first","Первая сила"),ref("second","Вторая сила"),ref("shared","Общий человек / место / ресурс"),
      line("condition","Когда пересекутся"),line("collision","Что может произойти"),
      line("consequence","Последствия даже без героев"),line("traces","Что заметят герои"),
    ]),
    group("pressure","Процессы давления",[
      line("name","Процесс"),line("start","Исходное состояние"),
      table("steps","Ступени",[line("name","Ступень"),line("trigger","Причина перехода"),line("change","Что меняется"),line("response","Как вмешаться"),line("signs","Признаки")]),
      {key:"current",label:"Текущая ступень",type:"state",source:"steps"},
    ]),
    page("rhythm","Ритм и передышки"),
  ]),
];

export const ADVENTURE_WORKBOOK:WorkbookTemplate = {
  format:"soyman-workbook",schemaVersion:1,key:"oneshot-design",version:2,title:"Тетрадь приключения · ваншот",practical:true,
  description:"Подготовка приключения, самостоятельные силы и рабочие записи для одного вечера.",
  sheets:[
    sheet("overview","За столом",[
      passport,{key:"actors-now",label:"Что делают силы сейчас",type:"summary",source:"activity/lines"},
      page("next","Ближайший шаг подготовки"),page("start","С чего начать игру"),
      page("quick","Что быстро найти за столом","Короткие заметки и ссылки на нужные карточки; @ добавляет упоминание."),
    ]),
    sheet("party","Герои и вход в приключение",[
      table("heroes","Персонажи и прегены",[ref("character","Персонаж"),ref("player","Игрок"),line("hook","Что вовлекает"),line("stake","Личная ставка"),line("choice","Трудный выбор"),line("refusal","Если откажется")]),
      page("together","Почему группа действует вместе"),page("expectations","Ожидания, границы и договорённости"),
      checks(["У каждого героя есть повод действовать","Отказ от одной зацепки не останавливает приключение"]),
    ]),
    sheet("situation","Ситуация и силы",[
      {key:"participations",label:"Участники и их планы",type:"profile",entity:"participants"},
      page("past","Что произошло до игры"),page("unstable","Почему ситуация неустойчива"),
      table("forces","Действующие силы",[ref("actor","Профиль силы"),line("role","Роль в ситуации"),line("connection","На что влияет")],"Двигатель силы меняется в её профиле. Цель и план приключения — в участии; таблицы деятельности находятся в «Движении мира»."),
      page("conflict","Несовместимости и связи сил"),ref("tension","Исходное напряжение / материал сеттинга"),
    ]),
    sheet("decisions","Решения, цена и последствия",[
      group("choices","Развилки",[line("name","Решение"),ref("scene","Где возникает"),page("question","В чём выбор"),
        table("options","Варианты",[line("option","Вариант"),line("gain","Что даёт"),line("cost","Цена"),line("result","Возможное последствие")]),
        page("other","Другой подход игроков"),page("echo","Как решение вернётся в игру")]),
    ]),
    sheet("structure","Структура и переходы",[
      table("nodes","Узлы приключения",[ref("scene","Сцена / узел"),line("role","Функция"),line("entry","Как попасть"),line("exits","Доступные направления"),line("change","Что открывает / меняет")]),
      page("route","Доступ к финалу и обходные пути"),page("cut","Что можно пропустить или сжать"),
      checks(["Ключевой путь не зависит от единственного броска","Есть продолжение при пропуске важного узла"]),
    ]),
    sheet("information","Тайны, улики и открытия",[
      {key:"information",label:"Тайны приключения",type:"profile",entity:"information"},
      table("secrets","Доступ к информации",[line("conclusion","Необходимый вывод"),line("need","Для какого решения нужен"),line("sources","Независимые источники"),line("miss","Если не найдут"),line("when","Когда полезно раскрыть")]),
      table("payoffs","Посевы и отдачи",[line("seed","Что вводим"),ref("source","Связанный материал"),line("payoff","Как может вернуться"),line("condition","Условие отдачи")]),
      page("suspense","Что знать заранее, что оставить неожиданностью"),
      checks(["У ключевой информации есть несколько доступных источников","Пропущенное открытие не закрывает все решения"]),
    ]),
    sheet("scenes","Подготовка сцен",[
      group("prep","Заметки к сценам",[line("name","Название заметки"),ref("scene","Профиль сцены"),
        page("aim","Какое решение даёт сцена"),page("opening","Что сделать сразу"),page("anchors","Заметные детали и возможности"),
        page("pressure","Давление и реакция на промедление"),page("failure","Что меняется при провале"),page("exit","Когда завершить или сократить")],
        "Рамка, состав, переходы, улики и награды принадлежат профилю сцены. Здесь — дополнительные заметки подготовки."),
      table("negotiations","Переговоры",[ref("actor","Сила"),ref("scene","Сцена"),line("want","Чего хочет здесь"),line("offer","Предложение"),line("fallback","Запасной вариант"),line("redline","Красная линия"),line("leverage","Рычаг / смена тактики")]),
    ]),
    ...activitySheets(),
    sheet("time","Время одного вечера",[
      line("slot","Доступное время"),table("budget","Бюджет игры",[line("part","Часть игры"),line("minutes","Время"),line("cut","Как сократить"),line("preserve","Что сохранить")]),
      page("checkpoints","Когда переходить к завершению"),page("reserve","Если времени больше или меньше"),
    ]),
    sheet("ending","Завершение и последствия",[
      ref("finale","Финальная сцена"),page("condition","Когда начинается завершение"),page("question","Какое решение остаётся открытым"),
      table("possibilities","Возможные исходы",[line("choice","Выбор / условие"),line("goal","Цель"),line("cost","Цена"),line("forces","Силы и отношения"),line("world","Что меняется в мире")]),
      page("epilogue","Что показать в эпилоге"),page("actual","Чем закончилась эта игра","Факт конкретного проведения; возможные исходы выше — подготовка."),
      table("consequences","Последствия, к которым вернуться",[line("decision","Что произошло"),ref("subject","Кого / что затронуло"),line("return","Как вернётся"),line("status","Что уже вернулось")]),
    ]),
    sheet("revision","Проверка и правки",[
      table("tests","Плейтест и проблемные места",[line("case","Ситуация / действие игрока"),line("observation","Что обнаружилось"),line("fix","Что изменить"),line("next","Что проверить снова")]),
      table("changes","Правки",[line("problem","Проблема"),line("change","Правка"),line("why","Зачем"),line("status","Состояние")]),
      page("keep","Что сработало и стоит сохранить"),
    ]),
  ],
};

export const CAMPAIGN_WORKBOOK:WorkbookTemplate = {
  format:"soyman-workbook",schemaVersion:1,key:"campaign-design",version:2,title:"Тетрадь кампании",practical:true,
  description:"Договорённости, текущая ситуация, подготовка и итоги сессий. Подходит и для проведения ваншота.",
  sheets:[
    sheet("overview","Сейчас",[passport,{key:"actors-now",label:"Активные силы",type:"summary",source:"activity/lines"},ref("session","Текущая / следующая сессия"),page("reminder","Что вспомнить после перерыва"),page("next","Ближайший шаг")]),
    sheet("charter","Договорённости",[page("table","Договор стола"),page("boundaries","Границы и безопасность"),page("format","Ритм встреч, отсутствие игроков и замены"),page("rulings","Правила и решения мастера")]),
    sheet("party","Персонажи и игроки",[
      table("roster","Состав",[ref("character","Персонаж"),ref("player","Игрок"),line("status","Участие сейчас"),line("question","Открытый вопрос"),line("focus","Ближайшее внимание")],"Интерес игрока и личная история персонажа редактируются в их профилях. Участие в кампании имеет собственную ставку."),
      page("group","Общая причина действовать"),table("hooks","Зацепки и обязательства",[ref("character","Для кого"),ref("subject","Связанный профиль"),line("hook","Зацепка / обязательство"),line("change","При уходе персонажа")]),
    ]),
    sheet("world","Мир и действующие силы",[
      table("places","Значимые места",[ref("place","Место"),line("local","Что важно именно в этой кампании"),line("question","Что меняется")]),
      table("forces","Силы",[ref("actor","Профиль силы"),line("status","Активна / фон / пауза"),line("focus","На что обратить внимание")]),
      table("relations","Рычаги и обязательства",[ref("first","Кто"),ref("second","Кому"),line("leverage","Рычаг / обязательство"),line("condition","Условие изменения")]),
    ]),
    ...activitySheets(),
    sheet("threads","Вопросы, открытия и отдачи",[
      {key:"information-model",label:"Тайны кампании",type:"profile",entity:"information"},
      table("threads","Открытые линии",[line("name","Вопрос / линия"),ref("subject","Связанный профиль"),line("state","Текущее положение"),line("next","Следующий возможный ход"),line("close","Условие завершения")]),
      table("information","План открытий",[line("conclusion","Необходимый вывод"),line("who","Кому важен"),line("source","Как можно узнать"),line("meaning","Что это меняет")]),
      table("payoffs","Посевы, отдачи и обещанные последствия",[line("seed","Что введено / обещано"),ref("subject","Кого касается"),line("payoff","Как вернётся"),line("when","Условие / окно"),line("actual","Что произошло")]),
    ]),
    sheet("travel","Путешествия, downtime и проекты",[
      table("routes","Маршруты",[ref("from","Откуда"),ref("to","Куда"),line("time","Время"),line("cost","Цена / риск"),line("change","Что меняет выбор")]),
      table("projects","Проекты и занятия между сессиями",[ref("actor","Участник"),line("goal","Цель"),line("step","Ближайший шаг"),line("resources","Время / ресурсы"),line("risk","Условия успеха / срыва"),line("actual","Результат")]),
    ]),
    sheet("session-prep","Подготовка сессии",[
      ref("session","Профиль сессии"),page("intent","Намерения игроков"),page("promise","Что важно дать в этот вечер"),
      table("scenes","Сцены и возможности",[ref("scene","Сцена"),line("reason","Почему сейчас"),line("opportunity","Решение / возможность"),line("cut","Что сжать или пропустить")]),
      page("opening","Стартовая сцена"),page("carry","Что перенести из прошлой сессии"),page("end","Состояние на выходе"),
      checks(["Подготовка учитывает намерения игроков","Есть последствия отказа от подготовленного пути"]),
    ]),
    sheet("at-table","За столом",[
      ref("session","Сессия"),ref("scene","Сцена"),page("notes","Быстрые записи и импровизация"),
      table("situations","Разрешение ситуаций",[line("intent","Намерение"),line("approach","Подход"),line("position","Условия"),line("risk","Риск / цена"),line("result","Что произошло")]),
      table("negotiations","Переговоры",[ref("actor","Сила"),ref("scene","Сцена"),line("goal","Цель здесь"),line("offer","Предложение"),line("fallback","Запасной вариант"),line("redline","Красная линия"),line("tactic","Тактика / смена")]),
      page("canon","Новые факты, требующие разбора"),page("rulings","Решения правил"),
    ]),
    sheet("recap","После сессии",[
      ref("session","Профиль сессии"),page("events","Ключевые события"),
      table("delta","Что изменилось",[ref("subject","Кто / что"),line("before","До"),line("after","После"),line("why","Причина"),line("followup","Следующий ход")],"Это журнал мастера; текущие значения профилей сами по себе не дают достоверную разницу до/после."),
      page("questions","Намерения игроков и открытые вопросы"),page("reaction","Немедленная реакция мира"),page("remind","Что напомнить в следующий раз"),
    ]),
    sheet("ending","Арки и завершение",[
      table("arcs","Приключения и арки",[ref("adventure","Приключение"),line("question","Открытый вопрос"),line("condition","Условие завершения"),line("actual","Как завершилось")]),
      page("finale","Кульминация кампании"),page("epilogue","Эпилоги персонажей и мира"),page("legacy","Что сохранить для следующих игр"),
    ]),
    sheet("revision","Наблюдения и правки",[
      table("review","Что улучшить",[line("signal","Наблюдение"),line("reason","Возможная причина"),line("change","Изменение"),line("next","Что проверить")]),page("keep","Что работает"),
    ]),
  ],
};

export const SETTING_WORKBOOK:WorkbookTemplate = {
  format:"soyman-workbook",schemaVersion:1,key:"setting-design",version:1,title:"Тетрадь сеттинга",practical:true,
  description:"Рабочее устройство мира, связи его элементов и подготовка материала для приключений.",
  sheets:[
    sheet("overview","Ядро и быстрый доступ",[passport,page("signature","Узнаваемые черты мира"),page("core","Что важно найти за 30 секунд"),page("next","Ближайший шаг разработки")]),
    sheet("truths","Правила мира и возможности",[
      world("world_truth","Правила мира"),world("capability","Магия, технологии и другие возможности"),
      page("exceptions","Исключения и их последствия"),
    ]),
    sheet("geography","География и места",[
      table("places","Ключевые места",[ref("place","Профиль места"),line("function","Зачем существует"),line("need","От чего зависит"),line("opportunity","Что могут сделать герои")]),
      page("map","Карта и масштаб перемещений"),table("routes","Пути",[ref("from","Откуда"),ref("to","Куда"),line("access","Доступ / препятствие"),line("cost","Время / цена / риск")]),
    ]),
    sheet("activity","Жизнь, ресурсы и потоки",[
      world("activity","Деятельности"),world("flow","Цепочки и потоки"),
    ]),
    sheet("society","Общества, традиции и нормы",[
      world("tradition","Традиции"),world("norm","Нормы"),
      table("societies","Общества",[ref("community","Профиль сообщества"),line("question","Вопросы и задумки")]),
    ]),
    sheet("institutions","Институты, власть и силы",[
      table("institutions","Институты",[ref("community","Профиль"),line("function","Какую задачу решает"),line("power","Основание власти"),line("means","Средства"),line("limit","Предел / зависимость"),line("informal","Неформальная сторона")]),
      table("forces","Действующие силы",[ref("actor","Профиль силы"),line("role","Роль в мире"),line("conflict","Что сталкивает с другими")],"Желание, страх, знания и ресурсы силы редактируются в её профиле."),
      table("relations","Значимые связи",[ref("first","От кого"),ref("second","К кому"),line("meaning","Смысл связи"),line("leverage","Рычаг / обязательство")]),
    ]),
    sheet("tensions","Напряжения и возможности игры",[
      world("tension","Напряжения"),
      page("adventures","Какие приключения возникают из мира"),
    ]),
    sheet("history","История и слои прошлого",[
      table("layers","Слои прошлого",[line("event","Событие / эпоха"),ref("subject","Связанное место / сила"),line("trace","Что осталось сейчас"),line("versions","Разные версии"),line("play","Что меняет в игре")]),
      page("calendar","Хронология и ссылки на календарь"),
    ]),
    sheet("knowledge","Знания, слухи и документы",[
      world("claim","Что знают и во что верят"),world("diegetic_doc","Документы мира"),
      page("primer","Вводная для игроков","Редакционная версия без скрытых сведений. Указание здесь само не выдаёт профили игрокам."),
    ]),
    sheet("open","Неизвестное и пространство для игры",[
      world("negative_space","Что оставляем открытым"),world("notes","Задумки"),
    ]),
    sheet("projects","Из мира в приключение",[
      table("projects","Приключения и кампании",[ref("project","Проект"),ref("tension","Исходное напряжение / сила"),line("premise","Основание приключения"),line("resources","Что взять из мира")]),
      page("baseline","Что считать исходным состоянием"),page("boundaries","Что может менять проведение"),
    ]),
    sheet("revision","Связность и правки",[
      checks(["Важные элементы дают действия и решения игроков","У мест, сил и ресурсов понятны зависимости","Сведения для игроков отделены от скрытых"]),
      table("issues","Пробелы и несогласованности",[ref("subject","Элемент"),line("issue","Что не сходится"),line("change","Что изменить"),line("effect","Кого затрагивает")]),
      table("changes","Журнал правок",[line("date","Дата / версия"),line("change","Правка"),line("why","Почему"),line("followup","Что проверить / обновить во вводной")]),
    ]),
  ],
};

export const PRACTICAL_WORKBOOKS = [ADVENTURE_WORKBOOK,CAMPAIGN_WORKBOOK,SETTING_WORKBOOK] as const;
