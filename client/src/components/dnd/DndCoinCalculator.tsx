import { useEffect, useMemo, useState } from "react";
import { Modal } from "../Modal";
import type { DndCoins } from "../../types";
import {
  fetchTransferParty,
  offerMoneyTransfer,
  type TransferPartyMember,
} from "./characterTransfers";

// Калькулятор монет: курс книги, добыча пулом, делёж на отряд с записью себе
// и рассылкой долей существующими денежными переводами (получателю при этом
// само падает напоминание «X передал: …» — отдельного канала сообщений
// игрок→игрок в приложении нет, и он здесь не заводится).
//
// Курс (медный базис): мм=1, см=10, эм=50, зм=100, пм=1000.
// Делёж нормализуется без электрума (пм/зм/см/мм) — решение владельца:
// так читаемее, эм в дележе только шумит.

export type CoinKey = "cp" | "sp" | "ep" | "gp" | "pp";

const COIN_DEFS: { key: CoinKey; label: string; title: string; rate: number }[] = [
  { key: "cp", label: "мм", title: "Медные монеты", rate: 1 },
  { key: "sp", label: "см", title: "Серебряные монеты", rate: 10 },
  { key: "ep", label: "эм", title: "Электрумовые монеты", rate: 50 },
  { key: "gp", label: "зм", title: "Золотые монеты", rate: 100 },
  { key: "pp", label: "пм", title: "Платиновые монеты", rate: 1000 },
];

type CoinNums = Record<CoinKey, number>;

const ZERO_POOL: Record<CoinKey, string> = { cp: "", sp: "", ep: "", gp: "", pp: "" };

function num(v: string | number | undefined): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 999999) : 0;
}

function poolToCp(pool: Record<CoinKey, string>): number {
  return COIN_DEFS.reduce((sum, d) => sum + num(pool[d.key]) * d.rate, 0);
}

/** Разбить медь на пм/зм/см/мм (без эм — решение владельца). */
function cpToCoins(cp: number): CoinNums {
  const pp = Math.floor(cp / 1000);
  const gp = Math.floor((cp % 1000) / 100);
  const sp = Math.floor((cp % 100) / 10);
  return { cp: cp % 10, sp, ep: 0, gp, pp };
}

/** Коротко: «12 зм 3 см», нули пропускаются. */
function formatCoinsShort(c: CoinNums): string {
  const names: Record<CoinKey, string> = { cp: "мм", sp: "см", ep: "эм", gp: "зм", pp: "пм" };
  const parts = (Object.keys(names) as CoinKey[])
    .reverse()
    .filter((k) => c[k] > 0)
    .map((k) => `${c[k]} ${names[k]}`);
  return parts.length > 0 ? parts.join(" ") : "—";
}

function addToCoins(own: DndCoins, add: CoinNums): DndCoins {
  return {
    cp: String(num(own.cp) + add.cp),
    sp: String(num(own.sp) + add.sp),
    ep: String(num(own.ep) + add.ep),
    gp: String(num(own.gp) + add.gp),
    pp: String(num(own.pp) + add.pp),
  };
}

export function DndCoinCalculator({
  campaignId,
  senderId,
  senderName,
  ownCoins,
  onCommitCoins,
  onChanged,
  onClose,
  bare,
}: {
  campaignId: number | null | undefined;
  /** Свой персонаж (владелец листа). Без него — только подсчёт. */
  senderId: number | null | undefined;
  senderName: string;
  ownCoins: DndCoins;
  onCommitCoins: (c: DndCoins) => void;
  /** После успешных отправок: дотянуть списки передач/входящих. */
  onChanged: () => void;
  onClose: () => void;
  /** Без своей модалки — встройка в чужой диалог (окно передач). */
  bare?: boolean;
}) {
  const [pool, setPool] = useState<Record<CoinKey, string>>(ZERO_POOL);
  const [party, setParty] = useState<TransferPartyMember[] | null>(null);
  const [partyError, setPartyError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [selfChecked, setSelfChecked] = useState(true);
  const [takeAllFirst, setTakeAllFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Защита от двойной записи: что уже применено под текущий ключ пула/состава.
  const [takenKey, setTakenKey] = useState<string | null>(null);
  const [sharedKey, setSharedKey] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    if (campaignId == null) return;
    let alive = true;
    fetchTransferParty(campaignId).then(
      (rows) => {
        if (!alive) return;
        const others = rows.filter((m) => m.id !== senderId);
        setParty(others);
        // По умолчанию делим на всех — снять лишних быстрее, чем вспоминать.
        const all: Record<number, boolean> = {};
        for (const m of others) all[m.id] = true;
        setChecked(all);
      },
      (e) => {
        if (alive) setPartyError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => {
      alive = false;
    };
  }, [campaignId, senderId]);

  const poolCp = poolToCp(pool);
  const members = useMemo(() => {
    const list: { id: number; name: string; self: boolean }[] = [];
    if (selfChecked && senderId != null) list.push({ id: senderId, name: `${senderName || "Я"} (я)`, self: true });
    for (const m of party ?? []) {
      if (checked[m.id]) list.push({ id: m.id, name: m.player_name ? `${m.character_name} · ${m.player_name}` : m.character_name, self: false });
    }
    return list;
  }, [selfChecked, senderId, senderName, party, checked]);
  const others = useMemo(() => members.filter((m) => !m.self), [members]);
  const n = members.length;
  const shareCp = n > 0 ? Math.floor(poolCp / n) : 0;
  const restCp = n > 0 ? poolCp - shareCp * n : 0;
  const shareCoins = useMemo(() => cpToCoins(shareCp), [shareCp]);
  // Ключ состава: пул + кто в дележе. Смена состава снимает блокировки.
  const setupKey = JSON.stringify([pool, members.map((m) => m.id)]);

  const canWrite = senderId != null;
  const canSend = senderId != null && campaignId != null;

  function setPoolKey(key: CoinKey, v: string) {
    setPool((p) => ({ ...p, [key]: v.replace(/[^\d]/g, "").slice(0, 6) }));
  }
  function bumpPool(key: CoinKey, delta: number) {
    setPool((p) => ({ ...p, [key]: String(Math.max(0, num(p[key]) + delta)) }));
  }

  function takeAll() {
    if (!canWrite || poolCp === 0) return;
    const add: CoinNums = { cp: num(pool.cp), sp: num(pool.sp), ep: num(pool.ep), gp: num(pool.gp), pp: num(pool.pp) };
    onCommitCoins(addToCoins(ownCoins, add));
    setTakenKey(setupKey);
    setPool(ZERO_POOL);
  }

  function takeShare() {
    if (!canWrite || !selfChecked || shareCp === 0 || sharedKey === setupKey || takenKey === setupKey) return;
    onCommitCoins(addToCoins(ownCoins, shareCoins));
    setSharedKey(setupKey);
  }

  async function distribute() {
    if (!canSend || busy || poolCp === 0 || others.length === 0) return;
    setBusy(true);
    setFormError(null);
    try {
      // Добыча виртуальна, а перевод списывает с кармана — поэтому сначала
      // забрать всё (если включено), потом разослать. Своя доля при этом уже
      // в кармане, остаток тоже оседает у отправителя.
      if (takeAllFirst && takenKey !== setupKey) {
        const add: CoinNums = { cp: num(pool.cp), sp: num(pool.sp), ep: num(pool.ep), gp: num(pool.gp), pp: num(pool.pp) };
        onCommitCoins(addToCoins(ownCoins, add));
        setTakenKey(setupKey);
        setSharedKey(setupKey);
      } else if (!takeAllFirst && restCp > 0) {
        // Без взятия всего остаток нигде не учтён — кладём его себе медью.
        onCommitCoins(addToCoins(ownCoins, { cp: restCp, sp: 0, ep: 0, gp: 0, pp: 0 }));
      }
      const nextStatus: Record<number, string> = {};
      const nextSent = new Set(sentIds);
      for (const m of others) {
        if (nextSent.has(m.id)) {
          nextStatus[m.id] = "уже отправлено";
          continue;
        }
        try {
          await offerMoneyTransfer({ senderId: senderId!, recipientId: m.id, coins: { ...shareCoins } });
          nextSent.add(m.id);
          nextStatus[m.id] = `отправлено: ${formatCoinsShort(shareCoins)}`;
        } catch (e) {
          nextStatus[m.id] = `не вышло: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      setSentIds(nextSent);
      setStatus(nextStatus);
      setSharedKey(setupKey);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const totalGp = Math.floor(poolCp / 100) + ((poolCp % 100) / 100);
  const sentCount = others.filter((m) => sentIds.has(m.id)).length;

  const body = (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Калькулятор монет</h3>
        <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)" }}>
        Курс книги: 10 мм = 1 см · 5 см = 1 эм · 2 эм = 1 зм · 10 зм = 1 пм. Делёж — без эм.
      </p>

      <span className="sb-prop-label">Добыча</span>
      <div className="stack" style={{ gap: 4 }}>
        {COIN_DEFS.map((d) => (
          <div className="row" key={d.key} style={{ gap: 6, alignItems: "center" }}>
            <span className="muted" style={{ flex: "0 0 88px" }} title={d.title}>
              {d.title}
            </span>
            <span className="row" style={{ gap: 2 }} role="group" aria-label={d.title}>
              <button type="button" className="comp-mini dnd-qty-step" aria-label={`Меньше ${d.label}`} onClick={() => bumpPool(d.key, -1)}>
                −
              </button>
              <input
                value={pool[d.key]}
                onChange={(e) => setPoolKey(d.key, e.target.value)}
                aria-label={`${d.title}: количество`}
                placeholder="0"
                inputMode="numeric"
                style={{ width: 64, textAlign: "center" }}
              />
              <button type="button" className="comp-mini dnd-qty-step" aria-label={`Больше ${d.label}`} onClick={() => bumpPool(d.key, 1)}>
                +
              </button>
            </span>
          </div>
        ))}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Всего ≈ <span className="dnd-summary-num">{String(Math.round(totalGp * 10) / 10).replace(".", ",")} ЗМ</span>
        {poolCp > 0 && <span> ({poolCp} мм)</span>}
      </p>

      <span className="sb-prop-label">Делёж{n > 0 ? ` на ${n}` : ""}</span>
      {campaignId == null ? (
        <p className="muted" style={{ margin: 0 }}>
          Персонаж вне кампании — делить не с кем, только подсчёт и запись себе.
        </p>
      ) : partyError ? (
        <p className="muted" style={{ margin: 0 }}>Партия не загрузилась: {partyError}</p>
      ) : party === null ? (
        <p className="muted" style={{ margin: 0 }}>Загрузка партии…</p>
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          <label className="row" style={{ gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={selfChecked} onChange={(e) => setSelfChecked(e.target.checked)} />
            {senderName || "Я"} (я)
          </label>
          {party.map((m) => (
            <label className="row" key={m.id} style={{ gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!checked[m.id]}
                onChange={(e) => setChecked((c) => ({ ...c, [m.id]: e.target.checked }))}
              />
              <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                {m.character_name}
                {m.player_name && <span className="muted"> · {m.player_name}</span>}
              </span>
              {status[m.id] && (
                <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                  {status[m.id]}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      {poolCp > 0 && n > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Доля: <span className="dnd-summary-num">{formatCoinsShort(shareCoins)}</span>
          {restCp > 0 && <span> · остаток: <span className="dnd-summary-num">{restCp} мм</span> — отправителю</span>}
        </p>
      )}

      <label className="row muted" style={{ gap: 6, alignItems: "center", fontSize: "var(--fs-meta)" }}>
        <input
          type="checkbox"
          checked={takeAllFirst}
          onChange={(e) => setTakeAllFirst(e.target.checked)}
          disabled={!canSend}
        />
        добыча у меня: сначала забрать всё, потом разослать
      </label>
      {formError && (
        <p className="sb-save-error" role="status">
          {formError}
        </p>
      )}
      <div className="row picker-footer" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="primary"
          disabled={!canSend || busy || poolCp === 0 || others.length === 0}
          onClick={() => void distribute()}
          title={canSend ? "Взять добычу (если включено) и разослать доли выбранным" : "Нужны кампания и свой персонаж"}
        >
          {busy ? "Рассылаю…" : `Разослать доли${sentCount > 0 ? ` (${sentCount})` : ""}`}
        </button>
        <button
          type="button"
          disabled={!canWrite || !selfChecked || shareCp === 0 || sharedKey === setupKey || takenKey === setupKey}
          onClick={takeShare}
          title="Добавить только свою долю в свой кошелёк"
        >
          Записать мою долю
        </button>
        <button
          type="button"
          disabled={!canWrite || poolCp === 0 || takenKey === setupKey}
          onClick={takeAll}
          title="Добавить всю добычу в свой кошелёк"
        >
          Забрать всё себе
        </button>
        <button type="button" onClick={onClose}>
          {bare ? "← Назад" : "Закрыть"}
        </button>
      </div>
    </div>
  );
  if (bare) return body;
  return (
    <Modal wide onClose={onClose}>
      {body}
    </Modal>
  );
}
