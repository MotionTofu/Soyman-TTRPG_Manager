import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import { syncMentionLinks } from "../../mentions";
import { MentionText } from "../mentions/MentionText";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { isSafeImageUrl } from "../../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../../utils/fileUrl";
import { MAX_SIGNATURES, PASSPORT_FIELDS, PASSPORT_NOT_THIS, worldAffects, worldPath } from "../../settingWorld";
import type { Campaign, Setting, SettingEntry, SettingPassport } from "../../types";

// «Обзор» сеттинга на бумаге (разбор профиля сеттинга 2026-10-01, Q2; макет —
// холст «Профили», доска 11): слева обложка с описанием-подписью и короткие
// факты, справа паспорт, правка которого — тут же, и кампании.

export interface SettingCounts {
  places: number;
  beings: number;
  communities: number;
  events: number;
  adventures: number;
  world: number;
}

const NO_ENTRIES: SettingEntry[] = [];

function passportText(p: SettingPassport): string {
  return [...PASSPORT_FIELDS.map((f) => p[f.key] ?? ""), p.not_this ?? "", ...(p.signature ?? [])].join("\n");
}

export function SettingOverview({
  setting,
  campaigns,
  counts,
  savePatch,
  onNewCampaign,
  onGenres,
  onWorld,
}: {
  setting: Setting;
  campaigns: Campaign[];
  counts: SettingCounts | null;
  savePatch: (patch: Partial<Setting>) => Promise<boolean>;
  onNewCampaign: () => void;
  onGenres: () => void;
  onWorld: () => void;
}) {
  const run = useAction();
  const passport = setting.passport ?? {};
  const [draft, setDraft] = useState<SettingPassport | null>(null);
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const entries = useResource<SettingEntry[]>(worldPath(setting.id)).data ?? NO_ENTRIES;
  const promised = entries.filter((e) => e.category === "activity" && e.fields.promised === "1");

  const cover = setting.thumbnail_image_url && isSafeImageUrl(setting.thumbnail_image_url) ? setting.thumbnail_image_url : null;
  const authCover = useAuthenticatedFileUrl(cover);
  const coverSrc = cover?.startsWith("/files/") ? authCover : cover;

  async function savePassport() {
    if (!draft) return;
    const next: SettingPassport = { ...draft, signature: (draft.signature ?? []).map((s) => s.trim()).filter(Boolean) };
    if (await savePatch({ passport: next })) {
      await syncMentionLinks("setting", setting.id, passportText(passport), passportText(next));
      setDraft(null);
    }
  }

  async function saveDescription() {
    if (descDraft === null) return;
    if (await savePatch({ description: descDraft })) {
      await syncMentionLinks("setting", setting.id, setting.description ?? "", descDraft);
      setDescDraft(null);
    }
  }

  // «+ Деятельность» из паспорта (Q9) создаёт запись «Мира» с галочкой «обещано».
  async function addActivity() {
    const title = activity?.trim();
    if (!title) return setActivity(null);
    const done = await run(
      () =>
        write.post("/setting-entries", {
          setting_id: setting.id,
          category: "activity",
          title,
          fields: { promised: "1" },
        }),
      { affects: worldAffects(setting.id), retry: false }
    );
    if (done) setActivity(null);
  }

  const live = campaigns.filter((c) => c.status === "active").length;
  const signature = passport.signature ?? [];

  return (
    <div className="dossier setting-overview">
      <aside className="dossier__aside">
        <figure className="setting-cover">
          {coverSrc ? (
            <img src={coverSrc} alt={`Обложка: ${setting.name}`} />
          ) : (
            <span className="setting-cover__empty">Обложка — в «Галерее»</span>
          )}
          {descDraft !== null ? (
            <div className="setting-cover__edit">
              <MentionTextarea value={descDraft} onChange={setDescDraft} rows={3} defaultSettingId={setting.id} placeholder="Описание — пара фраз о мире" />
              <div className="row">
                <button type="button" className="primary" onClick={saveDescription}>
                  Сохранить
                </button>
                <button type="button" onClick={() => setDescDraft(null)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <figcaption>
              <button type="button" className="setting-cover__caption" title="Править описание" onClick={() => setDescDraft(setting.description ?? "")}>
                {setting.description?.trim() ? <MentionText text={setting.description} /> : <span className="muted">+ Пара фраз о мире</span>}
              </button>
            </figcaption>
          )}
        </figure>
        <dl className="paper-facts">
          {setting.code && (
            <div>
              <dt className="paper-label">Код для ссылок</dt>
              <dd>{setting.code}</dd>
            </div>
          )}
          <div>
            <dt className="paper-label">Кампании</dt>
            <dd>
              {campaigns.length}
              {live > 0 && ` · идёт ${live}`}
            </dd>
          </div>
          {counts && (
            <div>
              <dt className="paper-label">В мире</dt>
              <dd>
                {counts.places} мест · {counts.beings} существ · {counts.communities} сообществ
              </dd>
            </div>
          )}
        </dl>
      </aside>

      <div className="dossier__main">
        <section className="setting-passport" aria-label="Паспорт">
          <header className="setting-passport__head">
            <h2 className="paper-group__head">Паспорт</h2>
            {!draft && (
              <button type="button" onClick={() => setDraft({ ...passport, signature: [...signature] })}>
                Править
              </button>
            )}
          </header>

          {draft ? (
            <div className="setting-passport__form">
              {PASSPORT_FIELDS.map((f) => (
                <label key={f.key}>
                  <span className="paper-label">{f.label}</span>
                  <MentionTextarea
                    value={draft[f.key] ?? ""}
                    onChange={(v) => setDraft({ ...draft, [f.key]: v })}
                    rows={f.key === "tone" || f.key === "scale" ? 1 : 2}
                    placeholder={f.hint}
                    defaultSettingId={setting.id}
                  />
                </label>
              ))}
              <div>
                <span className="paper-label">Отличительные признаки · 3–5, можно с @</span>
                {Array.from({ length: Math.min(MAX_SIGNATURES, (draft.signature?.length ?? 0) + 1) }, (_, i) => (
                  <MentionTextarea
                    key={i}
                    value={draft.signature?.[i] ?? ""}
                    onChange={(v) => {
                      const list = [...(draft.signature ?? [])];
                      list[i] = v;
                      setDraft({ ...draft, signature: list });
                    }}
                    rows={1}
                    placeholder={`Признак ${i + 1}`}
                    defaultSettingId={setting.id}
                  />
                ))}
              </div>
              <label>
                <span className="paper-label">{PASSPORT_NOT_THIS.label}</span>
                <MentionTextarea
                  value={draft.not_this ?? ""}
                  onChange={(v) => setDraft({ ...draft, not_this: v })}
                  rows={2}
                  placeholder={PASSPORT_NOT_THIS.hint}
                  defaultSettingId={setting.id}
                />
              </label>
              <div className="row">
                <button type="button" className="primary" onClick={savePassport}>
                  Сохранить
                </button>
                <button type="button" onClick={() => setDraft(null)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <dl className="setting-passport__view">
              {PASSPORT_FIELDS.filter((f) => f.key !== "tone" && f.key !== "scale").map((f) => (
                <PassportLine key={f.key} label={f.label} value={passport[f.key]} hint={f.hint} onEdit={() => setDraft({ ...passport, signature: [...signature] })} />
              ))}
              <div>
                <dt className="paper-label">Отличительные признаки</dt>
                <dd>
                  {signature.length ? (
                    <ol className="setting-passport__signs">
                      {signature.map((s, i) => (
                        <li key={i}>
                          <MentionText text={s} />
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <button type="button" className="setting-passport__empty" onClick={() => setDraft({ ...passport, signature: [] })}>
                      + Три-пять черт, по которым мир узнают
                    </button>
                  )}
                </dd>
              </div>
              <div>
                <dt className="paper-label">Жанр</dt>
                <dd>
                  <button type="button" className="setting-passport__inline" onClick={onGenres} title="Выбрать жанры">
                    {setting.genres?.length ? setting.genres.map((g) => g.subgenre ?? g.genre).join(" · ") : "+ Жанр"}
                  </button>
                </dd>
              </div>
              <PassportLine label="Тон" value={passport.tone} hint="Мрачно, легко, нуар, сказка…" onEdit={() => setDraft({ ...passport, signature: [...signature] })} />
              <PassportLine label="Масштаб" value={passport.scale} hint="Квартал, город, континент…" onEdit={() => setDraft({ ...passport, signature: [...signature] })} />
              <div>
                <dt className="paper-label">Обещанная деятельность</dt>
                <dd className="setting-passport__chips">
                  {promised.map((e) => (
                    <button key={e.id} type="button" className="badge tag" onClick={onWorld} title="Открыть в «Мире»">
                      {e.title}
                    </button>
                  ))}
                  {activity !== null ? (
                    <form
                      className="setting-passport__add"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void addActivity();
                      }}
                    >
                      <input autoFocus value={activity} onChange={(e) => setActivity(e.target.value)} placeholder="Расследование, интрига…" aria-label="Название деятельности" />
                      <button type="submit" className="primary">
                        Добавить
                      </button>
                      <button type="button" onClick={() => setActivity(null)}>
                        Отмена
                      </button>
                    </form>
                  ) : (
                    <button type="button" className="setting-passport__empty" onClick={() => setActivity("")}>
                      + Деятельность
                    </button>
                  )}
                </dd>
              </div>
              <PassportLine
                label={PASSPORT_NOT_THIS.label}
                value={passport.not_this}
                hint={PASSPORT_NOT_THIS.hint}
                onEdit={() => setDraft({ ...passport, signature: [...signature] })}
              />
            </dl>
          )}
        </section>

        <section className="paper-groups" aria-label="Кампании">
          <h2 className="paper-group__head">
            Кампании <span className="paper-group__count">· {campaigns.length}</span>
            <button type="button" className="setting-passport__empty" onClick={onNewCampaign}>
              + Новая кампания
            </button>
          </h2>
          {campaigns.length > 0 ? (
            <ul className="paper-rows">
              {campaigns.map((c) => (
                <li key={c.id}>
                  <Link className="paper-rows__main" to={`/campaigns/${c.id}`}>
                    {c.name}
                  </Link>
                  <span className="paper-rows__sub">
                    {[c.system_name, c.status === "active" ? "идёт" : null, c.next_planned_date ? `следующая: ${c.next_planned_date}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Кампаний в этом мире пока нет.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function PassportLine({ label, value, hint, onEdit }: { label: string; value?: string; hint: string; onEdit: () => void }) {
  return (
    <div>
      <dt className="paper-label">{label}</dt>
      <dd>
        {value?.trim() ? (
          <MentionText text={value} />
        ) : (
          <button type="button" className="setting-passport__empty" onClick={onEdit}>
            + {hint}
          </button>
        )}
      </dd>
    </div>
  );
}
