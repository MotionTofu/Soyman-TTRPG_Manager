import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal } from "../Modal";
import { readResource } from "../../data/imperative";
import { useConfirm } from "../../hooks/useConfirm";
import type { Character, CompendiumEntry, LitMCharacterData } from "../../types";
import { MightMark, Tag } from "./LitmBook";
import type { LitmMight } from "./litmBookText";
import { findKit, findLitmSystemId, loadLitmThemeBooks, loadLitmThemeKits, loadLitmTropes, tropeKitRef, type LitmThemeKit } from "./litmCompendium";
import { storeOf, type StoreCategory } from "./litmStore";
import {
  POWER_NEED,
  WEAK_NEED,
  applyTrope,
  buildHero,
  chooseKit,
  draftTheme,
  emptyHero,
  fillChoice,
  hasChoice,
  reviewChecks,
  setPath,
  setThemeMode,
  setThemeType,
  stepLabel,
  stepReady,
  stepsFor,
  themeGaps,
  themePower,
  themeWeak,
  toggleTag,
  type HeroDraft,
  type HeroPath,
  type StepId,
  type ThemeDraft,
  type ThemeMode,
  type WizardBook,
} from "./heroWizard";
import "./litm-hero-wizard.css";

const MIGHTS: LitmMight[] = ["origin", "adventure", "greatness", "variable"];
const MIGHT_HINT: Record<LitmMight, string> = {
  origin: "обыденное: кто вы и откуда",
  adventure: "выше обычного",
  greatness: "грандиозное",
  variable: "Могущество — по тому, что выберете",
};
const PATH_NAME: Record<HeroPath, string> = { simple: "простейший", quick: "быстрый", detail: "подробный" };
const asMight = (m: string): LitmMight | null => (MIGHTS.includes(m as LitmMight) ? (m as LitmMight) : null);
const letter = (i: number) => String.fromCharCode(65 + i);

interface Hero {
  id: number;
  name: string;
}

/**
 * Визард героя LitM в «Д» (гриллинг 2026-11-13, доски Litm-Wiz-*): путь книги,
 * троп, типы тем, темы набором / анкетой / вручную, рюкзак, отношения, досье,
 * обзор. На ПК окно со столбцом карточки героя; на телефоне — весь экран,
 * карточка шторкой по ◧. Черновик остаётся в окне до успешного создания листа.
 */
export function LitmHeroWizard({
  ownerId,
  ownerName,
  ownerPlayerName,
  campaignId,
  onComplete,
  onCancel,
}: {
  ownerId?: number;
  ownerName?: string;
  ownerPlayerName?: string;
  campaignId?: number;
  onComplete: (fields: Partial<LitMCharacterData>) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<HeroDraft>(() => emptyHero(ownerName ?? "", ownerPlayerName ?? ""));
  const [at, setAt] = useState(0);
  const [reached, setReached] = useState(0);
  const [preview, setPreview] = useState(false);
  const [book, setBook] = useState<WizardBook | null>(null);
  const [store, setStore] = useState<StoreCategory[]>([]);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [confirmDialog, confirm] = useConfirm();

  useEffect(() => {
    let live = true;
    (async () => {
      const sys = await findLitmSystemId();
      if (!sys) throw new Error("нет системы LitM");
      const sections = await readResource<{ id: number; kind: string }[]>(`/systems/${sys}/sections`);
      const shop = sections.find((s) => s.kind === "mechanic_backpack_category");
      const [tropes, books, kits, shopEntries, cast] = await Promise.all([
        loadLitmTropes(sys),
        loadLitmThemeBooks(sys),
        loadLitmThemeKits(sys),
        shop ? readResource<CompendiumEntry[]>(`/systems/${sys}/entries?section_id=${shop.id}`) : Promise.resolve([]),
        campaignHeroes(campaignId),
      ]);
      if (!live) return;
      setBook({ tropes, books, kits });
      setStore(storeOf(shopEntries).categories);
      setHeroes(cast.filter((c) => c.id !== ownerId));
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [campaignId, ownerId]);

  const steps = stepsFor(draft.path);
  const step = steps[Math.min(at, steps.length - 1)];
  const last = at >= steps.length - 1;
  const ready = book ? stepReady(draft, step, book) : false;

  const go = (i: number) => {
    setAt(i);
    setReached((r) => Math.max(r, i));
    setPreview(false);
  };
  const close = async () => {
    if (savingRef.current) return;
    const touched = draft.path !== null;
    if (!touched || (await confirm({ message: "Закрыть визард? Набранное пропадёт.", confirmLabel: "Закрыть", danger: true }))) onCancel();
  };
  async function finish() {
    if (!book || !ready || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await onComplete(buildHero(draft, book, heroes));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось создать лист.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  const setTheme = (i: number, t: ThemeDraft) => setDraft((d) => ({ ...d, themes: d.themes.map((x, k) => (k === i ? t : x)) }));

  let body: ReactNode = <p className="lb-empty">Загрузка справочника…</p>;
  if (failed) body = <p className="lb-empty">Справочник Legend in the Mist не загрузился. Закройте окно и попробуйте ещё раз.</p>;
  else if (book) {
    if (step === "path") body = <PathStep path={draft.path} onPick={(p) => setDraft((d) => setPath(d, p))} />;
    else if (step === "trope") body = <TropeStep draft={draft} book={book} onPick={(t, i) => setDraft((d) => applyTrope(d, t, i, book.kits))} />;
    else if (step === "types") body = <TypesStep draft={draft} book={book} onSet={(i, type) => setTheme(i, setThemeType(draft.themes[i], type))} />;
    else if (step.startsWith("theme")) {
      const i = Number(step.slice(5));
      body = <ThemeStep key={step} index={i} theme={draft.themes[i]} book={book} onChange={(t) => setTheme(i, t)} />;
    } else if (step === "backpack") body = <BackpackStep draft={draft} book={book} store={store} onSet={(b) => setDraft((d) => ({ ...d, backpack: b }))} />;
    else if (step === "relations")
      body = <RelationsStep heroes={heroes} relations={draft.relations} onSet={(id, tag) => setDraft((d) => ({ ...d, relations: { ...d.relations, [id]: tag } }))} />;
    else if (step === "dossier") body = <DossierStep draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />;
    else body = <ReviewStep draft={draft} book={book} heroes={heroes} onGo={(s) => go(steps.indexOf(s))} />;
  }

  const hint = !book ? "" : ready ? (last ? "можно создавать" : "готово — можно дальше") : stepHint(draft, step, book);

  return (
    <Modal onClose={() => void close()} closeOnBackdropClick={false} ariaLabel="Новый герой" className="lhw" autoFocus={false}>
      {confirmDialog}
      <div className="lhw-frame litm-book">
        <header className="lhw-head">
          <h2>
            Новый герой
            <small>Legend in the Mist{draft.player ? ` · игрок ${draft.player}` : ""}</small>
          </h2>
        </header>
        <nav className="lhw-steps" aria-label="Шаги">
          <span className="lhw-n">
            <b>
              {at + 1} / {steps.length}
            </b>
            {stepLabel(step)}
          </span>
          <ol>
            {steps.map((s, i) => (
              <li key={s} className={i < at ? "is-done" : i === at ? "is-on" : ""}>
                <button type="button" disabled={saving || i > reached} onClick={() => go(i)} aria-current={i === at ? "step" : undefined}>
                  {stepLabel(s)}
                </button>
              </li>
            ))}
          </ol>
          {draft.path && <span className="lhw-path">путь · {PATH_NAME[draft.path]}</span>}
          <button type="button" className="lhw-pv-btn" aria-label="Карточка героя" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
            ◧
          </button>
        </nav>
        <div className={`lhw-body${step === "review" ? " is-wide" : ""}`}>
          <section className="lhw-main">
            {saveError && <p className="sb-save-status is-error" role="alert">{saveError}</p>}
            {body}
          </section>
          {book && step !== "review" && (
            <aside className={`lhw-prev${preview ? " is-open" : ""}`} aria-label="Карточка героя">
              <HeroCard draft={draft} book={book} heroes={heroes} />
              <button type="button" className="d-btn d-btn--sm lhw-prev-x" onClick={() => setPreview(false)}>
                Скрыть карточку
              </button>
            </aside>
          )}
        </div>
        <footer className="lhw-foot">
          <button type="button" className="d-btn" disabled={saving} onClick={() => (at ? go(at - 1) : void close())}>
            {at ? "← Назад" : "Отмена"}
          </button>
          <span className="lhw-hint">{hint}</span>
          <button type="button" className="d-btn d-btn--primary" disabled={saving || !ready} onClick={() => (last ? void finish() : go(at + 1))}>
            {last ? (saving ? "Создаём…" : "Создать героя") : step === "relations" && Object.values(draft.relations).every((t) => !t.trim()) ? "Пропустить →" : "Далее →"}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

/** Герои кампании для шага «Отношения»: Мастеру — все персонажи, игроку — партия (чужих персонажей кампании ему не отдают). */
async function campaignHeroes(campaignId?: number): Promise<Hero[]> {
  if (!campaignId) return [];
  try {
    const all = await readResource<Character[]>(`/characters?campaign_id=${campaignId}`);
    return all.filter((c) => !c.archived_at).map((c) => ({ id: c.id, name: c.character_name }));
  } catch {
    try {
      const party = await readResource<{ id: number; character_name: string }[]>(`/player/campaigns/${campaignId}/party`);
      return party.map((c) => ({ id: c.id, name: c.character_name }));
    } catch {
      return [];
    }
  }
}

function stepHint(d: HeroDraft, s: StepId, book: WizardBook): string {
  if (s === "path") return "выберите путь";
  if (s === "trope") return d.tropeId === null ? "выберите троп" : "выберите четвёртую тему";
  if (s === "types") return "далее — когда выбраны все четыре";
  if (s.startsWith("theme")) return `нужно: ${themeGaps(d.themes[Number(s.slice(5))], book).join(", ")}`;
  if (s === "backpack") return "выберите тег рюкзака";
  if (s === "dossier") return "впишите имя героя";
  return "есть нарушения — см. проверки";
}

/* ───────── Путь ───────── */

const PATHS: { id: HeroPath; k: string; name: string; sub: string; items: string[]; flow: string[] }[] = [
  {
    id: "simple",
    k: "Самый простой",
    name: "Просто запишите",
    sub: "Придумайте четыре темы и запишите их тегами",
    items: ["Четыре темы — тег-название каждой", "К каждой ещё два тега силы и один слабости", "Квест и тип для каждой темы", "Один свой тег рюкзака"],
    flow: ["Темы 1–4 · вручную", "Рюкзак", "Отношения", "Досье", "Обзор"],
  },
  {
    id: "quick",
    k: "Самый быстрый",
    name: "Возьмите троп",
    sub: "Троп — как рецепт героя: три темы и одна на выбор",
    items: ["Троп даёт три темы, четвёртую — из списка", "Каждая тема — готовый набор: из него два тега силы, один слабости и Квест", "Один тег рюкзака из вариантов тропа"],
    flow: ["Троп", "Темы 1–4 · набор", "Рюкзак", "Отношения", "Досье", "Обзор"],
  },
  {
    id: "detail",
    k: "Подробный",
    name: "Ответьте на анкеты",
    sub: "Опросник проводит через каждую тему",
    items: ["Четыре типа тем (тип можно повторить)", "Первый вопрос анкеты обязателен, ещё два на выбор — теги силы; один вопрос — тег слабости", "Квест по подсказкам анкеты", "Тег рюкзака из Общей лавки"],
    flow: ["Типы тем", "Темы 1–4 · анкета", "Рюкзак", "Отношения", "Досье", "Обзор"],
  },
];

function PathStep({ path, onPick }: { path: HeroPath | null; onPick: (p: HeroPath) => void }) {
  return (
    <>
      <h3 className="lhw-q">Как создаём героя?</h3>
      <p className="lhw-lead">Три пути из книги — выберите один. Шаги подстроятся под путь; сменить его можно в любой момент.</p>
      <div className="lhw-paths" role="radiogroup" aria-label="Путь создания героя">
        {PATHS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={path === p.id} className={`lhw-path-card${path === p.id ? " is-on" : ""}`} onClick={() => onPick(p.id)}>
            <span className="lhw-k">{p.k}</span>
            <b>{p.name}</b>
            <i>{p.sub}</i>
            <ul>
              {p.items.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <span className="lhw-flow">
              {p.flow.map((x) => (
                <span key={x}>{x}</span>
              ))}
            </span>
          </button>
        ))}
      </div>
      <p className="lhw-note">
        <b>Пути можно смешивать.</b> Путь задаёт, как откроется каждая тема. На шаге темы — строка «Сделать эту тему иначе: набор · анкета · вручную».
      </p>
    </>
  );
}

/* ───────── Троп ───────── */

function TropeStep({ draft, book, onPick }: { draft: HeroDraft; book: WizardBook; onPick: (t: WizardBook["tropes"][number], chooseIdx: number | null) => void }) {
  const [group, setGroup] = useState("");
  const [open, setOpen] = useState<number | null>(draft.tropeId);
  const groups = [...new Set(book.tropes.map((t) => t.data.group))];
  const list = group ? book.tropes.filter((t) => t.data.group === group) : book.tropes;
  const trope = book.tropes.find((t) => t.id === open) ?? null;
  const kitOf = (en: string) => (trope ? findKit(book.kits, en, tropeKitRef(trope, en)) : undefined);
  const mightOf = (en: string) => asMight(kitOf(en)?.data.might || book.books.find((b) => b.enName === en)?.data.might || "");
  const chosen = trope && draft.tropeId === trope.id ? draft.chooseIdx : null;

  return (
    <>
      <div className="lhw-chips" role="group" aria-label="Группа тропов">
        <button type="button" className={`d-chip${group === "" ? " active" : ""}`} onClick={() => setGroup("")}>
          Все · {book.tropes.length}
        </button>
        {groups.map((g) => (
          <button key={g} type="button" className={`d-chip${group === g ? " active" : ""}`} onClick={() => setGroup(g)}>
            {g}
          </button>
        ))}
      </div>
      <div className="lhw-trope">
        <div className="lhw-tlist">
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`lhw-trow${open === t.id ? " is-on" : ""}${draft.tropeId === t.id ? " is-taken" : ""}`}
              onClick={() => {
                setOpen(t.id);
                if (draft.tropeId !== t.id) onPick(t, null);
              }}
            >
              <b>{t.name.split(" [")[0]}</b>
              <small>{t.data.group}</small>
              <span className="lhw-dots">
                {t.data.themes_fixed.map((en, i) => {
                  const m = asMight(findKit(book.kits, en, tropeKitRef(t, en))?.data.might || book.books.find((b) => b.enName === en)?.data.might || "");
                  return <i key={i} className={`lb-mt lb-mt--${m ?? "variable"}`} />;
                })}
              </span>
            </button>
          ))}
        </div>
        {trope && (
          <div className={`lhw-tdet${open !== null ? " is-open" : ""}`}>
            <h3 className="lhw-q">
              {trope.name.split(" [")[0]}
              <small>{trope.data.group}</small>
            </h3>
            {trope.data.blurb && <p className="lhw-blurb">{trope.data.blurb}</p>}
            <div className="lhw-tcols">
              <div>
                <div className="lb-lbl">Три темы</div>
                {trope.data.themes_fixed.map((en) => (
                  <KitRow key={en} kit={kitOf(en)} en={en} might={mightOf(en)} mark="✓" />
                ))}
              </div>
              <div role="radiogroup" aria-label="Четвёртая тема">
                <div className="lb-lbl">И одна на выбор</div>
                {trope.data.themes_choose_one.map((en, i) => (
                  <button key={en + i} type="button" role="radio" aria-checked={chosen === i} className={`lhw-kitpick${chosen === i ? " is-on" : ""}`} onClick={() => onPick(trope, i)}>
                    <KitRow kit={kitOf(en)} en={en} might={mightOf(en)} mark={chosen === i ? "●" : "○"} />
                  </button>
                ))}
              </div>
            </div>
            {trope.data.backpack.length > 0 && (
              <>
                <div className="lb-lbl">Рюкзак — один на выбор, на шаге «Рюкзак»</div>
                <div className="lb-tags">
                  {trope.data.backpack.map((b) => (
                    <span key={b} className="lb-ts">
                      {b}
                    </span>
                  ))}
                </div>
              </>
            )}
            <button type="button" className="d-btn d-btn--primary lhw-tdet-done" disabled={chosen === null} onClick={() => setOpen(null)}>
              Готово
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function KitRow({ kit, en, might, mark }: { kit?: LitmThemeKit; en: string; might: LitmMight | null; mark: string }) {
  return (
    <span className="lhw-kit">
      <span className="lhw-kit-mark">{mark}</span>
      <b>
        {kit?.name ?? en}
        {kit?.nameEn && <small>{kit.nameEn}</small>}
      </b>
      {might && <MightMark might={might} />}
    </span>
  );
}

/* ───────── Типы тем ───────── */

function TypesStep({ draft, book, onSet }: { draft: HeroDraft; book: WizardBook; onSet: (i: number, type: string) => void }) {
  const firstEmpty = draft.themes.findIndex((t) => !t.type);
  const [slot, setSlot] = useState(firstEmpty < 0 ? 0 : firstEmpty);
  const mightOf = (en: string) => asMight(book.books.find((b) => b.enName === en)?.data.might ?? "");
  const count = (m: LitmMight) => draft.themes.filter((t) => mightOf(t.type) === m).length;
  return (
    <>
      <h3 className="lhw-q">
        Типы тем<small>четыре, тип можно повторить</small>
      </h3>
      <p className="lhw-lead">Выберите тип для каждой из четырёх тем. Дальше на каждый — его анкета.</p>
      <div className="lhw-slots">
        {draft.themes.map((t, i) => {
          const b = book.books.find((x) => x.enName === t.type);
          const m = mightOf(t.type);
          return (
            <button key={i} type="button" className={`lhw-slot${b ? ` is-filled lhw-m--${m}` : ""}${slot === i ? " is-on" : ""}`} onClick={() => setSlot(i)}>
              <span className="lhw-k">Тема {i + 1}</span>
              {b ? <b>{b.ruName}</b> : <i>тип ниже ↓</i>}
              {m && <MightMark might={m} />}
            </button>
          );
        })}
      </div>
      <p className="lhw-bal">
        Могущество: {MIGHTS.filter((m) => m !== "variable").map((m) => `${MIGHT_LABEL[m]} ${count(m)}`).join(" · ")}
        {count("variable") > 0 && ` · переменное ${count("variable")}`}
      </p>
      <div className="lhw-mcols">
        {MIGHTS.map((m) => (
          <div key={m} className={`lhw-mcol lhw-m--${m}`}>
            <MightMark might={m} />
            <p>{MIGHT_HINT[m]}</p>
            {book.books
              .filter((b) => b.data.might === m)
              .map((b) => {
                const at = draft.themes.map((t, i) => (t.type === b.enName ? i + 1 : 0)).filter(Boolean);
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`lhw-book${at.length ? " is-on" : ""}`}
                    onClick={() => {
                      onSet(slot, b.enName);
                      const next = draft.themes.findIndex((t, i) => i !== slot && !t.type);
                      if (next >= 0) setSlot(next);
                    }}
                  >
                    {b.ruName}
                    {at.length > 0 && <small>{at.join(", ")}</small>}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </>
  );
}

const MIGHT_LABEL: Record<LitmMight, string> = { origin: "происхождение", adventure: "приключение", greatness: "величие", variable: "переменное" };

/* ───────── Тема ───────── */

function ThemeStep({ index, theme, book, onChange }: { index: number; theme: ThemeDraft; book: WizardBook; onChange: (t: ThemeDraft) => void }) {
  const bk = book.books.find((b) => b.enName === theme.type);
  const kit = theme.mode === "kit" ? book.kits.find((k) => k.id === theme.kitId) : undefined;
  const might = asMight(kit?.data.might || bk?.data.might || "");
  const head =
    theme.mode === "kit" && kit ? (
      <>
        {kit.name}
        <small>
          {kit.nameEn} · набор{bk ? ` темы «${bk.ruName}»` : ""}
        </small>
      </>
    ) : theme.mode === "questions" && bk ? (
      <>
        {bk.ruName}
        <small>анкета темы</small>
      </>
    ) : (
      <>
        Тема {index + 1}
        <small>{theme.mode === "kit" ? "набор" : theme.mode === "questions" ? "анкета" : "вручную"}</small>
      </>
    );
  return (
    <>
      <div className="lhw-thead">
        <h3 className="lhw-q">{head}</h3>
        {might && <MightMark might={might} />}
      </div>
      {theme.mode === "kit" && <KitBody theme={theme} book={book} onChange={onChange} />}
      {theme.mode === "questions" && <QuestionsBody theme={theme} book={book} onChange={onChange} />}
      {theme.mode === "manual" && <ManualBody theme={theme} book={book} onChange={onChange} />}
      <div className="lhw-other">
        Сделать эту тему иначе:
        {(["kit", "questions", "manual"] as ThemeMode[]).map((m) => (
          <button key={m} type="button" className={theme.mode === m ? "is-on" : ""} aria-pressed={theme.mode === m} onClick={() => onChange(setThemeMode(theme, m))}>
            {m === "kit" ? "набор" : m === "questions" ? "анкета" : "вручную"}
          </button>
        ))}
      </div>
    </>
  );
}

function Counter({ have, need, label }: { have: number; need: number; label: string }) {
  return <span className={`lhw-cnt${have === need ? " is-ok" : have > 0 ? " is-part" : ""}`}>{`${label} ${have} / ${need}${have === need ? " ✓" : ""}`}</span>;
}

function KitBody({ theme, book, onChange }: { theme: ThemeDraft; book: WizardBook; onChange: (t: ThemeDraft) => void }) {
  const kit = book.kits.find((k) => k.id === theme.kitId);
  const sameType = book.kits.filter((k) => (theme.type ? k.bookEn === theme.type || k.themebookEn === theme.type : true));
  const choices = sameType.length ? sameType : book.kits;
  const pick = (
    <label className="lhw-kitsel">
      <span className="lb-lbl">{kit ? "Другой набор" : "Набор темы"}</span>
      <select
        className="d-field"
        value={theme.kitId ?? ""}
        onChange={(e) => {
          const k = book.kits.find((x) => x.id === Number(e.target.value));
          if (k) onChange(chooseKit(theme, k));
        }}
      >
        {!kit && <option value="">— выберите —</option>}
        {choices.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
            {theme.type ? "" : ` · ${book.books.find((b) => b.enName === k.bookEn)?.ruName ?? k.bookEn}`}
          </option>
        ))}
      </select>
    </label>
  );
  if (!kit) return pick;
  const power = [...kit.data.powerTags, ...theme.power.filter((t) => !kit.data.powerTags.includes(t))];
  const weak = [...kit.data.weaknessTags, ...theme.weak.filter((t) => !kit.data.weaknessTags.includes(t))];
  return (
    <>
      <p className="lhw-ttl">
        <span className="lb-lbl">Тег-название</span>
        <Tag>{kit.name}</Tag>
        <span className="lhw-hint">уже на карте</span>
      </p>
      <TagPick label="Теги силы · из набора" counter="силы" tags={power} picked={theme.power} need={POWER_NEED.kit} onChange={(p) => onChange({ ...theme, power: p })} />
      <TagPick label="Тег слабости" counter="слабость" weak tags={weak} picked={theme.weak} need={WEAK_NEED} onChange={(w) => onChange({ ...theme, weak: w })} />
      <QuestField value={theme.quest} from={kit.data.quest} onChange={(q) => onChange({ ...theme, quest: q })} />
      {pick}
    </>
  );
}

function TagPick({ label, counter, tags, picked, need, weak, onChange }: { label: string; counter: string; tags: string[]; picked: string[]; need: number; weak?: boolean; onChange: (p: string[]) => void }) {
  const [own, setOwn] = useState("");
  const add = () => {
    const t = own.trim();
    if (!t || picked.includes(t) || picked.length >= need) return;
    onChange([...picked, t]);
    setOwn("");
  };
  return (
    <div className="lhw-pick">
      <div className="lhw-lrow">
        <span className="lb-lbl">{label}</span>
        <Counter have={picked.length} need={need} label={counter} />
      </div>
      <div className="lhw-tags">
        {tags.map((t) => (
          <button key={t} type="button" aria-pressed={picked.includes(t)} className={`${weak ? "lb-tw" : "lb-tg"}${picked.includes(t) ? " is-on" : ""}`} onClick={() => onChange(toggleTag(picked, t, need))}>
            {t}
          </button>
        ))}
        <span className="lhw-own">
          <input
            className="d-field"
            placeholder="+ свой тег"
            value={own}
            disabled={picked.length >= need}
            onChange={(e) => setOwn(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
          />
        </span>
      </div>
    </div>
  );
}

function QuestField({ value, from, ideas, onChange }: { value: string; from?: string; ideas?: string[]; onChange: (q: string) => void }) {
  return (
    <div className="lhw-pick">
      <div className="lhw-lrow">
        <span className="lb-lbl">Квест</span>
        {from && value === from && <span className="lhw-hint">из набора — можно переписать</span>}
      </div>
      <input className="d-field lhw-quest" placeholder="Желание · Истина · Дом · Вопрос" value={value} onChange={(e) => onChange(e.target.value)} />
      {ideas && ideas.length > 0 && (
        <ul className="lhw-ideas">
          {ideas.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TypeSelect({ theme, book, onChange }: { theme: ThemeDraft; book: WizardBook; onChange: (t: ThemeDraft) => void }) {
  return (
    <div className="lhw-types" role="radiogroup" aria-label="Тип темы">
      {book.books.map((b) => (
        <button key={b.id} type="button" role="radio" aria-checked={theme.type === b.enName} className={`lhw-type lhw-m--${asMight(b.data.might) ?? "variable"}${theme.type === b.enName ? " is-on" : ""}`} onClick={() => onChange(setThemeType(theme, b.enName))}>
          {b.ruName}
        </button>
      ))}
    </div>
  );
}

function QuestionsBody({ theme, book, onChange }: { theme: ThemeDraft; book: WizardBook; onChange: (t: ThemeDraft) => void }) {
  const bk = book.books.find((b) => b.enName === theme.type);
  if (!bk) {
    return (
      <>
        <p className="lhw-lead">Выберите тип темы — у каждого своя анкета.</p>
        <TypeSelect theme={theme} book={book} onChange={onChange} />
      </>
    );
  }
  const p = themePower(theme).length;
  const w = themeWeak(theme).length;
  const row = (q: string, i: number, weak: boolean) => {
    const v = (weak ? theme.weakAnswers : theme.answers)[i] ?? "";
    const set = (x: string) => onChange(weak ? { ...theme, weakAnswers: { ...theme.weakAnswers, [i]: x } } : { ...theme, answers: { ...theme.answers, [i]: x } });
    return (
      <label key={i} className={`lhw-qa${v.trim() ? (weak ? " is-weak" : " is-ans") : ""}${!weak && i === 0 ? " is-req" : ""}`}>
        <b>{letter(i)}</b>
        <span>
          {q}
          {!weak && i === 0 && <em>обязательный</em>}
        </span>
        <input className="d-field" value={v} placeholder={weak ? "ответ → тег слабости" : "ответ → тег силы"} onChange={(e) => set(e.target.value)} />
      </label>
    );
  };
  return (
    <div className="lhw-qcols">
      <div>
        <div className="lhw-lrow">
          <span className="lb-lbl">Теги силы</span>
          <Counter have={p} need={POWER_NEED.questions} label="силы" />
        </div>
        {bk.data.powerQuestions.map((q, i) => row(q, i, false))}
      </div>
      <div>
        <div className="lhw-lrow">
          <span className="lb-lbl">Тег слабости · один</span>
          <Counter have={w} need={WEAK_NEED} label="слабость" />
        </div>
        {bk.data.weaknessQuestions.map((q, i) => row(q, i, true))}
        <QuestField value={theme.quest} ideas={bk.data.questIdeas} onChange={(q) => onChange({ ...theme, quest: q })} />
      </div>
    </div>
  );
}

function ManualBody({ theme, book, onChange }: { theme: ThemeDraft; book: WizardBook; onChange: (t: ThemeDraft) => void }) {
  const at = (list: string[], i: number) => list[i] ?? "";
  const put = (list: string[], i: number, v: string) => {
    const next = [...list];
    next[i] = v;
    return next;
  };
  return (
    <div className="lhw-manual">
      <span className="lb-lbl">Тип темы</span>
      <TypeSelect theme={theme} book={book} onChange={onChange} />
      <span className="lb-lbl">Тег-название</span>
      <input className="d-field is-title" value={theme.title} placeholder="Чем эта тема называется" onChange={(e) => onChange({ ...theme, title: e.target.value })} />
      {[0, 1].map((i) => (
        <FragmentRow key={i} label="Тег силы">
          <input className="d-field is-power" value={at(theme.power, i)} placeholder="Какие действия поддержит этот тег?" onChange={(e) => onChange({ ...theme, power: put(theme.power, i, e.target.value) })} />
        </FragmentRow>
      ))}
      <span className="lb-lbl">Тег слабости</span>
      <input className="d-field is-weak" value={at(theme.weak, 0)} placeholder="Каким действиям помешает этот тег?" onChange={(e) => onChange({ ...theme, weak: put(theme.weak, 0, e.target.value) })} />
      <span className="lb-lbl">Квест</span>
      <input className="d-field" value={theme.quest} placeholder="Желание · Истина · Дом · Вопрос" onChange={(e) => onChange({ ...theme, quest: e.target.value })} />
      <p className="lhw-memo">Теги силы должны быть полезны, тег слабости — ограничивать. Теги, особенно тег-название, отвечают Могуществу темы.</p>
    </div>
  );
}

function FragmentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="lb-lbl">{label}</span>
      {children}
    </>
  );
}

/* ───────── Рюкзак ───────── */

function BackpackStep({ draft, book, store, onSet }: { draft: HeroDraft; book: WizardBook; store: StoreCategory[]; onSet: (b: string) => void }) {
  const trope = draft.path === "quick" ? book.tropes.find((t) => t.id === draft.tropeId) : undefined;
  const options = trope?.data.backpack ?? [];
  const [pick, setPick] = useState<number | "own" | null>(() => {
    if (!draft.backpack) return null;
    const i = options.findIndex((o) => o === draft.backpack || (hasChoice(o) && draft.backpack.startsWith(o.split("(")[0].trim())));
    return i >= 0 ? i : "own";
  });
  const [fill, setFill] = useState("");
  const [own, setOwn] = useState(pick === "own" ? draft.backpack : "");
  const [cat, setCat] = useState(0);
  const items = store[cat]?.subs.flatMap((s) => s.items) ?? [];

  if (trope) {
    return (
      <>
        <h3 className="lhw-q">
          Один тег рюкзака<small>из вариантов тропа</small>
        </h3>
        <div className="lhw-opts" role="radiogroup" aria-label="Тег рюкзака">
          {options.map((o, i) => (
            <div key={o} className={`lhw-opt${pick === i ? " is-on" : ""}`}>
              <button
                type="button"
                role="radio"
                aria-checked={pick === i}
                onClick={() => {
                  setPick(i);
                  onSet(hasChoice(o) ? (fill.trim() ? fillChoice(o, fill) : "") : o);
                }}
              >
                <span className="lb-ts">{o}</span>
              </button>
              {hasChoice(o) && pick === i && (
                <input
                  className="d-field"
                  autoFocus
                  placeholder="кого или что — своими словами"
                  value={fill}
                  onChange={(e) => {
                    setFill(e.target.value);
                    onSet(e.target.value.trim() ? fillChoice(o, e.target.value) : "");
                  }}
                />
              )}
            </div>
          ))}
          <div className={`lhw-opt${pick === "own" ? " is-on" : ""}`}>
            <button type="button" role="radio" aria-checked={pick === "own"} onClick={() => {
                setPick("own");
                onSet(own);
              }}>
              <span className="lhw-hint">или свой тег</span>
            </button>
            {pick === "own" && (
              <input
                className="d-field"
                autoFocus
                value={own}
                onChange={(e) => {
                  setOwn(e.target.value);
                  onSet(e.target.value);
                }}
              />
            )}
          </div>
        </div>
        <p className="lhw-hint">«(выберите)» в теге — поле для своего слова</p>
      </>
    );
  }
  return (
    <>
      <h3 className="lhw-q">
        Один тег рюкзака<small>из Общей лавки или свой</small>
      </h3>
      <div className="lhw-chips" role="group" aria-label="Категория">
        {store.map((c, i) => (
          <button key={c.entry.id} type="button" className={`d-chip${cat === i ? " active" : ""}`} onClick={() => setCat(i)}>
            {c.entry.name}
          </button>
        ))}
      </div>
      <div className="lhw-tags">
        {items.map((it) => (
          <button key={it.name} type="button" title={it.note} aria-pressed={draft.backpack === it.name} className={`lb-ts${draft.backpack === it.name ? " is-on" : ""}`} onClick={() => onSet(draft.backpack === it.name ? "" : it.name)}>
            {it.name}
          </button>
        ))}
      </div>
      <label className="lhw-ownbp">
        <span className="lb-lbl">Или свой тег</span>
        <input
          className="d-field"
          value={own}
          onChange={(e) => {
            setOwn(e.target.value);
            onSet(e.target.value);
          }}
        />
      </label>
      {store.length === 0 && <p className="lb-empty">Общая лавка в справочнике не найдена — впишите свой тег.</p>}
    </>
  );
}

/* ───────── Отношения, досье ───────── */

function RelationsStep({ heroes, relations, onSet }: { heroes: Hero[]; relations: Record<number, string>; onSet: (id: number, tag: string) => void }) {
  return (
    <>
      <h3 className="lhw-q">
        Теги отношений<small>к другим героям кампании · можно пропустить</small>
      </h3>
      <p className="lhw-lead">По одному тегу к каждому: кто он вам или кто вы ему. Согласуйте с его игроком. Пропущенное допишете на листе или на привале.</p>
      {heroes.length === 0 && <p className="lb-empty">В кампании пока нет других героев.</p>}
      <div className="lhw-rels">
        {heroes.map((h) => (
          <label key={h.id} className="lhw-rel">
            <span className="lhw-av">{h.name.slice(0, 1)}</span>
            <b>{h.name}</b>
            <input className="d-field" placeholder="как ваш герой к нему относится?" value={relations[h.id] ?? ""} onChange={(e) => onSet(h.id, e.target.value)} />
          </label>
        ))}
      </div>
      <p className="lhw-hint">Тема Содружества создаётся всеми вместе — не здесь, отдельно в кампании</p>
    </>
  );
}

function DossierStep({ draft, onChange }: { draft: HeroDraft; onChange: (patch: Partial<HeroDraft>) => void }) {
  return (
    <>
      <h3 className="lhw-q">Досье</h3>
      <div className="lhw-dos">
        <label>
          <span className="lb-lbl">Имя героя</span>
          <input className="d-field" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <label>
          <span className="lb-lbl">Игрок</span>
          <input className="d-field" value={draft.player} onChange={(e) => onChange({ player: e.target.value })} />
        </label>
        <label>
          <span className="lb-lbl">Обещание</span>
          <input className="d-field" placeholder="можно позже, на листе" value={draft.promise} onChange={(e) => onChange({ promise: e.target.value })} />
        </label>
      </div>
    </>
  );
}

/* ───────── Обзор и карточка героя ───────── */

function ReviewStep({ draft, book, heroes, onGo }: { draft: HeroDraft; book: WizardBook; heroes: Hero[]; onGo: (s: StepId) => void }) {
  const checks = reviewChecks(draft, book, heroes);
  return (
    <div className="lhw-review">
      <div>
        <h3 className="lhw-q">Обзор</h3>
        <div className="lhw-checks">
          {checks.map((c, i) => {
            const to = c.step;
            return (
              <div key={i} className={`lhw-ck${c.ok ? " is-ok" : c.block ? " is-block" : " is-warn"}`}>
                <i>{c.ok ? "✓" : "!"}</i>
                <span>{c.text}</span>
                {to && (
                  <button type="button" onClick={() => onGo(to)}>
                    к шагу «{stepLabel(to)}»
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="lhw-hint">Нарушение правил закрывает «Создать»; сомнительное — предупреждение, создать можно</p>
      </div>
      <HeroCard draft={draft} book={book} heroes={heroes} full />
    </div>
  );
}

function HeroCard({ draft, book, heroes, full }: { draft: HeroDraft; book: WizardBook; heroes: Hero[]; full?: boolean }) {
  const cards = useMemo(() => draft.themes.map((t) => draftTheme(t, book)), [draft.themes, book]);
  return (
    <div className={`lhw-card${full ? " is-full" : ""}`}>
      <span className="lb-lbl">Карточка героя · как на листе</span>
      {draft.name ? <h4>{draft.name}</h4> : <h4 className="is-none">Имя — на шаге «Досье»</h4>}
      <div className="lhw-cards">
        {cards.map((c, i) => {
          const m = asMight(c.power);
          if (!c.name && !c.themeType) return <div key={i} className="lhw-pc is-empty">Тема {i + 1}</div>;
          const bk = book.books.find((b) => b.enName === c.themeType);
          return (
            <div key={i} className={`lhw-pc lhw-m--${m ?? "variable"}`}>
              {m && <MightMark might={m} label={`${MIGHT_LABEL[m]}${bk ? ` · ${bk.ruName}` : ""}`} />}
              <b>{c.name || bk?.ruName || "—"}</b>
              <span className="lb-tags">
                {c.name && <Tag>{c.name}</Tag>}
                {c.powerTags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
                {c.weaknessTags.map((t) => (
                  <Tag key={t} weak>
                    {t}
                  </Tag>
                ))}
              </span>
              {c.quest && <q>{c.quest}</q>}
            </div>
          );
        })}
      </div>
      <p className="lhw-row">
        <span className="lb-lbl">Рюкзак</span>
        {draft.backpack.trim() ? <span className="lb-ts">{draft.backpack.trim()}</span> : <span className="lhw-hint">— на шаге «Рюкзак»</span>}
      </p>
      {heroes
        .filter((h) => (draft.relations[h.id] ?? "").trim())
        .map((h) => (
          <p key={h.id} className="lhw-row">
            <span className="lb-lbl">→ {h.name}</span>
            <span className="lb-ts">{draft.relations[h.id].trim()}</span>
          </p>
        ))}
    </div>
  );
}
