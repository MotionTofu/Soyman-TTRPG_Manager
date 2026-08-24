import { memo } from "react";
import type { CompendiumEntry } from "../../types";

const MIGHT_RU: Record<string, string> = {
  origin: "Происхождение",
  adventure: "Приключение",
  greatness: "Величие",
  variable: "Переменное",
};

/** Тело записи kind='themebook': вопросы, идеи квестов, особые улучшения. */
export const LitmThemeBookBody = memo(function LitmThemeBookBody({
  data,
}: {
  data: Record<string, unknown>;
}) {
  const pq = (data.powerQuestions as string[] | undefined) ?? [];
  const wq = (data.weaknessQuestions as string[] | undefined) ?? [];
  const qi = (data.questIdeas as string[] | undefined) ?? [];
  const imps = (data.improvements as { name: string; text: string; active?: boolean }[] | undefined) ?? [];
  const might = (data.might as string) || "";
  const LETTERS = "ABCDEFGHIJ";

  return (
    <div className="stack" style={{ gap: 12 }}>
      {might && (
        <span className="comp-badge litm-power-chip">{MIGHT_RU[might] ?? might}</span>
      )}

      {pq.length > 0 && (
        <div>
          <div className="litm-section-label">Вопросы силовых тегов</div>
          {pq.map((q, i) => (
            <div key={i} className="litm-q">
              <strong>{LETTERS[i]}.</strong> {q}
            </div>
          ))}
        </div>
      )}

      {wq.length > 0 && (
        <div>
          <div className="litm-section-label">Вопросы слабостей</div>
          {wq.map((q, i) => (
            <div key={i} className="litm-q">
              <strong>{LETTERS[i]}.</strong> {q}
            </div>
          ))}
        </div>
      )}

      {qi.length > 0 && (
        <div>
          <div className="litm-section-label">Идеи квестов</div>
          <ul className="litm-ideas">
            {qi.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      )}

      {imps.length > 0 && (
        <div>
          <div className="litm-section-label">Особые улучшения</div>
          <ul className="litm-improvements">
            {imps.map((imp, i) => (
              <li key={i}>
                <strong>{imp.name}</strong> — {imp.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

/** Тело записи kind='treasure': теги мини-темы особого предмета. */
export const LitmTreasureBody = memo(function LitmTreasureBody({
  data,
}: {
  data: Record<string, unknown>;
}) {
  const tags = (data.tags as string[] | undefined) ?? [];
  if (tags.length === 0) return null;
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
      {tags.map((t, i) => (
        <span key={i} className="tg tg-story" style={{ fontSize: 14 }}>{t}</span>
      ))}
    </div>
  );
});

/** Тело записи kind='magic_way': описание пути. */
export const LitmMagicWayBody = memo(function LitmMagicWayBody({
  entry,
}: {
  entry: CompendiumEntry;
}) {
  if (!entry.description) return null;
  return <p style={{ fontSize: 15 }}>{entry.description}</p>;
});
