import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import type { Affect } from "../../data/entities";
import { PARTICIPATION_FIELDS } from "../../beingForce";
import { PASSPORT_FIELDS, PASSPORT_NOT_THIS } from "../../settingWorld";
import type { StoryArcDetail } from "../../types";
import { PaperFieldsCard as FieldsCard, type PaperField } from "../PaperFieldsCard";

// Досье приключения на бумаге (гриллинг профилей 2026-10-02, Q14–Q15, Q19;
// доска 36): шапка «За столом», паспорт ключами паспорта сеттинга,
// участники с ходом событий и «Чем кончилось» по осям.

type Field = PaperField;

/** Паспорт приключения: вопросы ваншота, затем поля паспорта сеттинга. */
const ARC_PASSPORT_FIELDS: readonly Field[] = [
  { key: "theme_question", label: "Тематический вопрос", hint: "Ценностная проблема, которую игра ставит перед героями" },
  ...PASSPORT_FIELDS,
  PASSPORT_NOT_THIS,
  { key: "genre", label: "Жанр", hint: "Интрига, хоррор, героика…" },
];

/** Исходы по осям (словарь граф №40) — заполняются после игры. */
const OUTCOME_FIELDS: readonly Field[] = [
  { key: "goal", label: "Цель" },
  { key: "cost", label: "Цена" },
  { key: "relations", label: "Отношения" },
  { key: "threat", label: "Угроза" },
  { key: "world", label: "Мир" },
  { key: "pcs", label: "Персонажи" },
];

/** «За столом»: центральный вопрос крупно, цифры партии, прогресс. */
export function AdventureHead({
  arc,
  passport,
  inCampaign,
  onSave,
}: {
  arc: StoryArcDetail;
  passport: Record<string, string>;
  /** Прогресс — отметки кампании; в сеттинге его нет. */
  inCampaign: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const milestones = arc.milestones.length;
  const achieved = arc.milestones.filter((m) => m.state?.achieved === 1).length;
  const secrets = arc.secrets.length;
  const revealed = arc.secrets.filter((s) => s.state?.revealed === 1).length;
  const values = {
    central_question: passport.central_question ?? "",
    recommended_level: arc.recommended_level,
    player_count: arc.player_count,
    duration: arc.duration,
  };
  const stats = [
    { label: "Уровень", value: arc.recommended_level },
    { label: "Игроки", value: arc.player_count },
    { label: "Длительность", value: arc.duration },
    {
      label: "Прогресс",
      value: inCampaign && (milestones || secrets) ? `${achieved}/${milestones} · ${revealed}/${secrets}` : "",
      sub: "вехи · тайны раскрыты",
    },
  ].filter((s) => s.value);
  return (
    <FieldsCard
      label="За столом"
      strong
      fields={[
        { key: "central_question", label: "Центральный вопрос", hint: "Неопределённость, которую решает игра" },
        { key: "recommended_level", label: "Уровень персонажей" },
        { key: "player_count", label: "Число игроков" },
        { key: "duration", label: "Длительность" },
      ]}
      values={values}
      showGrid={false}
      empty=""
      onSave={async (next) => {
        const { central_question, ...arcFields } = next;
        await onSave({ ...arcFields, passport: { ...passport, central_question } });
      }}
    >
      {values.central_question ? (
        <div className="adventure-head__question">
          <span className="creature-card__head-label">Центральный вопрос</span>
          <p>{values.central_question}</p>
        </div>
      ) : (
        <div className="creature-card__empty">Центральный вопрос не записан: что решает эта игра?</div>
      )}
      {stats.length > 0 && (
        <dl className="vehicle-head__stats adventure-head__stats">
          {stats.map((st) => (
            <div key={st.label}>
              <dt className="creature-card__head-label">{st.label}</dt>
              <dd className="vehicle-head__value">{st.value}</dd>
              {"sub" in st && st.sub && <dd className="vehicle-head__sub">{st.sub}</dd>}
            </div>
          ))}
        </dl>
      )}
    </FieldsCard>
  );
}

export function PassportCard({
  passport,
  onSave,
}: {
  passport: Record<string, string>;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <FieldsCard
      label="Паспорт"
      fields={ARC_PASSPORT_FIELDS}
      values={passport}
      empty="Паспорт пуст: обещание, исходная ситуация, тон…"
      onSave={(next) => onSave({ passport: { ...passport, ...next } })}
    />
  );
}

export function OutcomesCard({
  outcomes,
  onSave,
}: {
  outcomes: Record<string, string>;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <FieldsCard
      label="Чем кончилось"
      fields={OUTCOME_FIELDS}
      values={outcomes}
      empty="Заполняется после игры: цель, цена, отношения, угроза, мир, персонажи."
      onSave={(next) => onSave({ outcomes: next })}
    />
  );
}

interface Participant {
  entity_type: "being" | "community";
  entity_id: number;
  name: string;
  manual: boolean;
  scenes: { id: number; name: string }[];
  data: Record<string, string>;
}

const ENTITY_ROUTE: Record<string, string> = { being: "/beings", community: "/communities" };

/**
 * Участники приключения (Q19): силы из составов сцен и добавленные руками
 * закулисные; у каждого ход событий — цель, план, без вмешательства, если
 * помочь, если лишить рычага. Видит только Мастер.
 */
export function AdventureParticipants({ arcId, settingId }: { arcId: number; settingId: number }) {
  const path = `/participations/adventure/${arcId}`;
  const state = useResource<{ participants: Participant[] }>(path);
  const affects: Affect[] = [{ path }];
  const run = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const participants = state.data?.participants ?? [];
  const fromScenes = participants.filter((p) => !p.manual).length;
  const manual = participants.length - fromScenes;

  async function save(p: Participant, data: Record<string, string>) {
    const ok = await run(
      () => write.put(`${path}/${p.entity_type}/${p.entity_id}`, { data }).then(() => true),
      { affects }
    );
    if (ok) setOpen(null);
  }
  async function remove(p: Participant) {
    await run(() => write.del(`${path}/${p.entity_type}/${p.entity_id}`), { affects });
  }

  return (
    <section className="adventure-participants">
      <h2 className="paper-group__head">
        Участники{" "}
        <span className="paper-group__count">
          · {participants.length}
          {participants.length > 0 && ` · из сцен ${fromScenes}, вручную ${manual}`}
        </span>
      </h2>
      {state.error && <p className="error">{state.error}</p>}
      {participants.length === 0 && !state.error && (
        <p className="muted">Силы появятся сами из составов сцен — или добавьте закулисную.</p>
      )}
      <ul className="paper-rows adventure-participants__rows">
        {participants.map((p) => {
          const key = `${p.entity_type}:${p.entity_id}`;
          return (
            <li key={key}>
              <div className="adventure-participants__line">
                <span className="paper-rows__main">
                  <Link
                    className={`mention-link ${p.entity_type === "being" ? "mention--pop" : "mention--com"}`}
                    to={`${ENTITY_ROUTE[p.entity_type]}/${p.entity_id}`}
                  >
                    {p.name}
                  </Link>
                  {p.data.goal && <span className="paper-rows__sub"> — цель: {p.data.goal}</span>}
                </span>
                <span className="paper-rows__sub">
                  {p.manual ? "вручную" : p.scenes.length === 1 ? p.scenes[0].name : `сцен: ${p.scenes.length}`}
                </span>
                <button type="button" className="creature-card__more" onClick={() => setOpen(open === key ? null : key)}>
                  ход событий
                </button>
                {p.manual && (
                  <button type="button" className="comp-mini" title="Убрать из участников" onClick={() => void remove(p)}>
                    ✕
                  </button>
                )}
              </div>
              {open === key && <FlowEditor value={p.data} onSave={(d) => save(p, d)} onCancel={() => setOpen(null)} />}
            </li>
          );
        })}
      </ul>
      {adding ? (
        <AddBackstage settingId={settingId} taken={participants} path={path} affects={affects} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="editable-card-add" onClick={() => setAdding(true)}>
          + Сила за кадром
        </button>
      )}
    </section>
  );
}

function FlowEditor({
  value,
  onSave,
  onCancel,
}: {
  value: Record<string, string>;
  onSave: (data: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(PARTICIPATION_FIELDS.map((f) => [f.key, value[f.key] ?? ""]))
  );
  return (
    <div className="card stack adventure-participants__flow">
      <div className="scene-head__grid">
        {PARTICIPATION_FIELDS.map((f) => (
          <label key={f.key} className="stack editable-card-field">
            <span>{f.label}</span>
            <textarea rows={2} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="row">
        <button type="button" className="primary" onClick={() => onSave(draft)}>
          Сохранить
        </button>
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

/** Закулисная сила: существо или сообщество сеттинга, которого нет в сценах. */
function AddBackstage({
  settingId,
  taken,
  path,
  affects,
  onDone,
}: {
  settingId: number;
  taken: Participant[];
  path: string;
  affects: Affect[];
  onDone: () => void;
}) {
  const beings = useResource<{ id: number; name: string }[]>(`/setting-beings?setting_id=${settingId}`).data ?? [];
  const communities = useResource<{ id: number; name: string }[]>(`/setting-communities?setting_id=${settingId}`).data ?? [];
  const run = useAction();
  const [pick, setPick] = useState("");
  const isTaken = (type: string, id: number) => taken.some((p) => p.entity_type === type && p.entity_id === id);

  async function add() {
    const [type, id] = pick.split(":");
    if (!type || !id) return;
    const ok = await run(() => write.put(`${path}/${type}/${id}`, { manual: true }).then(() => true), { affects });
    if (ok) onDone();
  }

  return (
    <div className="row adventure-participants__add">
      <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Сила за кадром">
        <option value="">Существо или сообщество…</option>
        <optgroup label="Сообщества">
          {communities
            .filter((c) => !isTaken("community", c.id))
            .map((c) => (
              <option key={`c${c.id}`} value={`community:${c.id}`}>
                {c.name}
              </option>
            ))}
        </optgroup>
        <optgroup label="Существа">
          {beings
            .filter((b) => !isTaken("being", b.id))
            .map((b) => (
              <option key={`b${b.id}`} value={`being:${b.id}`}>
                {b.name}
              </option>
            ))}
        </optgroup>
      </select>
      <button type="button" className="primary" onClick={add} disabled={!pick}>
        Добавить
      </button>
      <button type="button" onClick={onDone}>
        Отмена
      </button>
    </div>
  );
}
