// Улики на холсте приключения (гриллинг «Узловой дизайн» 2026-09-28):
// окно новой связи, окно улик одной стрелки и лоток неразмещённых.
//
// Лежит отдельно от CanvasPage.tsx: страница и так восемь тысяч строк, а
// здесь всё про одно — улику как стрелку.

import { useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { Modal } from "./Modal";
import { useAction, useResource, write } from "../data/hooks";
import { readResource } from "../data/imperative";
import { CLUE_DRAG_MIME, clueAffects } from "../data/canvas";
import { MentionPickerModal } from "./mentions/MentionPickerModal";
import { openPreviewDockCard } from "../previewDockStore";
import type { ArcClue, ArcClues, StoryClue } from "../types";

// ─── Окно новой связи ─────────────────────────────────────────────────────

export type LinkKind = "clue" | "passage";

/**
 * Протянули стрелку от узла к узлу (Q18): улика или проход.
 *
 * По умолчанию — улика, фокус сразу в «Что находят»: Enter сохраняет, Esc —
 * стрелки нет. Проход — надёжная связь (дверь, «после боя их уводят»), у него
 * только необязательное условие.
 */
export function NewLinkDialog({
  fromName,
  toName,
  clueOnly = false,
  onCancel,
  onSave,
}: {
  fromName: string;
  toName: string;
  /** Цель — тайна: проход в понятие не ведёт, только улика. */
  clueOnly?: boolean;
  onCancel: () => void;
  onSave: (kind: LinkKind, text: string, how: string) => void | Promise<void>;
}) {
  const [kind, setKind] = useState<LinkKind>("clue");
  const [text, setText] = useState("");
  const [how, setHow] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (kind === "clue" && !text.trim()) return;
    setBusy(true);
    try {
      await onSave(kind, text.trim(), how.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onCancel} ariaLabel="Новая связь">
      <form className="clue-dialog" onSubmit={submit}>
        <div className="clue-dialog__head">
          <span className="canvas-props__label">Новая связь</span>
          <span className="clue-dialog__route">
            {fromName} → {toName}
          </span>
        </div>
        {!clueOnly && (
        <div className="seg" role="group" aria-label="Вид связи">
          <button type="button" className={kind === "clue" ? "is-active" : ""} onClick={() => setKind("clue")}>
            Улика
          </button>
          <button type="button" className={kind === "passage" ? "is-active" : ""} onClick={() => setKind("passage")}>
            Проход
          </button>
        </div>
        )}
        <label className="clue-dialog__field">
          <span className="canvas-props__label">{kind === "clue" ? "Что находят" : "Условие прохода · необязательно"}</span>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={kind === "clue" ? "Фонарь с клеймом гильдии под верстаком" : "дверь в подвал, после боя"}
          />
        </label>
        {kind === "clue" && (
          <label className="clue-dialog__field">
            <span className="canvas-props__label">Как найти · необязательно</span>
            <input value={how} onChange={(e) => setHow(e.target.value)} placeholder="обыскать, расспросить, подслушать…" />
          </label>
        )}
        <div className="clue-dialog__foot">
          <span className="muted">Enter — сохранить · Esc — не создавать</span>
          <button type="button" onClick={onCancel}>
            Отмена
          </button>
          <button type="submit" className="primary" disabled={busy || (kind === "clue" && !text.trim())}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Окно улик одной стрелки ──────────────────────────────────────────────

/**
 * Щелчок по стрелке «×N» (Q19): все улики этой пары, правка на месте.
 *
 * Стрелка на холсте называет ПОКАЗАННЫЕ строки (копия кампании), а улики
 * записаны по оригиналам — пересчёт через `nodes` из ответа сервера.
 */
export function ClueEdgeDialog({
  arcId,
  campaignId,
  fromShownId,
  toShownId,
  toSecret = false,
  fromName,
  toName,
  onClose,
}: {
  arcId: number;
  campaignId: number | null;
  fromShownId: number;
  /** Показанная сцена — или id тайны, если toSecret. */
  toShownId: number;
  toSecret?: boolean;
  fromName: string;
  toName: string;
  onClose: () => void;
}) {
  const act = useAction();
  const data = useResource<ArcClues>(arcCluesPath(arcId, campaignId)).data;
  const original = (shown: number) => data?.nodes.find((n) => n.shown_id === shown)?.id ?? null;
  const from = original(fromShownId);
  const targetType = toSecret ? "secret" : "scene";
  const to = toSecret ? toShownId : original(toShownId);
  const clues = (data?.clues ?? []).filter(
    (c) => c.node_id === from && c.target_type === targetType && c.target_id === to
  );
  // Записи — без кампании, как весь холст: он правит ту строку, что показана
  // (копию кампании, если она есть), и копий сам не заводит.
  const put = (id: number, patch: Partial<StoryClue>) =>
    act(() => write.put(`/story/clues/${id}`, patch), {
      affects: clueAffects(),
    });
  const remove = (id: number) =>
    act(() => write.del(`/story/clues/${id}`), {
      affects: clueAffects(),
    });
  const add = () =>
    act(
      () => write.post(`/story/scenes/${fromShownId}/clues`, { text: "Новая улика", target_type: targetType, target_id: toShownId }),
      { affects: clueAffects(), retry: false }
    );

  return (
    <Modal onClose={onClose} ariaLabel="Улики стрелки">
      <div className="clue-dialog">
        <div className="clue-dialog__head">
          <span className="canvas-props__label">Улики · {clues.length}</span>
          <span className="clue-dialog__route">
            {fromName} → {toName}
          </span>
        </div>
        {!data && <span className="muted">Загрузка…</span>}
        {clues.map((c) => (
          <div className={`clue-dialog__row${c.proposed ? " is-proposed" : ""}`} key={c.id}>
            <input
              aria-label="Что находят"
              defaultValue={c.text}
              onBlur={(e) => e.target.value.trim() !== c.text && void put(c.id, { text: e.target.value.trim() })}
            />
            <input
              aria-label="Как найти"
              placeholder="как найти"
              defaultValue={c.how}
              onBlur={(e) => e.target.value.trim() !== c.how && void put(c.id, { how: e.target.value.trim() })}
            />
            {c.proposed ? (
              <button type="button" className="primary" onClick={() => void put(c.id, { proposed: 0 })}>
                Принять
              </button>
            ) : null}
            <button type="button" className="danger" onClick={() => void remove(c.id)} aria-label={`Удалить улику «${c.text}»`}>
              {c.proposed ? "Отклонить" : "Удалить"}
            </button>
          </div>
        ))}
        <div className="clue-dialog__foot">
          <button type="button" onClick={() => void add()}>
            + Улика
          </button>
          <button type="button" className="primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Лоток неразмещённых ──────────────────────────────────────────────────

/**
 * Улики без места (Q9): тащат на узел, где их находят. Цель задаётся потом —
 * стрелкой или в карточке узла. Пустой лоток не показывается вовсе.
 */
export function ClueTray({ clues }: { clues: { id: number; text: string; how: string }[] }) {
  // На узком экране лоток открытым закрыл бы собой весь холст — там он
  // начинает свёрнутой полоской.
  const [open, setOpen] = useState(() => window.matchMedia("(min-width: 900px)").matches);
  if (clues.length === 0) return null;
  const onDragStart = (e: DragEvent, id: number) => {
    e.dataTransfer.setData(CLUE_DRAG_MIME, String(id));
    e.dataTransfer.effectAllowed = "move";
  };
  return (
    <aside className="clue-tray nopan nowheel nodrag" aria-label="Неразмещённые улики">
      <button type="button" className="clue-tray__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>Неразмещённые улики · {clues.length}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="clue-tray__body">
          <p className="clue-tray__hint">Перетащите улику на узел, где её находят. Цель — стрелкой.</p>
          {clues.map((c) => (
            <div key={c.id} className="clue-tray__card" draggable onDragStart={(e) => onDragStart(e, c.id)} title={c.text}>
              {c.text}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

// ─── Карточка узла: улики ─────────────────────────────────────────────────

/** Путь графа улик приключения — общий ключ кэша для холста и карточки. */
function arcCluesPath(arcId: number, campaignId: number | null) {
  return `/story/arcs/${arcId}/clues${campaignId ? `?campaign_id=${campaignId}` : ""}`;
}

/**
 * «Ведут сюда» и «Улики здесь» (макет Node-Panel, Q17/Q18/Q20).
 *
 * Входящие правятся в карточке узла-источника: здесь только «найдено». Свои
 * улики — на месте: текст, как найти, цель (узел или тайна приключения).
 * Галочки «найдено» — только в кампании (Q27: вне её — одна структура).
 */
export function NodeCluesCard({
  sceneId,
  arcId,
  campaignId,
}: {
  sceneId: number;
  arcId: number;
  campaignId: number | null;
}) {
  const act = useAction();
  const data = useResource<ArcClues>(arcCluesPath(arcId, campaignId)).data;
  const me = data?.nodes.find((n) => n.shown_id === sceneId);
  if (!data || !me) return null;
  const nameOf = (id: number | null) => data.nodes.find((n) => n.id === id)?.name ?? "?";
  const incoming = data.clues.filter((c) => c.target_type === "scene" && c.target_id === me.id);
  const outgoing = data.clues.filter((c) => c.node_id === me.id);
  // Счёт правила трёх — по принятым: предложенные ещё ничего не доказывают (Q29).
  const accepted = incoming.filter((c) => !c.proposed).length;

  // Тот же счёт, что у чипов на узле холста (Q11, Q31).
  let need: string | null = null;
  if (me.role === "start") need = "старт";
  else if (me.role === "proactive") need = "приходит сам";
  else if (me.role === "dead_end") need = "бонусные";
  else if (accepted < 3 && me.passage_in) need = "за проходом";
  const missing = need == null ? Math.max(0, 3 - accepted) : 0;

  const opts = { affects: clueAffects() };
  const setFound = (c: ArcClue, found: boolean) =>
    act(() => write.put(`/story/clues/${c.id}/state`, { campaign_id: campaignId, found }), opts);
  const put = (id: number, patch: Partial<StoryClue>) => act(() => write.put(`/story/clues/${id}`, patch), opts);
  const add = () =>
    act(() => write.post(`/story/scenes/${sceneId}/clues`, { text: "Новая улика" }), { ...opts, retry: false });

  const foundBox = (c: ArcClue) =>
    campaignId != null && (
      <input type="checkbox" checked={c.found} onChange={(e) => void setFound(c, e.target.checked)} aria-label="Найдено" />
    );

  return (
    <>
      <div className="card stack node-clues">
        <div className="node-clues__head">
          <span className="canvas-props__label">Ведут сюда · {accepted}</span>
          {need != null ? (
            <span className="canvas-node__chip">{need}</span>
          ) : missing > 0 ? (
            <span className="canvas-node__chip is-bad">нужно ещё {missing}</span>
          ) : null}
        </div>
        {campaignId != null && incoming.length + outgoing.length > 0 && (
          <span className="muted node-clues__note">✓ — найдено в этой кампании</span>
        )}
        {incoming.length === 0 && <span className="muted">Сюда не ведёт ни одна улика — протяните стрелку к узлу.</span>}
        {incoming.map((c) => (
          <div key={c.id} className={`node-clue${c.found ? " is-found" : ""}${c.proposed ? " is-proposed" : ""}`}>
            {c.proposed ? null : foundBox(c)}
            <span className="node-clue__text">{c.text}</span>
            <span className="node-clue__meta">
              в: {nameOf(c.node_id)}
              {c.how && ` · ${c.how}`}
              {c.proposed ? <ProposedActions id={c.id} put={put} act={act} /> : null}
            </span>
          </div>
        ))}
      </div>

      <div className="card stack node-clues">
        <div className="node-clues__head">
          <span className="canvas-props__label">Улики здесь · {outgoing.length}</span>
        </div>
        {outgoing.map((c) => (
          <OwnClueRow key={c.id} clue={c} data={data} selfId={me.id} foundBox={foundBox(c)} put={put} act={act} />
        ))}
        <button type="button" className="node-clues__add" onClick={() => void add()}>
          + Улика
        </button>
      </div>
    </>
  );
}

function OwnClueRow({
  clue,
  data,
  selfId,
  foundBox,
  put,
  act,
}: {
  clue: ArcClue;
  data: ArcClues;
  selfId: number;
  foundBox: ReactNode;
  put: (id: number, patch: Partial<StoryClue>) => Promise<unknown>;
  act: ReturnType<typeof useAction>;
}) {
  const target = clue.target_missing || clue.target_type == null ? "" : `${clue.target_type}:${clue.target_id}`;
  return (
    <div className={`node-clue${clue.found ? " is-found" : ""}${clue.proposed ? " is-proposed" : ""}`}>
      {clue.proposed ? null : foundBox}
      <input
        className="node-clue__text"
        aria-label="Что находят"
        defaultValue={clue.text}
        onBlur={(e) => e.target.value.trim() !== clue.text && void put(clue.id, { text: e.target.value.trim() })}
      />
      <div className="node-clue__meta">
        <input
          aria-label="Как найти"
          placeholder="как найти"
          defaultValue={clue.how}
          onBlur={(e) => e.target.value.trim() !== clue.how && void put(clue.id, { how: e.target.value.trim() })}
        />
        {clue.target_missing && <span className="canvas-node__chip is-bad">ведёт в никуда</span>}
        {clue.proposed ? <ProposedActions id={clue.id} put={put} act={act} /> : null}
        <select
          aria-label="Куда ведёт"
          value={target}
          onChange={(e) => {
            const [type, id] = e.target.value.split(":");
            void put(
              clue.id,
              type ? { target_type: type as "scene" | "secret", target_id: Number(id) } : { target_type: null, target_id: null }
            );
          }}
        >
          <option value="">— цель не выбрана —</option>
          <optgroup label="Узлы">
            {data.nodes
              .filter((n) => n.id !== selfId)
              .map((n) => (
                <option key={n.id} value={`scene:${n.id}`}>
                  → {n.name}
                </option>
              ))}
          </optgroup>
          {data.secrets.length > 0 && (
            <optgroup label="Тайны">
              {data.secrets.map((t) => (
                <option key={t.id} value={`secret:${t.id}`}>
                  ◇ {t.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          className="node-clue__del"
          title="Удалить улику"
          aria-label={`Удалить улику «${clue.text}»`}
          onClick={() => void act(() => write.del(`/story/clues/${clue.id}`), { affects: clueAffects() })}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ─── Карточка узла: «о ком» ───────────────────────────────────────────────

/**
 * Одна сущность мира, о которой узел (Q26): имя открывает её в доке
 * предпросмотра, ✕ убирает, «Выбрать…» — то же окно, что у @-упоминаний.
 */
export function NodeSubjectField({
  type,
  id,
  title,
  settingId,
  onChange,
}: {
  type: string | null;
  id: number | null;
  title: string | null;
  settingId?: number;
  onChange: (next: { type: string; id: number } | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="canvas-props__field">
      <span className="canvas-props__label">О ком · о чём</span>
      <div className="row" style={{ gap: 6 }}>
        {type && id ? (
          <>
            <button type="button" className="node-subject" onClick={() => openPreviewDockCard({ type, id })}>
              {title ?? "сущность удалена"}
            </button>
            <button type="button" aria-label="Убрать" onClick={() => onChange(null)}>
              ✕
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setPicking(true)}>
            Выбрать…
          </button>
        )}
      </div>
      {picking && (
        <MentionPickerModal
          initialQuery=""
          heading="О ком · о чём"
          direct
          defaultSettingId={settingId}
          onClose={() => setPicking(false)}
          onPick={(r) => {
            setPicking(false);
            onChange({ type: r.type, id: r.id });
          }}
        />
      )}
    </div>
  );
}

// ─── Предложенные улики ───────────────────────────────────────────────────

/** «Принять / отклонить» у предложенной улики (Q29). */
function ProposedActions({
  id,
  put,
  act,
}: {
  id: number;
  put: (id: number, patch: Partial<StoryClue>) => Promise<unknown>;
  act: ReturnType<typeof useAction>;
}) {
  return (
    <>
      <span className="canvas-node__chip">предложена</span>
      <button type="button" className="primary" onClick={() => void put(id, { proposed: 0 })}>
        Принять
      </button>
      <button type="button" onClick={() => void act(() => write.del(`/story/clues/${id}`), { affects: clueAffects() })}>
        Отклонить
      </button>
    </>
  );
}

/**
 * «Предложить улики» (Q28): как импорт книги — запрос копируется во внешний
 * чат, ответ вставляется сюда. Предложенные ложатся пунктиром и в правило
 * трёх не идут, пока их не примут: здесь все разом или по одной в карточке.
 */
export function ProposeCluesDialog({
  arcId,
  campaignId,
  onClose,
}: {
  arcId: number;
  campaignId: number | null;
  onClose: () => void;
}) {
  const act = useAction();
  const q = campaignId ? `?campaign_id=${campaignId}` : "";
  const data = useResource<ArcClues>(arcCluesPath(arcId, campaignId)).data;
  const pending = (data?.clues ?? []).filter((c) => c.proposed).length;
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function copyPrompt() {
    setBusy(true);
    try {
      const { prompt } = await readResource<{ prompt: string }>(`/story/arcs/${arcId}/clues/prompt${q}`, { fresh: true });
      await navigator.clipboard.writeText(prompt);
      setStatus("Запрос скопирован — вставьте его в чат нейросети, а ответ — ниже.");
    } catch {
      setStatus("Не удалось скопировать запрос.");
    } finally {
      setBusy(false);
    }
  }

  async function parse() {
    setBusy(true);
    try {
      const res = (await act(
        () => write.post(`/story/arcs/${arcId}/clues/proposals`, { answer, campaign_id: campaignId }),
        { affects: clueAffects(), retry: false }
      )) as { added: number; skipped: { index: number; reason: string }[] } | undefined;
      if (res) {
        setStatus(
          `Добавлено предложений: ${res.added}.` +
            (res.skipped.length ? ` Пропущено ${res.skipped.length}: ${res.skipped.map((x) => x.reason).join("; ")}.` : "")
        );
        setAnswer("");
      }
    } finally {
      setBusy(false);
    }
  }

  const all = (accept: boolean) =>
    act(
      () =>
        accept
          ? write.post(`/story/arcs/${arcId}/clues/proposals/accept`, { campaign_id: campaignId })
          : write.del(`/story/arcs/${arcId}/clues/proposals${q}`),
      { affects: clueAffects(), retry: false }
    );

  return (
    <Modal onClose={onClose} ariaLabel="Предложить улики">
      <div className="clue-dialog propose-dialog">
        <div className="clue-dialog__head">
          <span className="canvas-props__label">Предложить улики</span>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          1. Скопируйте запрос — в нём узлы приключения, их улики и где не хватает до трёх. 2. Вставьте его в чат
          нейросети. 3. Ответ вставьте сюда. Предложенные улики лягут пунктиром и не будут считаться, пока вы их не
          примете.
        </p>
        <button type="button" onClick={() => void copyPrompt()} disabled={busy}>
          Скопировать запрос
        </button>
        <label className="clue-dialog__field">
          <span className="canvas-props__label">Ответ чата</span>
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder='{"clues": [ … ]}' />
        </label>
        {status && <span className="muted">{status}</span>}
        <div className="clue-dialog__foot">
          {pending > 0 && (
            <>
              <span className="muted">Предложено: {pending}</span>
              <button type="button" onClick={() => void all(false)}>
                Отклонить все
              </button>
              <button type="button" onClick={() => void all(true)}>
                Принять все
              </button>
            </>
          )}
          <button type="button" className="primary" disabled={busy || !answer.trim()} onClick={() => void parse()}>
            Разобрать ответ
          </button>
        </div>
      </div>
    </Modal>
  );
}
