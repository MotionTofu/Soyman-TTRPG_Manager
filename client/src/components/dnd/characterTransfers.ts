import { api } from "../../api/client";

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

export function fetchTransfers(characterId: number): Promise<{ incoming: CharacterTransfer[]; outgoing: CharacterTransfer[] }> {
  return api.get<{ incoming: CharacterTransfer[]; outgoing: CharacterTransfer[] }>(
    `/player/characters/${characterId}/transfers`
  );
}

export function fetchTransferParty(campaignId: number): Promise<TransferPartyMember[]> {
  return api.get<TransferPartyMember[]>(`/player/campaigns/${campaignId}/party`);
}

export function offerItemTransfer(args: {
  senderId: number;
  recipientId: number;
  section: number;
  index: number;
  name: string;
  qty: number;
  kind: "item" | "replica";
}): Promise<CharacterTransfer> {
  return api.post<CharacterTransfer>(`/player/characters/${args.senderId}/transfers`, {
    recipient_character_id: args.recipientId,
    section: args.section,
    index: args.index,
    name: args.name,
    qty: args.qty,
    kind: args.kind,
  });
}

export function offerMoneyTransfer(args: {
  senderId: number;
  recipientId: number;
  coins: { cp: number; sp: number; ep: number; gp: number; pp: number };
}): Promise<CharacterTransfer> {
  return api.post<CharacterTransfer>(`/player/characters/${args.senderId}/transfers`, {
    recipient_character_id: args.recipientId,
    kind: "money",
    coins: args.coins,
  });
}

export function transferAction(id: number, action: TransferAction): Promise<CharacterTransfer> {
  return api.post<CharacterTransfer>(`/player/transfers/${id}/${action}`);
}

// qty вещи — строка; пустая означает одну штуку. Нужно и пику количества,
// и проверке «влезает ли в имеющееся».
export function parseItemQty(raw: unknown): number {
  const n = parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
