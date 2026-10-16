import { useState } from "react";
import { useAction, write } from "../../data/hooks";
import type { Affect } from "../../data/entities";
import { PARTICIPATION_FIELDS } from "../../beingForce";
import type { BeingChapter, BeingParticipation } from "../../types";
import { MentionText } from "../mentions/MentionText";
import { MentionTextarea } from "../mentions/MentionTextarea";

/**
 * «Ход в кампании» существа (Q7): глава «Текущая ситуация» с этой кампанией.
 * Нет главы — «Править» её заводит. Общий для профиля в контексте кампании и
 * листа «Сторона и отношения» тетради кампании.
 */
export function CampaignMove({
  being,
  campaignId,
  live,
  affects,
}: {
  being: { id: number; setting_id: number; chapters: BeingChapter[] };
  campaignId: number;
  live: boolean;
  affects: Affect[];
}) {
  const run = useAction();
  const chapter = being.chapters.find((c) => c.section === "current_situation" && c.campaign_id === campaignId);
  async function add() {
    await run(
      () => write.post(`/setting-beings/${being.id}/chapters`, { section: "current_situation", campaign_id: campaignId, title: "" }),
      { affects, retry: false },
    );
  }
  if (chapter) return <Participation chapter={chapter} live={live} settingId={being.setting_id} affects={affects} title="Ход в кампании" />;
  return (
    <section className="participation">
      <h3 className="paper-group__head">Ход в кампании</h3>
      <span className="muted">Цель, план, что будет без вмешательства — пока не записаны.</span>
      <div className="participation__actions">
        <button type="button" className="comp-mini" onClick={() => void add()}>
          Править
        </button>
      </div>
    </section>
  );
}

// «В кампании X» (Q7, Q14): участие существа — поля контекста на главе
// «Текущая ситуация» этой кампании плюс её текст. У идущей сессии раскрыто,
// у остальных кампаний свёрнуто.
function Participation({
  chapter,
  live,
  settingId,
  affects,
  title,
}: {
  chapter: BeingChapter;
  live: boolean;
  settingId: number;
  affects: Affect[];
  /** В контексте кампании — «Ход в кампании», раскрыт всегда. */
  title?: string;
}) {
  const run = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BeingParticipation>({});
  const [content, setContent] = useState("");
  const fields = chapter.participation ?? {};
  const filled = PARTICIPATION_FIELDS.filter((f) => fields[f.key]?.trim());

  function startEdit() {
    setDraft(fields);
    setContent(chapter.content);
    setEditing(true);
  }

  async function save() {
    const done = await run(
      () =>
        write
          .put(`/setting-beings/chapters/${chapter.id}`, {
            participation: draft,
            content,
          })
          .then(() => true),
      { affects },
    );
    if (done) setEditing(false);
  }

  return (
    <details className="paper-fold participation" open={live || !!title || undefined}>
      <summary>
        {title ?? `В кампании «${chapter.campaign_name}»`}
        {live && <span className="participation__live">идёт сессия</span>}
      </summary>
      <div className="paper-fold__body">
        {editing ? (
          <div className="stack">
            {PARTICIPATION_FIELDS.map((f) => (
              <label key={f.key} className="stack">
                <span className="editable-card-field-label">{f.label}</span>
                <MentionTextarea
                  value={draft[f.key] ?? ""}
                  onChange={(v) =>
                    setDraft((prev) => ({ ...prev, [f.key]: v }))
                  }
                  rows={2}
                  autoGrow
                  defaultSettingId={settingId}
                />
              </label>
            ))}
            <label className="stack">
              <span className="editable-card-field-label">Заметка</span>
              <MentionTextarea
                value={content}
                onChange={setContent}
                rows={3}
                autoGrow
                defaultSettingId={settingId}
              />
            </label>
            <div className="participation__actions">
              <button type="button" className="primary" onClick={save}>
                Сохранить
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <>
            {filled.length > 0 ? (
              <dl className="participation__grid">
                {filled.map((f) => (
                  <div key={f.key}>
                    <dt className="paper-label">{f.label}</dt>
                    <dd>
                      <MentionText text={fields[f.key] ?? ""} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="muted">
                Цель, план, что будет без вмешательства — пока не записаны.
              </span>
            )}
            {chapter.content.trim() && <MentionText text={chapter.content} />}
            <div className="participation__actions">
              <button type="button" className="comp-mini" onClick={startEdit}>
                Править участие
              </button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

