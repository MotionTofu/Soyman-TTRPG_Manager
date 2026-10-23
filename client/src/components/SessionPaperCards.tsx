import { useAction, write } from "../data/hooks";
import type { SessionDetail } from "../types";
import { PaperFieldsCard } from "./PaperFieldsCard";
import { SESSION_OUTCOME_FIELDS, SESSION_PASSPORT_FIELDS } from "./sessionPaperFields";

// Сессия на бумаге (спека campaign-paper, Q42/Q45; доски 46–47): паспорт
// вечера по листу 11 тетради кампании и «Что изменилось» по осям outcomes.

function useSessionWrite(sessionId: number) {
  const run = useAction();
  return async (send: () => Promise<unknown>) => {
    const done = await run(send, { affects: [{ kind: "session", id: sessionId }] });
    if (done === undefined) throw new Error("Не сохранилось");
  };
}

export function SessionPassportCard({ session, settingId }: { session: SessionDetail; settingId: number | null }) {
  const save = useSessionWrite(session.id);
  // Обещание — прежняя колонка idea_notes: её читают пульт и копия подготовки.
  const values = { ...(session.passport ?? {}), idea_notes: session.idea_notes ?? "" };
  return (
    <PaperFieldsCard
      label="Паспорт вечера"
      fields={SESSION_PASSPORT_FIELDS}
      values={values}
      rows
      mentionSettingId={settingId}
      empty="Паспорт пуст: что вечер обещает, какие вопросы решаются…"
      onSave={async (next) => {
        const { idea_notes, ...passport } = next;
        if ((idea_notes ?? "") !== (session.idea_notes ?? "")) await save(() => write.put(`/sessions/${session.id}`, { idea_notes }));
        await save(() => write.put(`/sessions/${session.id}/passport`, { passport }));
      }}
    />
  );
}

export function SessionOutcomesCard({ session }: { session: SessionDetail }) {
  const save = useSessionWrite(session.id);
  return (
    <PaperFieldsCard
      label="Что изменилось"
      fields={SESSION_OUTCOME_FIELDS}
      values={session.outcomes ?? {}}
      rows
      empty="Заполняется после игры: цель, цена, отношения, угроза, мир, персонажи."
      onSave={(next) => save(() => write.put(`/sessions/${session.id}/passport`, { outcomes: next }))}
    />
  );
}
