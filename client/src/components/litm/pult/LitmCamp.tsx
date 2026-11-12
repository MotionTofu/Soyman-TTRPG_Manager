import { useState, type ReactNode } from "react";
import { CAMP_STEPS, campDo, campPeriod, campStep, type LitmCampActivity, type LitmCampState, type LitmStoryTag } from "@shared/litm/conflict";
import { statusTier } from "@shared/litm/status";
import type { Character, LitMCharacterData } from "../../../types";
import { Status, Tag } from "../LitmBook";
import {
  expireBackpack,
  addRelationship,
  recoverFellowshipTag,
  reflectOn,
  relatedIds,
  restHero,
  scratchKey,
  useLitmSheet,
  type patchLitmSheet,
} from "./litmSheetWrite";
import "../litm-book.css";
import "./litm-pult.css";

type Sheet = (id: number, label: string, fields: Parameters<typeof patchLitmSheet>[2]) => Promise<void>;
/** Правка привала; `tags` — новые сюжетные теги сцены той же записью (шаг «Рюкзак»). */
type CampChange = (label: string, next: LitmCampState | null, tags?: LitmStoryTag[]) => void;

const ACTIVITY: Record<LitmCampActivity, string> = { rest: "Отдых", reflect: "Размышление", action: "Действие" };

interface Ctx {
  camp: LitmCampState;
  heroes: Character[];
  sheet: Sheet;
  note: (text: string) => void;
  /** Герой сходил на шаге (стража или время Содружества). */
  done: (id: number, a?: LitmCampActivity) => void;
}

/**
 * Привал пошаговой полосой (пульт v2, Q8, Q10–Q12; доска Litm-Pult-Camp):
 * рюкзак, место, две стражи и третья по желанию, время Содружества, сборы.
 * Всё, что выбрано, пишется в листы героев и в лог.
 */
export function LitmCampBar({
  camp,
  heroes,
  sceneTags,
  onChange,
  sheet,
  note,
}: {
  camp: LitmCampState;
  heroes: Character[];
  sceneTags: LitmStoryTag[];
  onChange: CampChange;
  sheet: Sheet;
  note: (text: string) => void;
}) {
  const title = camp.sojourn ? "Передышка" : "Привал";
  const go = (step: number) => onChange(`${title}: ${CAMP_STEPS[step - 1]}`, campStep(camp, step));
  const ctx: Ctx = {
    camp,
    heroes,
    sheet,
    note,
    done: (id, a) => onChange(`${title}: ${heroes.find((h) => h.id === id)?.character_name ?? "герой"}${a ? ` — ${ACTIVITY[a]}` : ""}`, campDo(camp, id, a)),
  };
  const period = campPeriod(camp);
  const last = camp.step === CAMP_STEPS.length;

  return (
    <section className="lp-cmp litm-book" aria-label={title}>
      <div className="lp-cmp__h">
        <b>{title}</b>
        <span className="d-seg" role="group" aria-label="Привал или передышка">
          {[false, true].map((s) => (
            <button key={String(s)} type="button" className={camp.sojourn === s ? "active" : ""} onClick={() => camp.sojourn !== s && onChange(s ? "Передышка" : "Привал", { ...camp, sojourn: s })}>
              {s ? "Передышка" : "Привал"}
            </button>
          ))}
        </span>
        <span className="lp-mono">{camp.sojourn ? "дни, недели, месяцы" : "пауза между сценами"} · A179–A181</span>
        <button type="button" className="d-btn d-btn--sm d-btn--ghost lp-cmp__x" onClick={() => onChange(`${title} отменён`, null)}>
          Отменить {camp.sojourn ? "передышку" : "привал"}
        </button>
      </div>

      <ol className="lp-csteps">
        {CAMP_STEPS.map((name, i) => {
          const n = i + 1;
          const cls = n < camp.step ? "is-done" : n === camp.step ? "is-now" : "";
          const meta = n === camp.step && (period || n === 6) ? `${n} · ${camp.done.length} из ${heroes.length}` : n === 5 ? `${n} · по желанию` : String(n);
          return (
            <li key={name} className={`${cls}${n === 5 ? " is-opt" : ""}`}>
              <button type="button" onClick={() => n !== camp.step && go(n)} aria-current={n === camp.step ? "step" : undefined}>
                <small>{meta}</small>
                {name}
              </button>
            </li>
          );
        })}
      </ol>

      {camp.step === 1 && (
        <BackpackStep ctx={ctx} sceneTags={sceneTags} onNext={(label, tags) => onChange(label ?? `${title}: ${CAMP_STEPS[1]}`, campStep(camp, 2), tags)} />
      )}
      {camp.step === 2 && (
        <p className="lp-cmp__hint">
          Место привала: теги и статусы стоянки — в полосу «Сцена» выше, Угроза — вызовом на ленту. Герои могут действовать, чтобы найти место получше.
        </p>
      )}
      {period && (
        <div className="lp-cmp__grid">
          {heroes.map((h) => (
            <PeriodCard key={`${h.id}:${camp.step}`} hero={h} ctx={ctx} />
          ))}
        </div>
      )}
      {camp.step === 6 && (
        <div className="lp-cmp__rows">
          {heroes.map((h) => (
            <FellowshipRow key={h.id} hero={h} ctx={ctx} />
          ))}
        </div>
      )}
      {last && <p className="lp-cmp__hint">Сборы в путь: история снова набирает ход — дальше новая сцена.</p>}

      <div className="lp-cmp__foot">
        <span className="lp-mono">
          {camp.step === 5
            ? "третья стража — только кто захотел, ценой Последствий"
            : period
              ? "Отдых и Размышление — по разу за привал, Действие — сколько угодно"
              : "всё пишется в листы героев и в лог"}
        </span>
        {camp.step > 1 && (
          <button type="button" className="d-btn d-btn--sm" onClick={() => go(camp.step - 1)}>
            ← {CAMP_STEPS[camp.step - 2]}
          </button>
        )}
        {last ? (
          <button type="button" className="d-btn d-btn--sm d-btn--primary" onClick={() => onChange(`${title} окончен — сборы в путь`, null)}>
            Свернуть {camp.sojourn ? "передышку" : "привал"}
          </button>
        ) : (
          <button type="button" className="d-btn d-btn--sm d-btn--primary" onClick={() => go(camp.step + 1)}>
            {CAMP_STEPS[camp.step]} →
          </button>
        )}
      </div>
    </section>
  );
}

const key = (id: number, tag: string) => `${id}\u0000${tag}`;

/** Шаг 1 (A179): сюжетные теги рюкзаков и сцены — отмеченные истекают. */
function BackpackStep({
  ctx,
  sceneTags,
  onNext,
}: {
  ctx: Ctx;
  sceneTags: LitmStoryTag[];
  onNext: (label?: string, tags?: LitmStoryTag[]) => void;
}) {
  const [marked, setMarked] = useState<string[]>([]);
  const toggle = (k: string) => setMarked((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]));

  async function expire() {
    for (const h of ctx.heroes) {
      const tags = marked.filter((k) => k.startsWith(`${h.id}\u0000`)).map((k) => k.slice(k.indexOf("\u0000") + 1));
      if (tags.length) await ctx.sheet(h.id, `${h.character_name}: истекло ${tags.join(", ")}`, expireBackpack(tags));
    }
    const gone = sceneTags.filter((t) => marked.includes(key(0, t.name)));
    setMarked([]);
    if (gone.length) onNext(`Истекло в сцене: ${gone.map((t) => t.name).join(", ")}`, sceneTags.filter((t) => !gone.includes(t)));
    else onNext();
  }

  return (
    <div className="lp-cmp__rows">
      {ctx.heroes.map((h) => (
        <BackpackRow key={h.id} hero={h} marked={marked} toggle={toggle} />
      ))}
      <div className="lp-cmp__row">
        <b>Сцена</b>
        <span className="lp-cmp__opts">
          {sceneTags.length === 0 && <span className="lp-mono">сюжетных тегов нет</span>}
          {sceneTags.map((t) => (
            <Check key={t.name} on={marked.includes(key(0, t.name))} onChange={() => toggle(key(0, t.name))}>
              <Tag weak={t.hindering}>{t.name}</Tag>
            </Check>
          ))}
        </span>
      </div>
      <div className="lp-cmp__acts">
        <button type="button" className="d-btn d-btn--sm d-btn--primary" disabled={!marked.length} onClick={() => void expire()}>
          Истечь отмеченные · {marked.length}
        </button>
        <button type="button" className="d-btn d-btn--sm" onClick={() => onNext()}>
          Ничего не истекает
        </button>
      </div>
    </div>
  );
}

function BackpackRow({ hero, marked, toggle }: { hero: Character; marked: string[]; toggle: (k: string) => void }) {
  const sheet = useLitmSheet(hero.id);
  const tags = sheet?.backpack ?? [];
  return (
    <div className="lp-cmp__row">
      <b>{hero.character_name}</b>
      <span className="lp-cmp__opts">
        {tags.length === 0 && <span className="lp-mono">{sheet ? "рюкзак пуст" : "листа нет"}</span>}
        {tags.map((t) => (
          <Check key={t} on={marked.includes(key(hero.id, t))} onChange={() => toggle(key(hero.id, t))}>
            <Tag>{t}</Tag>
          </Check>
        ))}
      </span>
    </div>
  );
}

function Check({ on, onChange, children, radio }: { on: boolean; onChange: () => void; children: ReactNode; radio?: boolean }) {
  return (
    <label className="lp-ck">
      <input type={radio ? "radio" : "checkbox"} checked={on} onChange={onChange} />
      {children}
    </label>
  );
}

/** Стража (A180–A181): Отдых, Размышление или Действие одного героя. */
function PeriodCard({ hero, ctx }: { hero: Character; ctx: Ctx }) {
  const sheet = useLitmSheet(hero.id);
  const used = ctx.camp.used[hero.id] ?? [];
  const went = ctx.camp.done.includes(hero.id);
  const [pick, setPick] = useState<LitmCampActivity | null>(null);
  const name = hero.character_name;

  return (
    <div className={`lp-pc${pick || went ? "" : " is-wait"}`}>
      <b>{name}</b>
      <span className="d-seg" role="group" aria-label={`Чем занят ${name}`}>
        {(["rest", "reflect", "action"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={`${pick === a ? "active" : ""}${used.includes(a) ? " is-used" : ""}`}
            disabled={went || used.includes(a)}
            title={used.includes(a) ? "Уже было на этом привале" : undefined}
            onClick={() => setPick(a)}
          >
            {ACTIVITY[a]}
          </button>
        ))}
      </span>
      {went && <p className="lp-pc__wait">✓ сходил в эту стражу</p>}
      {!went && !pick && <p className="lp-pc__wait">ещё не выбрал</p>}
      {!went && sheet && pick === "rest" && <RestBody name={name} sheet={sheet} ctx={ctx} id={hero.id} />}
      {!went && sheet && pick === "reflect" && <ReflectBody name={name} sheet={sheet} ctx={ctx} id={hero.id} />}
      {!went && pick === "action" && <ActionBody name={name} ctx={ctx} id={hero.id} />}
      {!went && !sheet && pick && pick !== "action" && <p className="lp-pc__wait">листа LitM нет</p>}
    </div>
  );
}

interface BodyProps {
  id: number;
  name: string;
  sheet: LitMCharacterData;
  ctx: Ctx;
}

/** Отдых: статусы и вычеркнутые теги — все отмечены, лишнее Мастер снимает (Q11). */
function RestBody({ id, name, sheet, ctx }: BodyProps) {
  const [off, setOff] = useState<string[]>([]);
  const flip = (k: string) => setOff((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));
  const statuses = sheet.statuses ?? [];
  const scratched = (["themes", "storyThemes"] as const).flatMap((kind) =>
    sheet[kind].flatMap((t, i) => (t.scratchedTags ?? []).map((tag) => ({ tag, k: scratchKey(kind, i, tag) })))
  );

  async function apply() {
    const names = statuses.map((s) => s.name).filter((n) => !off.includes(`s:${n}`));
    const tags = scratched.map((s) => s.k).filter((k) => !off.includes(k));
    await ctx.sheet(id, `${name}: отдых`, restHero(names, tags));
    ctx.done(id, "rest");
  }

  return (
    <>
      <span className="lp-mono">Истекают статусы{ctx.camp.sojourn ? " — и тяжёлые недуги" : ""}</span>
      {statuses.length === 0 && <span className="lp-pc__none">статусов нет</span>}
      {statuses.map((s) => (
        <Check key={s.name} on={!off.includes(`s:${s.name}`)} onChange={() => flip(`s:${s.name}`)}>
          <Status name={s.name} tier={statusTier(s.marks)} />
        </Check>
      ))}
      {scratched.length > 0 && <span className="lp-mono">Вернуть вычеркнутое</span>}
      {scratched.map((s) => (
        <Check key={s.k} on={!off.includes(s.k)} onChange={() => flip(s.k)}>
          <s className="lp-pc__scr">{s.tag}</s>
        </Check>
      ))}
      <button type="button" className="d-btn d-btn--sm d-btn--primary lp-pc__go" onClick={() => void apply()}>
        Применить
      </button>
    </>
  );
}

/** Размышление: +1 Рост теме или Содружеству; в передышке — «улучшение ждёт» (Q11). */
function ReflectBody({ id, name, sheet, ctx }: BodyProps) {
  const themes = [
    ...sheet.themes.map((t, i) => ({ ref: `themes:${i}`, t })),
    ...sheet.storyThemes.map((t, i) => ({ ref: `storyThemes:${i}`, t })),
  ].filter((x) => x.t.name);
  const all = [...themes, { ref: "fellowshipTheme", t: { ...sheet.fellowshipTheme, name: "Содружество" } }];
  const [ref, setRef] = useState(all[0].ref);
  const theme = all.find((x) => x.ref === ref)?.t ?? all[0].t;
  const sojourn = ctx.camp.sojourn;
  const full = !sojourn && theme.improve >= 3;

  async function apply() {
    await ctx.sheet(id, `${name}: ${sojourn ? "улучшение ждёт" : "+1 Рост"} — ${theme.name}`, reflectOn(ref, sojourn));
    ctx.done(id, "reflect");
  }

  return (
    <>
      <span className="lp-mono">Тема или Содружество</span>
      {all.map((x) => (
        <Check key={x.ref} radio on={x.ref === ref} onChange={() => setRef(x.ref)}>
          {x.t.name}
        </Check>
      ))}
      {sojourn ? (
        <span className="lp-pc__none">улучшение выбирают на листе героя</span>
      ) : (
        <span className="lp-pc__grow">
          Рост{" "}
          {[1, 2, 3].map((n) => (
            <u key={n} className={n <= theme.improve ? "is-m" : n === theme.improve + 1 ? "is-n" : ""} />
          ))}{" "}
          {full ? "полон — улучшение на листе" : `${theme.improve} → ${theme.improve + 1}`}
        </span>
      )}
      <button type="button" className="d-btn d-btn--sm d-btn--primary lp-pc__go" disabled={full} onClick={() => void apply()}>
        {sojourn ? "Улучшение ждёт" : "+1 Рост"}
      </button>
    </>
  );
}

/** Действие на привале — строкой в лог; Силу и эффекты Мастер ведёт, как в сцене (Q11). */
function ActionBody({ id, name, ctx }: Omit<BodyProps, "sheet">) {
  const [text, setText] = useState("");
  return (
    <>
      <span className="lp-mono">Чем занят — строкой в лог</span>
      <input className="d-input" value={text} placeholder="перевязывает раны…" onChange={(e) => setText(e.target.value)} />
      <span className="lp-pc__none">
        Сила — как в сцене{ctx.camp.sojourn ? "; в передышке +1 дни, +2 недели, +3 месяцы" : ""}
      </span>
      <button
        type="button"
        className="d-btn d-btn--sm d-btn--primary lp-pc__go"
        disabled={!text.trim()}
        onClick={() => {
          ctx.note(`${name}, действие на привале: ${text.trim()}`);
          ctx.done(id, "action");
        }}
      >
        В лог
      </button>
    </>
  );
}

/** Время Содружества (Q12, A181): вернуть тег темы Содружества или новый тег отношений. */
function FellowshipRow({ hero, ctx }: { hero: Character; ctx: Ctx }) {
  const sheet = useLitmSheet(hero.id);
  const scratched = sheet?.fellowshipTheme.scratchedTags ?? [];
  const related = sheet ? relatedIds(sheet) : [];
  // Новый тег — только с тем, с кем его ещё нет (A181).
  const others = ctx.heroes.filter((h) => h.id !== hero.id && !related.includes(h.id));
  const taken = others.length === 0;
  // Лист приходит после первой отрисовки — умолчания считаются от него, пока Мастер не выбрал сам.
  const [picked, setMode] = useState<"tag" | "rel" | "skip" | null>(null);
  const mode = picked ?? (scratched.length ? "tag" : taken ? "skip" : "rel");
  const [pickedTag, setTag] = useState("");
  const tag = scratched.includes(pickedTag) ? pickedTag : (scratched[0] ?? "");
  const [pickedTo, setTo] = useState(0);
  const to = others.some((h) => h.id === pickedTo) ? pickedTo : (others[0]?.id ?? 0);
  const [rel, setRel] = useState("");
  const name = hero.character_name;
  const went = ctx.camp.done.includes(hero.id);

  async function apply() {
    const other = others.find((h) => h.id === to);
    if (mode === "tag" && tag) await ctx.sheet(hero.id, `${name}: тег Содружества «${tag}» вернулся`, recoverFellowshipTag(tag));
    if (mode === "rel" && other && rel.trim()) {
      await ctx.sheet(hero.id, `${name} → ${other.character_name}: тег отношений «${rel.trim()}»`, addRelationship({ id: other.id, name: other.character_name }, rel.trim()));
    }
    ctx.done(hero.id);
  }

  if (went || !sheet) {
    return (
      <div className="lp-cmp__row">
        <b>{name}</b>
        <span className="lp-mono">{went ? "✓ записано" : "листа LitM нет"}</span>
      </div>
    );
  }
  return (
    <div className="lp-cmp__row">
      <b>{name}</b>
      <span className="lp-cmp__opts lp-cmp__opts--col">
        <Check radio on={mode === "tag"} onChange={() => setMode("tag")}>
          Вернуть тег Содружества
        </Check>
        {mode === "tag" &&
          (scratched.length ? (
            <select className="d-input lp-cmp__in" value={tag} onChange={(e) => setTag(e.target.value)}>
              {scratched.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          ) : (
            <span className="lp-pc__none lp-cmp__in">вычеркнутых тегов Содружества нет</span>
          ))}
        <Check radio on={mode === "rel"} onChange={() => setMode("rel")}>
          Новый тег отношений
        </Check>
        {mode === "rel" &&
          (taken ? (
            <span className="lp-pc__none lp-cmp__in">теги отношений уже есть со всеми героями</span>
          ) : (
            <span className="lp-cmp__in">
              <select className="d-input" value={to} aria-label="С кем" onChange={(e) => setTo(Number(e.target.value))}>
                {others.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.character_name}
                  </option>
                ))}
              </select>
              <input className="d-input" value={rel} placeholder="прикрою спину" onChange={(e) => setRel(e.target.value)} />
            </span>
          ))}
        <Check radio on={mode === "skip"} onChange={() => setMode("skip")}>
          Пропускает
        </Check>
      </span>
      <button
        type="button"
        className="d-btn d-btn--sm d-btn--primary"
        disabled={(mode === "tag" && !tag) || (mode === "rel" && (taken || !rel.trim()))}
        onClick={() => void apply()}
      >
        {mode === "skip" ? "Дальше" : "Записать в лист"}
      </button>
    </div>
  );
}
