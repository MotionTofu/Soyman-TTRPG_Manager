import { useState, type ReactNode } from "react";
import type { LitMCharacterData, LitMPower, LitMThemeCard } from "../../types";
import { MentionText } from "../mentions/MentionText";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MightMark, Tag } from "./LitmBook";
import type { LitmMight } from "./litmBookText";
import { LitmStatusCards } from "./LitmStatusCards";
import { LitmTableStrip } from "./LitmTableStrip";
import { emptyTheme, ImprovementsEdit, ThemePickers } from "./ThemeCard";
import { TrackGroup } from "./TrackGroup";
import "./litm-sheet.css";

const MIGHTS: LitmMight[] = ["origin", "adventure", "greatness", "variable"];
const MIGHT_RU: Record<LitmMight, string> = { origin: "Происхождение", adventure: "Приключение", greatness: "Величие", variable: "Переменное" };
const asMight = (p: string): LitmMight | null => (MIGHTS.includes(p as LitmMight) ? (p as LitmMight) : null);

/**
 * Лист героя LitM в «Д» (доски Litm-Sheet-Status, Litm-Sheet-Edit; гриллинг
 * визарда 2026-11-13, Q13): просмотр и правка — один вид. В правке поля
 * правятся там, где стоят: ✕ у тега, «+ тег», пустое — строкой «+ Поле».
 * В просмотре нажатие на тег силы вычёркивает его (Q10 пульта LitM).
 */
export function LitmSheet({
  value,
  edit,
  onChange,
  campaignId,
  characterId,
  onMakeGroupTheme,
  companion,
}: {
  value: LitMCharacterData;
  edit: boolean;
  onChange: (v: LitMCharacterData) => void;
  campaignId?: number;
  characterId?: number;
  onMakeGroupTheme?: () => void;
  /** Поле спутника (перетаскивание персонажа) — только в правке. */
  companion?: ReactNode;
}) {
  const set = <K extends keyof LitMCharacterData>(k: K, v: LitMCharacterData[K]) => onChange({ ...value, [k]: v });
  const setAt = (key: "themes" | "storyThemes", i: number, t: LitMThemeCard) => set(key, value[key].map((x, k) => (k === i ? t : x)));
  const dropAt = (key: "themes" | "storyThemes", i: number) => set(key, value[key].filter((_, k) => k !== i));
  const rels = value.relationships ?? [];

  return (
    <div className={`lsh litm-book${edit ? " is-edit" : ""}`}>
      {edit && <p className="lsh-editbar">Правка листа · поля правятся там, где стоят · ✕ — убрать · «+» — добавить</p>}
      <header className="lsh-head">
        {edit ? (
          <input className="lsh-name" aria-label="Имя героя" placeholder="Имя героя" value={value.characterName} onChange={(e) => set("characterName", e.target.value)} />
        ) : (
          <h2 className="lsh-name">{value.characterName || "Без имени"}</h2>
        )}
        <span className="lsh-meta">
          Legend in the Mist ·{" "}
          {edit ? (
            <input aria-label="Игрок" placeholder="игрок" value={value.playerName} onChange={(e) => set("playerName", e.target.value)} />
          ) : (
            value.playerName && `игрок ${value.playerName}`
          )}
        </span>
      </header>

      <div className="lsh-grid">
        <div className="lsh-col">
          <div className="lsh-cards">
            {value.themes.map((t, i) => (
              <SheetTheme key={i} theme={t} edit={edit} onChange={(v) => setAt("themes", i, v)} onRemove={edit ? () => dropAt("themes", i) : undefined} />
            ))}
          </div>
          {edit && (
            <button type="button" className="lsh-plus" onClick={() => set("themes", [...value.themes, emptyTheme()])}>
              <b>+</b> Тема
            </button>
          )}

          {(edit || value.storyThemes.some((t) => t.name || t.powerTags.length)) && <div className="lb-lbl lsh-sub">Сюжетные темы</div>}
          <div className="lsh-cards">
            {value.storyThemes
              .map((t, i) => ({ t, i }))
              .filter(({ t }) => edit || t.name || t.powerTags.length)
              .map(({ t, i }) => (
                <SheetTheme key={i} kind="story" theme={t} edit={edit} onChange={(v) => setAt("storyThemes", i, v)} onRemove={edit && value.storyThemes.length > 1 ? () => dropAt("storyThemes", i) : undefined} />
              ))}
          </div>
          {edit && (
            <button type="button" className="lsh-plus" onClick={() => set("storyThemes", [...value.storyThemes, emptyTheme()])}>
              <b>+</b> Сюжетная тема
            </button>
          )}

          {(edit || value.fellowshipTheme.name || value.fellowshipTheme.powerTags.length > 0) && (
            <>
              <div className="lb-lbl lsh-sub">Тема Содружества</div>
              <div className="lsh-cards">
                <SheetTheme kind="fellowship" theme={value.fellowshipTheme} edit={edit} onChange={(v) => set("fellowshipTheme", v)} onMakeGroupTheme={onMakeGroupTheme} />
              </div>
            </>
          )}
        </div>

        <aside className="lsh-side">
          {!edit && <LitmTableStrip campaignId={campaignId} characterId={characterId} />}
          {!edit && <LitmStatusCards statuses={value.statuses ?? []} onChange={(update) => set("statuses", update(value.statuses ?? []))} />}

          <section className="lsh-blk">
            <div className="lb-lbl">
              Рюкзак<small>сюжетные теги героя</small>
            </div>
            <EditTags tags={value.backpack} kind="ts" onChange={(b) => set("backpack", b)} add="+ тег" />
          </section>

          {(edit || rels.length > 0 || value.companionCharacterName || value.companionRelationshipTag) && (
            <section className="lsh-blk">
              <div className="lb-lbl">Отношения</div>
              <div className="lb-tags">
                {rels.map((r) => (
                  <span key={r.characterId} className="lsh-tagx">
                    <span className="lb-ts">
                      {r.name}: {r.tag}
                    </span>
                    <button type="button" aria-label={`Убрать тег отношений с ${r.name}`} onClick={() => set("relationships", rels.filter((x) => x.characterId !== r.characterId))}>
                      ✕
                    </button>
                  </span>
                ))}
                {!edit && (value.companionCharacterName || value.companionRelationshipTag) && (
                  <span className="lb-ts">{[value.companionCharacterName, value.companionRelationshipTag].filter(Boolean).join(": ")}</span>
                )}
              </div>
              {edit && companion}
            </section>
          )}

          <TextField label="Обещание" value={value.promise} edit={edit} onChange={(v) => set("promise", v)} />
          <TextField label="Квест героя" value={value.quest} edit={edit} onChange={(v) => set("quest", v)} />
          <TextField label="Связь с Содружеством" value={value.fellowshipRelationship} edit={edit} onChange={(v) => set("fellowshipRelationship", v)} />
          <TextField label="Квинтэссенции" value={value.quintessences} edit={edit} multiline onChange={(v) => set("quintessences", v)} />
          <TextField label="Особые улучшения" value={value.specialImprovements} edit={edit} multiline onChange={(v) => set("specialImprovements", v)} />
          <TextField label="Заметки" value={value.notes} edit={edit} multiline onChange={(v) => set("notes", v)} />
        </aside>
      </div>
    </div>
  );
}

/** Поле листа: в просмотре — только если заполнено; в правке пустое — строкой «+ Поле», нажатие открывает поле на месте. */
function TextField({ label, value, edit, multiline, onChange }: { label: string; value: string; edit: boolean; multiline?: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!edit) {
    if (!value.trim()) return null;
    return (
      <section className="lsh-blk">
        <div className="lb-lbl">{label}</div>
        <div className="lsh-text">{multiline ? <MentionText text={value} /> : value}</div>
      </section>
    );
  }
  if (!value && !open) {
    return (
      <button type="button" className="lsh-plus" onClick={() => setOpen(true)}>
        <b>+</b> {label}
        <small>пусто</small>
      </button>
    );
  }
  return (
    <label className="lsh-blk">
      <span className="lb-lbl">{label}</span>
      {multiline ? (
        <MentionTextarea value={value} onChange={onChange} rows={3} />
      ) : (
        <input className="d-field" autoFocus={open && !value} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

/** Теги с ✕ и «+ тег» на месте. В просмотре теги силы вычёркиваются нажатием. */
function EditTags({
  tags,
  kind,
  onChange,
  add,
  scratched,
  onScratch,
  editable = true,
}: {
  tags: string[];
  kind: "tg" | "tw" | "ts";
  /** Без ✕ и «+»: теги темы в просмотре. */
  editable?: boolean;
  onChange: (t: string[]) => void;
  add: string;
  scratched?: string[];
  onScratch?: (t: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const t = (draft ?? "").trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft(null);
  };
  return (
    <div className="lb-tags lsh-tags">
      {tags.map((t, i) => {
        const x = scratched?.includes(t);
        return (
          <span key={t + i} className="lsh-tagx">
            {onScratch ? (
              <button type="button" className={`lb-${kind}${x ? " is-x" : ""}`} aria-pressed={x} title={x ? "Вернуть тег" : "Вычеркнуть тег"} onClick={() => onScratch(t)}>
                {t}
              </button>
            ) : (
              <span className={`lb-${kind}`}>{t}</span>
            )}
            {editable && (
              <button type="button" aria-label={`Убрать «${t}»`} onClick={() => onChange(tags.filter((_, k) => k !== i))}>
                ✕
              </button>
            )}
          </span>
        );
      })}
      {!editable ? null : draft === null ? (
        <button type="button" className="lsh-add" onClick={() => setDraft("")}>
          {add}
        </button>
      ) : (
        <input
          className="lsh-inl"
          autoFocus
          value={draft}
          aria-label={add}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(null);
            }
          }}
        />
      )}
    </div>
  );
}

/** Карта темы: тег-название, теги силы и слабости, Квест, Рост / Увядание / Веха. */
function SheetTheme({
  theme,
  edit,
  onChange,
  onRemove,
  kind = "theme",
  onMakeGroupTheme,
}: {
  theme: LitMThemeCard;
  edit: boolean;
  onChange: (t: LitMThemeCard) => void;
  onRemove?: () => void;
  kind?: "theme" | "story" | "fellowship";
  onMakeGroupTheme?: () => void;
}) {
  const [questOpen, setQuestOpen] = useState(false);
  const m = asMight(theme.power);
  const scratched = theme.scratchedTags ?? [];
  const scratch = (tag: string) => onChange({ ...theme, scratchedTags: scratched.includes(tag) ? scratched.filter((x) => x !== tag) : [...scratched, tag] });
  const tone = kind === "theme" ? `lsh-m--${m ?? "none"}` : `lsh-m--${kind}`;
  const label = kind === "story" ? "Сюжетная тема" : kind === "fellowship" ? "Содружество" : m ? MIGHT_RU[m] : "Могущество не задано";

  return (
    <article className={`lsh-tc ${tone}`}>
      <div className="lsh-tc-top">
        {edit && kind === "theme" ? (
          <select className="lsh-might" aria-label="Могущество" value={theme.power} onChange={(e) => onChange({ ...theme, power: e.target.value as LitMPower })}>
            <option value="">Могущество —</option>
            {MIGHTS.map((x) => (
              <option key={x} value={x}>
                {MIGHT_RU[x]}
              </option>
            ))}
          </select>
        ) : m && kind === "theme" ? (
          <MightMark might={m} label={`${MIGHT_RU[m]}${theme.themeType ? ` · ${theme.themeType}` : ""}`} />
        ) : (
          <span className="lb-mt">{label}</span>
        )}
        {edit && kind === "theme" && <input className="lsh-type" aria-label="Тип темы" placeholder="тип темы" value={theme.themeType} onChange={(e) => onChange({ ...theme, themeType: e.target.value })} />}
        {onRemove && (
          <button type="button" className="lsh-x" aria-label="Удалить тему" onClick={onRemove}>
            ✕
          </button>
        )}
      </div>
      {edit ? (
        <input className="lsh-tname" aria-label="Название темы" placeholder="Название темы — её главный тег" value={theme.name} onChange={(e) => onChange({ ...theme, name: e.target.value })} />
      ) : (
        <h3 className="lsh-tname">{theme.name || "Без названия"}</h3>
      )}
      <div className="lsh-tl">
        {theme.name &&
          (edit ? (
            <Tag>{theme.name}</Tag>
          ) : (
            <button type="button" className={`lb-tg is-title${scratched.includes(theme.name) ? " is-x" : ""}`} aria-pressed={scratched.includes(theme.name)} title="Вычеркнуть / вернуть" onClick={() => scratch(theme.name)}>
              {theme.name}
            </button>
          ))}
        <EditTags tags={theme.powerTags} kind="tg" add="+ тег силы" onChange={(t) => onChange({ ...theme, powerTags: t })} scratched={edit ? undefined : scratched} onScratch={edit ? undefined : scratch} editable={edit} />
        <EditTags tags={theme.weaknessTags} kind="tw" add="+ слабость" onChange={(t) => onChange({ ...theme, weaknessTags: t })} editable={edit} />
      </div>
      {edit ? (
        theme.quest || questOpen ? (
          <label className="lsh-q">
            Квест:
            <input autoFocus={questOpen && !theme.quest} value={theme.quest} onChange={(e) => onChange({ ...theme, quest: e.target.value })} />
          </label>
        ) : (
          <button type="button" className="lsh-plus" onClick={() => setQuestOpen(true)}>
            <b>+</b> Квест темы<small>пусто</small>
          </button>
        )
      ) : (
        theme.quest && <p className="lsh-q">Квест: «{theme.quest}»</p>
      )}
      <TrackGroup
        tracks={[
          { label: "Рост", value: theme.improve, onChange: (n) => onChange({ ...theme, improve: n }) },
          { label: "Увядание", value: theme.abandon, onChange: (n) => onChange({ ...theme, abandon: n }) },
          { label: "Веха", value: theme.milestone, onChange: (n) => onChange({ ...theme, milestone: n }) },
        ]}
      />
      {theme.improvementPending && (
        <button type="button" className="litm-pending" title="Положено после передышки: отметьте улучшение темы и снимите метку" onClick={() => onChange({ ...theme, improvementPending: undefined })}>
          Улучшение ждёт ✕
        </button>
      )}
      {edit ? (
        <ImprovementsEdit items={theme.specialImprovements} onChange={(items) => onChange({ ...theme, specialImprovements: items })} />
      ) : (
        theme.specialImprovements.some((x) => x.active) && (
          <ul className="lsh-imps">
            {theme.specialImprovements
              .filter((x) => x.active)
              .map((x, i) => (
                <li key={i}>{x.text}</li>
              ))}
          </ul>
        )
      )}
      {edit && <ThemePickers value={theme} onChange={onChange} />}
      {onMakeGroupTheme && (
        <button type="button" className="d-btn d-btn--sm" onClick={onMakeGroupTheme}>
          Сделать общей для партии
        </button>
      )}
    </article>
  );
}
