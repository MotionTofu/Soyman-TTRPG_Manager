import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { GmReminder, RosterPlayer } from "../../types";
import { useConfirm } from "../../hooks/useConfirm";
import { resourceQuery, useAction, useResource, write } from "../../data/hooks";
import { remindersPath } from "../../data/sessions";
import { NavIcon } from "../NavIcons";

const NO_REMINDERS: GmReminder[] = [];

/**
 * «Партия · Напоминания» (макет Camp-Party-Reminders): всё, что сейчас висит
 * у игроков на Главной, — общее кампании и личное каждому игроку состава.
 * Адресат — «Всем» (напоминание кампании) или игрок (его личное, то же, что
 * пишется из профиля игрока). Ниже — как увидит выбранный игрок.
 */
export function CampaignReminders({ campaignId, roster }: { campaignId: number; roster: RosterPlayer[] }) {
  const [confirmDialog, confirm] = useConfirm();
  const run = useAction();
  const players = roster.filter((p) => p.roster_status !== "left");
  const campaignPath = remindersPath("campaign", campaignId);
  const common = useResource<GmReminder[]>(campaignPath).data ?? NO_REMINDERS;
  const personal = useQueries({
    queries: players.map((p) => resourceQuery<GmReminder[]>(remindersPath("player", p.id))),
  });
  const rows = [
    ...common.map((r) => ({ r, path: campaignPath, who: "Всем" })),
    ...players.flatMap((p, i) => (personal[i]?.data ?? NO_REMINDERS).map((r) => ({ r, path: remindersPath("player", p.id), who: p.name }))),
  ];
  const [draft, setDraft] = useState("");
  const [to, setTo] = useState("all");
  const [viewer, setViewer] = useState<number | null>(null);
  const viewerId = viewer ?? players[0]?.id ?? null;
  const viewerIndex = players.findIndex((p) => p.id === viewerId);
  const seen = [...common, ...(viewerIndex >= 0 ? (personal[viewerIndex]?.data ?? NO_REMINDERS) : NO_REMINDERS)];

  async function add() {
    const message = draft.trim();
    if (!message) return;
    const path = to === "all" ? campaignPath : remindersPath("player", Number(to));
    // Без повтора: ответ мог потеряться после записи, и повтор завёл бы второе.
    const done = await run(async () => (await write.post(path, { message }), true), { affects: [{ path }], retry: false });
    if (done) setDraft("");
  }

  async function remove(path: string, id: number) {
    if (!(await confirm({ message: "Удалить напоминание?", confirmLabel: "Удалить", danger: true }))) return;
    await run(() => write.del(`${path}/${id}`), { affects: [{ path }] });
  }

  return (
    <section className="campaign-reminders">
      {confirmDialog}
      <div className="d-head">
        <div>
          <h2>Напоминания игрокам</h2>
          <div className="d-head__sub">видны на Главной игроков</div>
        </div>
      </div>
      <div className="d-gh">
        <h3 className="d-plate">Сейчас висят</h3>
        <span className="d-note">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="campaign-reminders__empty">Ничего не висит — напишите первое, оно появится у игроков на Главной.</p>
      ) : (
        <ul className="campaign-reminders__list">
          {rows.map(({ r, path, who }) => (
            <li key={`${path}/${r.id}`}>
              <NavIcon name="bell" />
              <span className="campaign-reminders__text">{r.message}</span>
              <span className="d-mono">{who}</span>
              <button type="button" className="d-dots" aria-label="Удалить напоминание" onClick={() => void remove(path, r.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="campaign-reminders__add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label className="d-field">
          <input placeholder="Текст напоминания…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Текст напоминания" />
        </label>
        <select className="d-select" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Кому">
          <option value="all">Всем</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="submit" className="d-btn" disabled={!draft.trim()}>Добавить</button>
      </form>
      {players.length > 0 && (
        <div className="campaign-reminders__preview">
          <div className="d-mono">
            Так видит{" "}
            <select value={viewerId ?? ""} onChange={(e) => setViewer(Number(e.target.value))} aria-label="Чьими глазами">
              {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>{" "}
            на Главной
          </div>
          {seen.length ? <ul>{seen.map((r) => <li key={r.id + r.target_type}>{r.message}</li>)}</ul> : <p className="d-note">Пусто.</p>}
        </div>
      )}
    </section>
  );
}
