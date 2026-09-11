import { write } from "../../data/hooks";
import { afterWriteAnywhere, readResource } from "../../data/imperative";
import type { Affect } from "../../data/entities";
import { statblockAffects } from "../../data/statblocks";

// Передачи вещей между персонажами игроков (этап 4б). Посредник — сервер:
// игрок в чужой лист писать не может, поэтому оффер, проверки наличия и
// locked-строки в оба листа делает он. Здесь только тонкие вызовы.

// Состояния: offered → accepted (→ returned | claimed), offered →
// declined | expired. Деньги (money) мгновенные — строка сразу claimed.
export interface CharacterTransfer {
  id: number;
  sender_character_id: number;
  sender_name: string;
  recipient_character_id: number;
  recipient_name: string;
  kind: "item" | "money" | "replica";
  item_name: string;
  item_json: string;
  qty: number;
  coins_json: string;
  state: "offered" | "accepted" | "declined" | "returned" | "claimed" | "expired";
  created_at: string;
}

export interface TransferPartyMember {
  id: number;
  character_name: string;
  player_name: string;
  avatar_image_url: string | null;
}

export type TransferAction = "accept" | "decline" | "return" | "claim";

// Передача пишет в оба листа сразу: задеты чарники и передачи обоих.
function transferAffects(...characterIds: number[]): Affect[] {
  return characterIds.flatMap((id) => [...statblockAffects("character", id), { path: `/player/characters/${id}/transfers` }]);
}

// Опрос оборота по таймеру — поэтому мимо свежести кэша.
export function fetchTransfers(characterId: number): Promise<{ incoming: CharacterTransfer[]; outgoing: CharacterTransfer[] }> {
  return readResource<{ incoming: CharacterTransfer[]; outgoing: CharacterTransfer[] }>(
    `/player/characters/${characterId}/transfers`,
    { fresh: true }
  );
}

export function fetchTransferParty(campaignId: number): Promise<TransferPartyMember[]> {
  return readResource<TransferPartyMember[]>(`/player/campaigns/${campaignId}/party`);
}

export async function offerItemTransfer(args: {
  senderId: number;
  recipientId: number;
  /** Стабильный id строки — сервер ищет по нему. section/index едут рядом
   *  для старых серверов/клиентов, где id ещё нет. */
  itemId: string | null;
  section: number;
  index: number;
  name: string;
  qty: number;
  kind: "item" | "replica";
}): Promise<CharacterTransfer> {
  const transfer = await write.post<CharacterTransfer>(`/player/characters/${args.senderId}/transfers`, {
    recipient_character_id: args.recipientId,
    item_id: args.itemId,
    section: args.section,
    index: args.index,
    name: args.name,
    qty: args.qty,
    kind: args.kind,
  });
  afterWriteAnywhere(transferAffects(args.senderId, args.recipientId));
  return transfer;
}

export async function offerMoneyTransfer(args: {
  senderId: number;
  recipientId: number;
  coins: { cp: number; sp: number; ep: number; gp: number; pp: number };
}): Promise<CharacterTransfer> {
  const transfer = await write.post<CharacterTransfer>(`/player/characters/${args.senderId}/transfers`, {
    recipient_character_id: args.recipientId,
    kind: "money",
    coins: args.coins,
  });
  afterWriteAnywhere(transferAffects(args.senderId, args.recipientId));
  return transfer;
}

export async function transferAction(id: number, action: TransferAction): Promise<CharacterTransfer> {
  const transfer = await write.post<CharacterTransfer>(`/player/transfers/${id}/${action}`);
  afterWriteAnywhere(transferAffects(transfer.sender_character_id, transfer.recipient_character_id));
  return transfer;
}

// qty вещи — строка; пустая означает одну штуку. Нужно и пику количества,
// и проверке «влезает ли в имеющееся».
export function parseItemQty(raw: unknown): number {
  const n = parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
