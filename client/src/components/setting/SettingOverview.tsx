import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import { chroniclePaths } from "../../data/settingPage";
import { syncMentionLinks } from "../../mentions";
import { MentionText } from "../mentions/MentionText";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { isSafeImageUrl } from "../../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../../utils/fileUrl";
import { useSettingCalendar } from "../../hooks/useSettingCalendar";
import { plural } from "../../sceneKinds";
import { MAX_SIGNATURES, PASSPORT_FIELDS, PASSPORT_NOT_THIS, worldAffects, worldPath } from "../../settingWorld";
import { monthName as monthNameOf, seasonAt } from "../chronicle/time";
import type { Campaign, Setting, SettingCycle, SettingEntry, SettingPassport } from "../../types";

// «Обзор» сеттинга в «Д» (макет Set-Overview, блок «Сеттинги» 2026-10-30):
// герой — имя 64, жанры метками, факты и главная кнопка слева, обложка с
// подписью-описанием справа; ниже паспорт в тушь-рамке и кампании.

export interface SettingCounts {
  places: number;
  beings: number;
  communities: number;
  events: number;
  hasChronicle: boolean;
  hasAdventures: boolean;
  hasGallery: boolean;
  adventures: number;
  world: number;
}

const NO_ENTRIES: SettingEntry[] = [];
const NO_CYCLES: SettingCycle[] = [];

function passportText(p: SettingPassport): string {
  return [...PASSPORT_FIELDS.map((f) => p[f.key] ?? ""), p.not_this ?? "", ...(p.signature ?? [])].join("\n");
}

const ruDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");
const dayMonth = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

function campaignLine(c: Campaign): string {
  const held = c.held_sessions_count ?? 0;
  return [
    c.system_name,
    held ? `${held} ${plural(held, "сессия", "сессии", "сессий")}` : "не начата",
    c.status === "active" && c.next_planned_date ? `дальше ${dayMonth(c.next_planned_date)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const STATUS: Record<string, string> = { active: "идёт", paused: "пауза", completed: "завершена" };

export function SettingOverview({
  setting,
  campaigns,
  counts,
  saving,
  savePatch,
  onNewCampaign,
  onGenres,
  onWorld,
  onGallery,
}: {
  setting: Setting;
  campaigns: Campaign[];
  counts: SettingCounts | null;
  saving: boolean;
  savePatch: (patch: Partial<Setting>) => Promise<boolean>;
  onNewCampaign: () => void;
  onGenres: () => void;
  onWorld: () => void;
  onGallery: () => void;
}) {
  const run = useAction();
  const passport = setting.passport ?? {};
  const [draft, setDraft] = useState<SettingPassport | null>(null);
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const entries = useResource<SettingEntry[]>(worldPath(setting.id)).data ?? NO_ENTRIES;
  const promised = entries.filter((e) => e.category === "activity" && e.fields.promised === "1");
  const pinned = setting.pinned_calendar_year != null && setting.pinned_calendar_month != null;
  const calendar = useSettingCalendar(pinned ? setting.id : null);
  const cycles = useResource<SettingCycle[]>(pinned ? chroniclePaths.cycles(setting.id) : null).data ?? NO_CYCLES;

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
  const editPassport = () => setDraft({ ...passport, signature: [...signature] });
  const passportEmpty = !passportText(passport).trim();

  const months = calendar?.months ?? [];
  const monthName = pinned && months.length ? monthNameOf(months, setting.pinned_calendar_month!) : null;
  const season = pinned ? seasonAt(cycles, months, setting.pinned_calendar_year!, setting.pinned_calendar_month!) : null;
  const toneScale = [passport.tone, passport.scale].filter((v) => v?.trim()).join(" · ");

  return (
    <div className="set-ov">
      <header className="set-hero">
        <div className="set-hero__main">
          <div className="set-hero__file d-mono">
            <span>Сеттинг</span>
            {setting.code && <span>Код {setting.code}</span>}
            <span>С {ruDate(setting.created_at)}</span>
            {saving && <span aria-live="polite">Сохранение…</span>}
          </div>
          <h1 className="set-hero__title">{setting.name}</h1>
          <div className="set-hero__genres">
            {(setting.genres ?? []).map((g, i) => (
              <button key={i} type="button" className="set-gch" onClick={onGenres} title="Выбрать жанры">
                {g.subgenre ?? g.genre}
              </button>
            ))}
            <button type="button" className="set-gch is-add" onClick={onGenres}>
              + жанр
            </button>
          </div>
          <dl className="set-facts">
            <dt>Кампании</dt>
            <dd>{campaigns.length ? `${campaigns.length}${live ? ` · идёт ${live}` : ""}` : "пока нет"}</dd>
            {counts && (
              <>
                <dt>В мире</dt>
                <dd>
                  {counts.places} {plural(counts.places, "место", "места", "мест")} · {counts.beings} {plural(counts.beings, "существо", "существа", "существ")} ·{" "}
                  {counts.communities} {plural(counts.communities, "сообщество", "сообщества", "сообществ")} · {counts.world}{" "}
                  {plural(counts.world, "запись", "записи", "записей")}
                </dd>
              </>
            )}
            <dt>Сейчас</dt>
            <dd>
              {pinned ? (
                <>
                  {monthName ?? `${setting.pinned_calendar_month}-й месяц`} {setting.pinned_calendar_year}
                  {season && ` · ${season}`} <span className="d-note">· закреплён</span>
                </>
              ) : (
                <span className="muted">месяц не закреплён — в «Хронике»</span>
              )}
            </dd>
          </dl>
          <div className="set-hero__cta">
            {passportEmpty ? (
              <button type="button" className="d-btn d-btn--primary" onClick={editPassport}>
                Заполнить паспорт
              </button>
            ) : (
              <button type="button" className="d-btn d-btn--primary" onClick={onNewCampaign}>
                + Кампания в этом сеттинге
              </button>
            )}
          </div>
        </div>
        <figure className={`set-hero__cover${coverSrc ? "" : " is-empty"}`}>
          {coverSrc && <img src={coverSrc} alt={`Обложка: ${setting.name}`} />}
          <button type="button" className="set-hero__chg" onClick={onGallery}>
            {coverSrc ? "Обложка · из галереи" : "Обложка — в «Галерее»"}
          </button>
          {descDraft !== null ? (
            <div className="set-hero__edit">
              <MentionTextarea value={descDraft} onChange={setDescDraft} rows={3} defaultSettingId={setting.id} placeholder="Описание — пара фраз о мире" />
              <div className="row">
                <button type="button" className="d-btn d-btn--sm" onClick={saveDescription}>
                  Сохранить
                </button>
                <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={() => setDescDraft(null)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <figcaption>
              <button type="button" className="set-hero__caption" title="Править описание" onClick={() => setDescDraft(setting.description ?? "")}>
                {setting.description?.trim() ? <MentionText text={setting.description} /> : <span className="muted">+ Пара фраз о мире</span>}
              </button>
            </figcaption>
          )}
        </figure>
      </header>

      <div className="set-ov__cols">
        <section className="d-focal set-passport" aria-label="Паспорт">
          <div className="d-plate-row">
            <h2 className="d-plate">Паспорт</h2>
            {!draft && (
              <span className="d-end">
                <button type="button" className="d-btn d-btn--sm" onClick={editPassport}>
                  Править
                </button>
              </span>
            )}
          </div>

          {draft ? (
            <div className="setting-passport__form">
              {PASSPORT_FIELDS.map((f) => (
                <label key={f.key}>
                  <span className="paper-label">{f.label}</span>
                  <input type="text" value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} placeholder={f.hint} />
                </label>
              ))}
              <div>
                <span className="paper-label">Отличительные признаки · 3–5</span>
                {Array.from({ length: Math.min(MAX_SIGNATURES, (draft.signature?.length ?? 0) + 1) }, (_, i) => (
                  <input
                    type="text"
                    key={i}
                    aria-label={`Признак ${i + 1}`}
                    value={draft.signature?.[i] ?? ""}
                    onChange={(e) => {
                      const list = [...(draft.signature ?? [])];
                      list[i] = e.target.value;
                      setDraft({ ...draft, signature: list });
                    }}
                    placeholder={`Признак ${i + 1}`}
                  />
                ))}
              </div>
              <label>
                <span className="paper-label">{PASSPORT_NOT_THIS.label}</span>
                <input type="text" value={draft.not_this ?? ""} onChange={(e) => setDraft({ ...draft, not_this: e.target.value })} placeholder={PASSPORT_NOT_THIS.hint} />
              </label>
              <div className="row setting-passport__actions">
                <button type="button" className="d-btn" onClick={savePassport}>
                  Сохранить
                </button>
                <button type="button" className="d-btn d-btn--quiet" onClick={() => setDraft(null)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <dl className="set-passport__dl">
              {PASSPORT_FIELDS.filter((f) => f.key !== "tone" && f.key !== "scale").map((f) => (
                <PassportLine key={f.key} label={f.label} value={passport[f.key]} onEdit={editPassport} />
              ))}
              <dt>Признаки</dt>
              <dd>
                {signature.length ? (
                  <ol>
                    {signature.map((s, i) => (
                      <li key={i}>
                        <MentionText text={s} />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Empty onEdit={editPassport} />
                )}
              </dd>
              <PassportLine label="Тон · масштаб" value={toneScale} onEdit={editPassport} />
              <dt>Деятельность</dt>
              <dd className="set-passport__chips">
                {promised.map((e) => (
                  <button key={e.id} type="button" className="set-gch" onClick={onWorld} title="Открыть в «Мире»">
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
                    <button type="submit" className="d-btn d-btn--sm">
                      Добавить
                    </button>
                    <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={() => setActivity(null)}>
                      Отмена
                    </button>
                  </form>
                ) : (
                  <button type="button" className="set-gch is-add" onClick={() => setActivity("")}>
                    + Деятельность
                  </button>
                )}
              </dd>
              <PassportLine label={PASSPORT_NOT_THIS.label} value={passport.not_this} onEdit={editPassport} last />
            </dl>
          )}
        </section>

        <aside className="set-ov__side">
          <section className="d-block set-camps" aria-label="Кампании">
            <div className="d-plate-row">
              <h2 className="d-plate">Кампании</h2>
              <span className="d-note">{campaigns.length}</span>
            </div>
            {campaigns.length > 0 ? (
              campaigns.map((c) => (
                <Link key={c.id} className="set-camp" to={`/campaigns/${c.id}`}>
                  <b>{c.name}</b>
                  <small>{campaignLine(c)}</small>
                  <span className={`set-camp__st${c.status === "active" ? "" : " is-soft"}`}>{STATUS[c.status] ?? c.status}</span>
                </Link>
              ))
            ) : (
              <p className="muted">Кампаний в этом мире пока нет.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Empty({ onEdit }: { onEdit: () => void }) {
  return (
    <span className="set-passport__empty">
      — пусто ·{" "}
      <button type="button" onClick={onEdit}>
        заполнить
      </button>
    </span>
  );
}

function PassportLine({ label, value, onEdit, last }: { label: string; value?: string; onEdit: () => void; last?: boolean }) {
  return (
    <>
      <dt className={last ? "is-last" : undefined}>{label}</dt>
      <dd className={last ? "is-last" : undefined}>{value?.trim() ? <MentionText text={value} /> : <Empty onEdit={onEdit} />}</dd>
    </>
  );
}
