// Улики на холсте приключения (гриллинг «Узловой дизайн» 2026-09-28):
// окно новой связи, окно улик одной стрелки и лоток неразмещённых.
//
// Лежит отдельно от CanvasPage.tsx: страница и так восемь тысяч строк, а
// здесь всё про одно — улику как стрелку.

import { useState, type DragEvent, type FormEvent } from "react";
import { Modal } from "./Modal";
import { useAction, useResource, write } from "../data/hooks";
import { CLUE_DRAG_MIME, clueAffects } from "../data/canvas";
import type { StoryClue } from "../types";

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
  onCancel,
  onSave,
}: {
  fromName: string;
  toName: string;
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
        <div className="seg" role="group" aria-label="Вид связи">
          <button type="button" className={kind === "clue" ? "is-active" : ""} onClick={() => setKind("clue")}>
            Улика
          </button>
          <button type="button" className={kind === "passage" ? "is-active" : ""} onClick={() => setKind("passage")}>
            Проход
          </button>
        </div>
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

interface GraphClue extends StoryClue {
  node_id: number | null;
}
interface GraphNode {
  id: number;
  shown_id: number;
}
interface ArcClues {
  clues: GraphClue[];
  nodes: GraphNode[];
}

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
  fromName,
  toName,
  onClose,
}: {
  arcId: number;
  campaignId: number | null;
  fromShownId: number;
  toShownId: number;
  fromName: string;
  toName: string;
  onClose: () => void;
}) {
  const act = useAction();
  const path = `/story/arcs/${arcId}/clues${campaignId ? `?campaign_id=${campaignId}` : ""}`;
  const data = useResource<ArcClues>(path).data;
  const original = (shown: number) => data?.nodes.find((n) => n.shown_id === shown)?.id ?? null;
  const from = original(fromShownId);
  const to = original(toShownId);
  const clues = (data?.clues ?? []).filter(
    (c) => c.node_id === from && c.target_type === "scene" && c.target_id === to
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
      () => write.post(`/story/scenes/${fromShownId}/clues`, { text: "Новая улика", target_type: "scene", target_id: toShownId }),
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
          <div className="clue-dialog__row" key={c.id}>
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
            <button type="button" className="danger" onClick={() => void remove(c.id)} aria-label={`Удалить улику «${c.text}»`}>
              Удалить
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
  const [open, setOpen] = useState(true);
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
