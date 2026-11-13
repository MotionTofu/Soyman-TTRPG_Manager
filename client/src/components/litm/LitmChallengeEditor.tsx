import { useState, type ReactNode } from "react";
import { MIGHT_NAMES } from "./litmBookText";
import {
  LOCATION_ORDER, ROLE_ORDER,
  type LitmChallengeMight, type LitmChallengeProfileData, type LitmChallengeTag, type LitmLimit, type LitmSpecial, type LitmThreat,
} from "./litmChallenge";

type ListKey = "limitList" | "tagList" | "mightList" | "specialList" | "threatList";

/** Форма вызова (решение 2026-11-06, Q3): та же раскладка, что у профиля. Текст —
 *  разметкой книги: `*тег*`, `*статус-2*`, `**Заблокировано**`, `**УГРОЗА**`. */
export function LitmChallengeEditor({ initial, busy, onSave, onCancel }: {
  initial: LitmChallengeProfileData;
  busy?: boolean;
  onSave: (p: LitmChallengeProfileData) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<LitmChallengeProfileData>(initial);
  const set = <K extends keyof LitmChallengeProfileData>(k: K, v: LitmChallengeProfileData[K]) => setD((x) => ({ ...x, [k]: v }));
  function edit<T>(k: ListKey, i: number, patch: Partial<T>) {
    setD((x) => ({ ...x, [k]: (x[k] as unknown as T[]).map((it, n) => (n === i ? { ...it, ...patch } : it)) }));
  }
  function add<T>(k: ListKey, item: T) {
    setD((x) => ({ ...x, [k]: [...(x[k] as unknown as T[]), item] }));
  }
  function drop(k: ListKey, i: number) {
    setD((x) => ({ ...x, [k]: (x[k] as unknown[]).filter((_, n) => n !== i) }));
  }
  function move(k: ListKey, i: number, step: number) {
    setD((x) => {
      const list = [...(x[k] as unknown[])];
      const j = i + step;
      if (j < 0 || j >= list.length) return x;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...x, [k]: list };
    });
  }
  const rowTools = (k: ListKey, i: number, label: string) => (
    <span className="lb-ed__tools">
      <button type="button" className="d-btn d-btn--sm" aria-label={`${label}: выше`} onClick={() => move(k, i, -1)}>↑</button>
      <button type="button" className="d-btn d-btn--sm" aria-label={`${label}: ниже`} onClick={() => move(k, i, 1)}>↓</button>
      <button type="button" className="d-btn d-btn--sm" aria-label={`${label}: убрать`} onClick={() => drop(k, i)}>✕</button>
    </span>
  );
  const toggleRole = (r: string) => set("roles", d.roles.includes(r) ? d.roles.filter((x) => x !== r) : [...d.roles, r]);
  const roles = [...new Set([...ROLE_ORDER, ...initial.roles])];
  const locations = LOCATION_ORDER.includes(d.location) ? LOCATION_ORDER : [d.location, ...LOCATION_ORDER];

  return (
    <form className="lb-ed" onSubmit={(e) => { e.preventDefault(); onSave(d); }}>
      <div className="lb-ed__grid">
        <Field label="Имя"><input value={d.title} onChange={(e) => set("title", e.target.value)} required /></Field>
        <Field label="Оригинал"><input value={d.titleEn} onChange={(e) => set("titleEn", e.target.value)} placeholder="Grumpy Keeper" /></Field>
        <Field label="Место">
          <select className="d-select" value={d.location} onChange={(e) => set("location", e.target.value)}>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Рейтинг">
          <select className="d-select" value={d.rating} onChange={(e) => set("rating", Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Страница книги"><input value={d.page} onChange={(e) => set("page", e.target.value)} placeholder="B114" /></Field>
      </div>
      <fieldset className="lb-ed__roles">
        <legend className="lb-lbl">Роли</legend>
        {roles.map((r) => (
          <label key={r} className={`lb-ed__chip${d.roles.includes(r) ? " is-on" : ""}`}>
            <input type="checkbox" checked={d.roles.includes(r)} onChange={() => toggleRole(r)} />{r}
          </label>
        ))}
      </fieldset>
      <Field label="Описание"><textarea rows={4} value={d.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <p className="lb-ed__hint">Разметка книги: <code>*тег*</code>, <code>*статус-2*</code>, <code>**Возможность закрыта**</code>, <code>**УГРОЗА**</code> — так же покажет профиль.</p>

      <Section title="Пределы" onAdd={() => add<LitmLimit>("limitList", { name: "", max: "3" })}>
        {d.limitList.map((l, i) => (
          <div key={i} className="lb-ed__row lb-ed__row--limit">
            <input aria-label="Предел" placeholder="Ранить" value={l.name} onChange={(e) => edit<LitmLimit>("limitList", i, { name: e.target.value })} />
            <input aria-label="Шкала" className="lb-ed__num" value={l.max} onChange={(e) => edit<LitmLimit>("limitList", i, { max: e.target.value })} />
            <label className="lb-ed__check"><input type="checkbox" checked={!!l.arrow} onChange={(e) => edit<LitmLimit>("limitList", i, { arrow: e.target.checked })} />↻</label>
            {rowTools("limitList", i, "Предел")}
            {l.arrow && <input aria-label="Что происходит, когда предел достигнут" className="lb-ed__wide" placeholder="Что происходит, когда предел достигнут" value={l.note ?? ""} onChange={(e) => edit<LitmLimit>("limitList", i, { note: e.target.value })} />}
          </div>
        ))}
      </Section>

      <Section title="Теги и статусы" onAdd={() => add<LitmChallengeTag>("tagList", { text: "" })}>
        {d.tagList.map((t, i) => (
          <div key={i} className="lb-ed__row lb-ed__row--tag">
            <input aria-label="Тег или статус" placeholder="*настороже-2*" value={t.text} onChange={(e) => edit<LitmChallengeTag>("tagList", i, { text: e.target.value })} />
            <input aria-label="Группа" placeholder="группа (необязательно)" value={t.group ?? ""} onChange={(e) => edit<LitmChallengeTag>("tagList", i, { group: e.target.value })} />
            <label className="lb-ed__check"><input type="checkbox" checked={!!t.weakness} onChange={(e) => edit<LitmChallengeTag>("tagList", i, { weakness: e.target.checked })} />слабость</label>
            {rowTools("tagList", i, "Тег")}
          </div>
        ))}
      </Section>

      <Section title="Могущество" onAdd={() => add<LitmChallengeMight>("mightList", { name: "", level: "adventure" })}>
        {d.mightList.map((m, i) => (
          <div key={i} className="lb-ed__row lb-ed__row--might">
            <input aria-label="В чём могуч" placeholder="Огромный" value={m.name} onChange={(e) => edit<LitmChallengeMight>("mightList", i, { name: e.target.value })} />
            <select className="d-select" aria-label="Ступень" value={m.level} onChange={(e) => edit<LitmChallengeMight>("mightList", i, { level: e.target.value })}>
              {(["origin", "adventure", "greatness"] as const).map((k) => <option key={k} value={k}>{MIGHT_NAMES[k]}</option>)}
            </select>
            <input aria-label="Уязвимость" placeholder="уязвимость" value={m.vulnerability ?? ""} onChange={(e) => edit<LitmChallengeMight>("mightList", i, { vulnerability: e.target.value })} />
            {rowTools("mightList", i, "Могущество")}
          </div>
        ))}
      </Section>

      <Section title="Угрозы и последствия" onAdd={() => add<LitmThreat>("threatList", { name: "", lead: "", consequences: [] })}>
        {d.threatList.map((t, i) => (
          <div key={i} className="lb-ed__threat">
            <div className="lb-ed__row lb-ed__row--threat">
              <input aria-label="Угроза" placeholder="Угроза (глагол)" disabled={t.withoutThreat} value={t.name} onChange={(e) => edit<LitmThreat>("threatList", i, { name: e.target.value })} />
              <input aria-label="Зачин" placeholder="Что видят герои" disabled={t.withoutThreat} value={t.lead} onChange={(e) => edit<LitmThreat>("threatList", i, { lead: e.target.value })} />
              {rowTools("threatList", i, "Угроза")}
            </div>
            <label><input type="checkbox" checked={!!t.withoutThreat} onChange={(e) => edit<LitmThreat>("threatList", i, { withoutThreat: e.target.checked })} /> Последствия без Угрозы</label>
            <textarea aria-label="Последствия — по одному на строку" rows={Math.max(2, t.consequences.length + 1)} placeholder="Последствия — по одному на строку: Ударить (*ранен-3*)"
              value={t.consequences.join("\n")} onChange={(e) => edit<LitmThreat>("threatList", i, { consequences: e.target.value.split("\n") })} />
          </div>
        ))}
      </Section>

      <Section title="Особенности" onAdd={() => add<LitmSpecial>("specialList", { name: "", text: "" })}>
        {d.specialList.map((s, i) => (
          <div key={i} className="lb-ed__threat">
            <div className="lb-ed__row lb-ed__row--special">
              <input aria-label="Особенность" placeholder="Название" value={s.name} onChange={(e) => edit<LitmSpecial>("specialList", i, { name: e.target.value })} />
              {rowTools("specialList", i, "Особенность")}
            </div>
            <textarea aria-label="Текст особенности" rows={2} value={s.text} onChange={(e) => edit<LitmSpecial>("specialList", i, { text: e.target.value })} />
          </div>
        ))}
      </Section>

      <div className="lb-ed__foot">
        <button type="submit" className="d-btn primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button>
        <button type="button" className="d-btn" disabled={busy} onClick={onCancel}>Отмена</button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="lb-ed__field"><span className="lb-lbl">{label}</span>{children}</label>;
}

function Section({ title, onAdd, children }: { title: string; onAdd: () => void; children: ReactNode }) {
  return (
    <section className="lb-ed__sec">
      <div className="lb-ed__sechead"><span className="lb-lbl">{title}</span><button type="button" className="d-btn d-btn--sm" onClick={onAdd}>+ Добавить</button></div>
      {children}
    </section>
  );
}
