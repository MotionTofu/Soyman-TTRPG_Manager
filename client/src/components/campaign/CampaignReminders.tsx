import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { GmReminder, RosterPlayer, SessionSummary } from "../../types";
import { useConfirm } from "../../hooks/useConfirm";
import { resourceQuery, useAction, useResource, write } from "../../data/hooks";
import { reminderDueLabel, remindersPath, sessionPaths } from "../../data/sessions";
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
  ].sort((a, b) => Number(!!a.r.due?.expired) - Number(!!b.r.due?.expired)); // истёкшие — в конец (В4, Q1)
  // Срок — только запланированные сессии этой кампании (В4, Q2); сервер отдаёт их по дате.
  const planned = (useResource<SessionSummary[]>(sessionPaths.campaignSessions(campaignId)).data ?? []).filter(
    (s) => s.status === "planned" && s.session_number != null
  );
  const [draft, setDraft] = useState("");
  const [to, setTo] = useState("all");
  const [due, setDue] = useState("");
  const [viewer, setViewer] = useState<number | null>(null);
  const viewerId = viewer ?? players[0]?.id ?? null;
  const viewerIndex = players.findIndex((p) => p.id === viewerId);
  const seen = [...common, ...(viewerIndex >= 0 ? (personal[viewerIndex]?.data ?? NO_REMINDERS) : NO_REMINDERS)].filter(
    (r) => !r.due?.expired
  );

  async function add() {
    const message = draft.trim();
    if (!message) return;
    const path = to === "all" ? campaignPath : remindersPath("player", Number(to));
    // Без повтора: ответ мог потеряться после записи, и повтор завёл бы второе.
    const body = { message, due_session_id: due ? Number(due) : null };
    const done = await run(async () => (await write.post(path, body), true), { affects: [{ path }], retry: false });
    if (done) { setDraft(""); setDue(""); }
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
            <li key={`${path}/${r.id}`} className={r.due?.expired ? "is-expired" : undefined}>
              <NavIcon name="bell" />
              <span className="campaign-reminders__text">{r.message}</span>
              <span className="d-mono" title={r.due ? reminderDueLabel(r.due) : undefined}>
                {who}
                {r.due && (r.due.expired ? " · истекло" : ` · к №${r.due.number}`)}
              </span>
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
        <select className="d-select" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Срок">
          <option value="">Без срока</option>
          {planned.map((s) => <option key={s.id} value={s.id}>{reminderDueLabel({ number: s.session_number!, date: s.date }).replace(/^к/, "К")}</option>)}
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
          {seen.length ? <ul>{seen.map((r) => <li key={r.id + r.target_type}>{r.message}{r.due && <span className="d-mono"> · {reminderDueLabel(r.due)}</span>}</li>)}</ul> : <p className="d-note">Пусто.</p>}
        </div>
      )}
    </section>
  );
}
