import { write } from "../../data/hooks";
import { afterWriteAnywhere, readResource } from "../../data/imperative";
import type { WorldExplorationEntry } from "../../types";

// Входящие персонажа — то, что лежит на обороте первой карты (этап 4).
// Три источника в одном списке: личные послания персонажу, послания игроку
// и объявления кампании. Порядок задаёт сервер
// (read_at IS NOT NULL, created_at DESC) — клиент не пересортировывает.

// Строка gm_reminders глазами игрока. Мастерский GmReminder из types.ts
// уже: у него нет target_type = 'character' и read_at, а оборот читает
// только игроцкий роут — отдельный тип честнее, чем расширение общего.
export interface CharacterInboxMessage {
  id: number;
  target_type: "character" | "player" | "campaign";
  target_id: number;
  message: string;
  created_at: string;
  read_at: string | null;
}

// Подпись источника — визуальное различие без вкладок (решение этапа 4).
// Короткие: места на обороте мало, а «персонажу №7» никто читать не будет.
export function inboxSourceLabel(targetType: CharacterInboxMessage["target_type"]): string {
  if (targetType === "campaign") return "Объявление";
  if (targetType === "player") return "Игроку";
  return "Тебе одному";
}

// Игроцкий роут требует токен владельца (player или gm с привязанным
// профилем игрока): чужому сервер отвечает 404, и оборот тогда просто не
// показывается — это не ошибка, а чужой лист.
//
// Через слой данных, но мимо свежести кэша: оборот опрашивает входящие по
// таймеру, и опрос, отвеченный из кэша, ничего бы не опрашивал.
export function fetchCharacterInbox(characterId: number): Promise<CharacterInboxMessage[]> {
  return readResource<CharacterInboxMessage[]>(`/player/characters/${characterId}/inbox`, { fresh: true });
}

// Прочтение ставит адресат, не Мастер (player.ts). Идемпотентно: сервер
// пишет read_at только если там NULL, повторный тап безопасен.
export async function markInboxMessageRead(messageId: number): Promise<CharacterInboxMessage> {
  const updated = await write.post<CharacterInboxMessage>(`/player/reminders/${messageId}/read`);
  afterWriteAnywhere([{ path: "/player/characters" }]);
  return updated;
}

// Имя заметки = первые слова послания (спецификация карты): игрок приведёт
// в порядок потом. Режем по словам, не по символам, чтобы не рвать слово.
export function noteNameFromMessage(message: string): string {
  const words = message.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let name = "";
  for (const w of words) {
    const next = name ? `${name} ${w}` : w;
    if (next.length > 80) break;
    name = next;
  }
  return name || message.trim().slice(0, 80);
}

// Послание уходит статьёй в личный дневник персонажа — соседям по партии
// хода нет, мастер видит на чтение (kind = "" — «без метки», контракт POST
// world-entries).
export async function saveInboxMessageAsNote(args: {
  campaignId: number;
  characterId: number;
  message: string;
}): Promise<WorldExplorationEntry> {
  const entry = await write.post<WorldExplorationEntry>(`/player/campaigns/${args.campaignId}/world-entries`, {
    character_id: args.characterId,
    kind: "",
    name: noteNameFromMessage(args.message),
    description: args.message,
  });
  afterWriteAnywhere([{ path: `/player/campaigns/${args.campaignId}/world-entries` }]);
  return entry;
}
