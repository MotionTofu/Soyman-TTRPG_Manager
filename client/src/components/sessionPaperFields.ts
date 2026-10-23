// Поля сессии на бумаге (спека campaign-paper, Q42/Q45): паспорт вечера по листу
// 11 тетради кампании и «Что изменилось» по осям outcomes. Их читают карточки
// сессии и «К сессии» на «Обзоре» кампании.

export const SESSION_PASSPORT_FIELDS = [
  { key: "idea_notes", label: "Обещание вечера", hint: "Что этот вечер даст игрокам — бывшая «Задумка»" },
  { key: "questions", label: "Активные вопросы", hint: "Что решается сегодня" },
  { key: "player_intent", label: "Чего хотят игроки", hint: "Желания игроков на этот вечер" },
  { key: "exit_state", label: "Состояние на выходе", hint: "Каким мир может стать к концу вечера" },
] as const;

export const SESSION_OUTCOME_FIELDS = [
  { key: "goal", label: "Цель" },
  { key: "cost", label: "Цена" },
  { key: "relations", label: "Отношения" },
  { key: "threat", label: "Угроза" },
  { key: "world", label: "Мир" },
  { key: "pcs", label: "Персонажи" },
] as const;
