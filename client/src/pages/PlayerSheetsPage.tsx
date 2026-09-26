import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { Modal } from "../components/Modal";
import { PageFrame } from "../components/PageFrame";
import { PORTABLE_MAX_HTML_BYTES } from "@shared/portable/parse";
import backEvil from "../assets/cards/back-evil.webp";
import "./player-library.css";

interface SheetSummary {
  format: string;
  race: string;
  class: string;
  subclass: string;
  level: number;
}

interface MyCharacter {
  id: number;
  character_name: string;
  campaign_id: number | null;
  campaign_name: string | null;
  campaign_archived: number;
  requested_campaign_id: number | null;
  requested_campaign_name: string | null;
  avatar_image_url: string | null;
  sheet: SheetSummary | null;
}

const SHEET_LABEL: Record<string, string> = { litm_character: "Лист LitM", zip_character: "Лист «Золото и прах»" };

// Подпись карточки как в OneShot (Q19): «Класс N ур.» у D&D, у остальных — лист
// системы, без листа — «Без листа».
function characterSubtitle(c: MyCharacter): string {
  const s = c.sheet;
  if (!s) return "Без листа";
  if (s.format === "dnd_character") {
    return [s.class, s.level > 0 ? `${s.level} ур.` : ""].filter(Boolean).join(" ") || "Лист D&D";
  }
  return SHEET_LABEL[s.format] ?? "Лист";
}

type Group = { key: string; title: string; note?: string; characters: MyCharacter[] };

// Библиотека по кампаниям + «Без кампании» (гриллинг «персонаж = лист», Q10/Q12):
// живые кампании по алфавиту, за ними архивные — персонаж остаётся в группе
// кампании, пока игрок сам его не выведет, — и в конце «Без кампании».
function groupCharacters(list: MyCharacter[]): Group[] {
  const byCampaign = new Map<number, Group & { archived: boolean }>();
  const free: MyCharacter[] = [];
  for (const c of list) {
    if (c.campaign_id == null) {
      free.push(c);
      continue;
    }
    let g = byCampaign.get(c.campaign_id);
    if (!g) {
      g = {
        key: `c${c.campaign_id}`,
        title: c.campaign_name ?? "Кампания",
        note: c.campaign_archived ? "кампания в архиве" : undefined,
        archived: !!c.campaign_archived,
        characters: [],
      };
      byCampaign.set(c.campaign_id, g);
    }
    g.characters.push(c);
  }
  const campaigns = [...byCampaign.values()].sort(
    (a, b) => Number(a.archived) - Number(b.archived) || a.title.localeCompare(b.title, "ru")
  );
  return [...campaigns, { key: "free", title: "Без кампании", characters: free }];
}

interface MyCampaign {
  id: number;
  name: string;
  system_id: number | null;
  system_name: string | null;
}

interface NameOnly {
  id: number;
  name: string;
}

// Библиотека персонажей игрока: группы по кампаниям и «Без кампании»
// (гриллинг «персонаж = лист» 2026-09-27, Q10–Q19). Игрок заводит персонажа
// только без кампании, в кампанию — заявкой, которую принимает Мастер.
export function PlayerSheetsPage() {
  const navigate = useNavigate();
  const me = useResource<{ characters: MyCharacter[] }>("/player/me");
  const characters = me.data?.characters ?? null;
  const listError = me.error ?? "";
  const [creating, setCreating] = useState(false);
  // Списки для формы — только когда она открыта.
  const campaigns = useResource<MyCampaign[]>(creating ? "/player/campaigns" : null).data ?? null;
  const systems = useResource<NameOnly[]>(creating ? "/player/systems" : null).data ?? null;
  const [campaignId, setCampaignId] = useState("");
  const [systemId, setSystemId] = useState("");
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState("");
  const [saving, setSaving] = useState(false);
  const afterWrite = useAfterWrite();
  // Portable HTML import (B2.1/B2.2): same file as SoyMan_1shot exports. The
  // server parses and validates; the client only ships the text. The chosen
  // file stays retained while the identity decision modal is open, then the
  // same HTML is resent with the player's action (replace/copy).
  const importFile = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  interface PortableMatch {
    id: number;
    name: string;
  }
  const [decisionFile, setDecisionFile] = useState<File | null>(null);
  const [decisionMatch, setDecisionMatch] = useState<PortableMatch | null>(null);
  const [decisionConflict, setDecisionConflict] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);

  function closeDecision() {
    setDecisionFile(null);
    setDecisionMatch(null);
    setDecisionConflict(false);
  }

  function portableDecision(e: unknown): { code?: string; match?: PortableMatch } | null {
    const payload = (e as { payload?: unknown })?.payload;
    if (payload && typeof payload === "object" && "code" in payload) {
      return payload as { code?: string; match?: PortableMatch };
    }
    return null;
  }

  async function importPortable(file: File) {
    // Content is the truth, not the browser MIME; the cap rejects giant
    // arbitrary files before reading.
    if (file.size > PORTABLE_MAX_HTML_BYTES) {
      setImportError("Файл персонажа повреждён или имеет неподдерживаемую версию.");
      return;
    }
    setImporting(true);
    setImportError("");
    try {
      const created = await write.post<{ id: number }>("/player/characters/import/portable", {
        html: await file.text(),
      });
      afterWrite([{ path: "/player/me" }, { kind: "character" }]);
      navigate(`/characters/${created.id}`);
    } catch (e) {
      const decision = portableDecision(e);
      if (decision?.code === "portable-character-exists" && decision.match) {
        setDecisionFile(file);
        setDecisionMatch(decision.match);
      } else if (decision?.code === "portable-character-identity-conflict") {
        setDecisionFile(file);
        setDecisionConflict(true);
      } else {
        setImportError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setImporting(false);
    }
  }

  async function resolvePortable(action: "replace" | "copy") {
    if (!decisionFile || (!decisionMatch && !decisionConflict)) return;
    setDecisionBusy(true);
    setImportError("");
    try {
      const result = await write.post<{ id: number }>("/player/characters/import/portable", {
        html: await decisionFile.text(),
        action,
        targetCharacterId: decisionMatch?.id,
      });
      closeDecision();
      afterWrite([{ path: "/player/me" }, { kind: "character" }]);
      navigate(`/characters/${result.id}`);
    } catch (e) {
      // A conflict surfacing at commit (or any other failure): never proceed
      // with a stale decision — close and show the server's message.
      const decision = portableDecision(e);
      if (decision?.code === "portable-character-identity-conflict") {
        setDecisionMatch(null);
        setDecisionConflict(true);
      } else {
        closeDecision();
        setImportError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setDecisionBusy(false);
    }
  }

  function startCreate() {
    setCreating(true);
    setCreateError("");
    setCampaignId("");
    setSystemId("");
    setName("");
  }

  // Система кампании заявки — умолчание, если своя ещё не выбрана.
  function pickCampaign(id: string) {
    setCampaignId(id);
    const camp = campaigns?.find((c) => c.id === Number(id));
    if (!systemId && camp?.system_id) setSystemId(String(camp.system_id));
  }

  async function create() {
    if (!name.trim()) {
      setCreateError("Назовите персонажа.");
      return;
    }
    setSaving(true);
    setCreateError("");
    try {
      const created = await write.post<{ id: number }>("/player/characters", {
        character_name: name.trim(),
        campaign_id: campaignId ? Number(campaignId) : null,
        system_id: systemId ? Number(systemId) : null,
      });
      afterWrite([{ path: "/player/me" }, { path: "/player/campaigns" }, { kind: "character" }]);
      // Персонаж = лист: страница откроется экраном «Листа ещё нет» с дорогами
      // по системе (визард, случайно, импорт).
      navigate(`/characters/${created.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    // Список и форма создания — не под `state` каркаса: ошибка списка не
    // должна прятать начатый чарник.
    <PageFrame
      title="Персонажи"
      actions={
        !creating && (
          <>
            <button type="button" className="primary" onClick={startCreate}>
              + Новый персонаж
            </button>
            <button type="button" disabled={importing} onClick={() => importFile.current?.click()}>
              {importing ? "Импортируем…" : "Импортировать персонажа"}
            </button>
            <input
              ref={importFile}
              hidden
              type="file"
              accept=".html,.json,text/html,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importPortable(file);
              }}
            />
          </>
        )
      }
    >
      {importError && <LoadErrorCard message={<>Не удалось импортировать персонажа: {importError}</>} onRetry={() => setImportError("")} />}
      {decisionFile && (
        <Modal onClose={() => { if (!decisionBusy) closeDecision(); }} ariaLabel="Импорт персонажа">
          {decisionConflict ? (
            <>
              <h3>Конфликт идентичности персонажа</h3>
              <p>В SoyMan найдено несколько персонажей с такой идентичностью. Автоматически выбрать один из них нельзя.</p>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="primary" disabled={decisionBusy} onClick={() => void resolvePortable("copy")}>
                  {decisionBusy ? "Создаём…" : "Создать копию"}
                </button>
                <button type="button" disabled={decisionBusy} onClick={closeDecision}>
                  Отмена
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>Персонаж «{decisionMatch?.name}» уже есть в SoyMan</h3>
              <p>Данные из файла заменят его текущее игровое состояние, включая здоровье, ресурсы, заметки и другие данные листа.</p>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="primary" disabled={decisionBusy} onClick={() => void resolvePortable("replace")}>
                  {decisionBusy ? "Обновляем…" : "Обновить"}
                </button>
                <button type="button" disabled={decisionBusy} onClick={() => void resolvePortable("copy")}>
                  Создать копию
                </button>
                <button type="button" disabled={decisionBusy} onClick={closeDecision}>
                  Отмена
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {listError && <LoadErrorCard message={<>Не удалось загрузить персонажей: {listError}</>} onRetry={me.reload} />}
      {characters === null && !listError && <ListSkeleton variant="rows" label="Загрузка персонажей" />}
      {characters !== null &&
        groupCharacters(characters).map((g) => (
          <section key={g.key} className="player-library-group">
            <h3 className="player-library-title">
              {g.title}
              {g.note && <span className="muted"> · {g.note}</span>}
              <span className="player-library-count">{g.characters.length}</span>
            </h3>
            {g.characters.length === 0 ? (
              <p className="muted">
                Здесь — персонажи, которых вы завели сами или импортировали из OneShot. В кампанию их подают заявкой из меню «⋯» листа.
              </p>
            ) : (
              <div className="player-library-grid">
                {g.characters.map((c) => (
                  <Link key={c.id} to={`/characters/${c.id}`} className="player-library-card">
                    <img src={c.avatar_image_url || backEvil} alt="" />
                    <span className="player-library-name">{c.character_name}</span>
                    <span className="player-library-sub">{characterSubtitle(c)}</span>
                    {c.requested_campaign_id != null && (
                      <span className="player-library-badge">Заявка в «{c.requested_campaign_name}» ждёт Мастера</span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </section>
        ))}
      {creating && (
        <div className="card stack">
          <strong>Новый персонаж</strong>
          <label>
            Имя персонажа
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как зовут?"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
            />
          </label>
          <label>
            Система
            <select value={systemId} onChange={(e) => setSystemId(e.target.value)}>
              <option value="">Без системы</option>
              {(systems ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {/* Персонаж заводится «без кампании» (Q16); кампания здесь — сразу
              заявка Мастеру, как «Подать в кампанию» из меню листа. */}
          <label>
            Подать заявку в кампанию
            <select value={campaignId} onChange={(e) => pickCampaign(e.target.value)}>
              <option value="">Не подавать</option>
              {(campaigns ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {createError && <p className="error">{createError}</p>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="primary" disabled={saving} onClick={() => void create()}>
              {saving ? "Создаю…" : "Создать"}
            </button>
            <button type="button" onClick={() => setCreating(false)} disabled={saving}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </PageFrame>
  );
}
