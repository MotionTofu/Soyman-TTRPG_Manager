import { useEffect, useState } from "react";
import {
  fetchTransferParty,
  parseItemQty,
  type CharacterTransfer,
  type TransferAction,
  type TransferPartyMember,
} from "./characterTransfers";
import type { DndEquipmentSection } from "../../types";

// Инструмент передачи игрок→игрок на обороте карты (этап 4б). Живёт слотом
// в DndCardBack: списки и действия поднимает родитель (ему же нужен счётчик
// входящих для угла), здесь — форма отправки и разбор списков.
// Принятые пары (зелёные/фиолетовые строки) управляются из «Снаряжения» —
// там же, где вещь лежит; оборот решает только входящие офферы.

const COIN_FIELDS = [
  { key: "cp", label: "мм" },
  { key: "sp", label: "см" },
  { key: "ep", label: "эм" },
  { key: "gp", label: "зм" },
  { key: "pp", label: "пм" },
] as const;

export function DndTransferBox({
  color,
  campaignId,
  characterId,
  equipment,
  incoming,
  outgoing,
  loading,
  loadError,
  notice,
  busyId,
  onAction,
  onSendItem,
  onSendMoney,
  onRetry,
}: {
  color: string;
  campaignId: number | null | undefined;
  characterId: number;
  equipment: DndEquipmentSection[];
  incoming: CharacterTransfer[];
  outgoing: CharacterTransfer[];
  loading: boolean;
  loadError: string | null;
  notice: string | null;
  busyId: number | null;
  onAction: (id: number, action: TransferAction) => void;
  onSendItem: (args: { recipientId: number; section: number; index: number; name: string; qty: number; kind: "item" | "replica" }) => void;
  onSendMoney: (args: { recipientId: number; coins: { cp: number; sp: number; ep: number; gp: number; pp: number } }) => void;
  onRetry: () => void;
}) {
  // Партия для выбора получателя — тихий справочник, грузится сам.
  const [party, setParty] = useState<TransferPartyMember[] | null>(null);
  const [partyError, setPartyError] = useState<string | null>(null);
  useEffect(() => {
    if (campaignId == null) return;
    let alive = true;
    fetchTransferParty(campaignId).then(
      (rows) => {
        if (alive) setParty(rows.filter((m) => m.id !== characterId));
      },
      (e) => {
        if (alive) setPartyError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => {
      alive = false;
    };
  }, [campaignId, characterId]);

  // Форма отправки: кому — одно на вещь и деньги; что и сколько — отдельно.
  const [recipientId, setRecipientId] = useState<number | null>(null);
  const [itemKey, setItemKey] = useState("");
  const [qtyText, setQtyText] = useState("1");
  const [itemKind, setItemKind] = useState<"item" | "replica">("item");
  const [coinTexts, setCoinTexts] = useState<Record<string, string>>({ cp: "", sp: "", ep: "", gp: "", pp: "" });

  // Отдать можно только свободную строку: уже едущая или приехавшая вещь
  // второй раз не предлагается.
  const freeItems: { si: number; ii: number; name: string; have: number; section: string }[] = [];
  equipment.forEach((sec, si) =>
    sec.items.forEach((it, ii) => {
      if (it.transferOut || it.transferIn || it.pendingFrom) return;
      freeItems.push({ si, ii, name: it.name, have: parseItemQty(it.qty), section: sec.name });
    })
  );
  const picked = freeItems.find((f) => `${f.si}:${f.ii}` === itemKey) ?? null;
  const qtyNum = parseInt(qtyText, 10);
  const qtyOk = picked != null && Number.isFinite(qtyNum) && qtyNum >= 1 && qtyNum <= picked.have;
  const coins = {
    cp: Math.max(0, parseInt(coinTexts.cp || "0", 10) || 0),
    sp: Math.max(0, parseInt(coinTexts.sp || "0", 10) || 0),
    ep: Math.max(0, parseInt(coinTexts.ep || "0", 10) || 0),
    gp: Math.max(0, parseInt(coinTexts.gp || "0", 10) || 0),
    pp: Math.max(0, parseInt(coinTexts.pp || "0", 10) || 0),
  };
  const moneyOk = coins.cp + coins.sp + coins.ep + coins.gp + coins.pp > 0;

  const offered = incoming.filter((t) => t.state === "offered");
  const acceptedIn = incoming.filter((t) => t.state === "accepted");

  return (
    <div className="stack dnd-transfer-box">
      <div className="dnd-card-back-head" style={{ borderBottomColor: color }}>
        <span className="dnd-card-back-title">Передачи</span>
      </div>

      {loading && <p className="muted">Загрузка…</p>}
      {!loading && loadError && (
        <div className="stack">
          <span>Передачи не загрузились: {loadError}</span>
          <button type="button" className="comp-mini" onClick={onRetry}>
            Повторить
          </button>
        </div>
      )}

      {!loading && !loadError && (
        <>
          {offered.length > 0 && (
            <div className="stack">
              <span className="dnd-transfer-subtitle">Ждут решения</span>
              {offered.map((t) => (
                <article key={t.id} className="dnd-inbox-item is-new" style={{ borderLeftColor: color }}>
                  <div className="row dnd-inbox-meta">
                    <span className="dnd-inbox-badge is-new" style={{ background: color }}>
                      {t.kind === "replica" ? `создал ${t.sender_name}` : `от ${t.sender_name}`}
                    </span>
                  </div>
                  <p className="dnd-inbox-text">
                    {t.item_name} ×{t.qty}
                  </p>
                  <div className="row dnd-inbox-actions">
                    <button
                      type="button"
                      className="primary comp-mini"
                      disabled={busyId === t.id}
                      onClick={() => onAction(t.id, "accept")}
                    >
                      Принять
                    </button>
                    <button
                      type="button"
                      className="comp-mini"
                      disabled={busyId === t.id}
                      onClick={() => onAction(t.id, "decline")}
                    >
                      Отклонить
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {acceptedIn.length > 0 && (
            <p className="muted">
              У вас: {acceptedIn.map((t) => `${t.item_name} ×${t.qty} от ${t.sender_name}`).join(" · ")} — вернуть или
              сделать своим можно в «Снаряжении».
            </p>
          )}

          {outgoing.length > 0 && (
            <div className="stack">
              <span className="dnd-transfer-subtitle">Мои передачи</span>
              {outgoing.map((t) => (
                <p key={t.id} className="muted" style={{ margin: 0 }}>
                  → {t.recipient_name}: {t.item_name} ×{t.qty} —{" "}
                  {t.state === "offered" ? "ждёт решения" : "принято"}
                </p>
              ))}
            </div>
          )}

          {campaignId == null ? (
            <p className="muted">Персонаж вне кампании — передавать некому.</p>
          ) : partyError ? (
            <p className="muted">Партия не загрузилась: {partyError}</p>
          ) : (
            <div className="stack dnd-transfer-form">
              <span className="dnd-transfer-subtitle">Передать</span>
              <label className="dnd-transfer-row">
                <span className="muted">Кому</span>
                <select
                  value={recipientId ?? ""}
                  onChange={(e) => setRecipientId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">—</option>
                  {(party ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.character_name}
                      {m.player_name && ` · ${m.player_name}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="dnd-transfer-row">
                <select
                  value={itemKey}
                  onChange={(e) => {
                    setItemKey(e.target.value);
                    setQtyText("1");
                  }}
                  aria-label="Вещь"
                >
                  <option value="">Вещь…</option>
                  {freeItems.map((f) => (
                    <option key={`${f.si}:${f.ii}`} value={`${f.si}:${f.ii}`}>
                      {f.name || "Без названия"} ×{f.have}
                    </option>
                  ))}
                </select>
                {picked != null && picked.have > 1 && (
                  <input
                    value={qtyText}
                    onChange={(e) => setQtyText(e.target.value.replace(/[^\d]/g, ""))}
                    aria-label="Количество"
                    inputMode="numeric"
                    className="dnd-transfer-qty"
                  />
                )}
                <select
                  value={itemKind}
                  onChange={(e) => setItemKind(e.target.value as "item" | "replica")}
                  aria-label="Вид передачи"
                  className="dnd-transfer-kind"
                >
                  <option value="item">вещь</option>
                  <option value="replica">созданная</option>
                </select>
              </div>
              <button
                type="button"
                className="primary comp-mini dnd-transfer-send"
                disabled={recipientId == null || picked == null || !qtyOk || busyId != null}
                onClick={() => {
                  if (recipientId == null || picked == null) return;
                  onSendItem({ recipientId, section: picked.si, index: picked.ii, name: picked.name, qty: qtyNum, kind: itemKind });
                }}
              >
                Передать
              </button>
              <div className="dnd-transfer-coins">
                {COIN_FIELDS.map((c) => (
                  <input
                    key={c.key}
                    value={coinTexts[c.key]}
                    onChange={(e) =>
                      setCoinTexts((prev) => ({ ...prev, [c.key]: e.target.value.replace(/[^\d]/g, "") }))
                    }
                    aria-label={`Монеты: ${c.label}`}
                    placeholder={c.label}
                    inputMode="numeric"
                  />
                ))}
              </div>
              <button
                type="button"
                className="comp-mini dnd-transfer-send"
                disabled={recipientId == null || !moneyOk || busyId != null}
                onClick={() => {
                  if (recipientId == null) return;
                  onSendMoney({ recipientId, coins });
                }}
              >
                Передать деньги
              </button>
            </div>
          )}
        </>
      )}
      {notice && (
        <p className="dnd-card-back-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
