import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { Modal } from "../components/Modal";
import { PageFrame } from "../components/PageFrame";
import { PORTABLE_MAX_HTML_BYTES } from "@shared/portable/parse";

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
  sheet: SheetSummary | null;
}

// Подпись кнопки: для D&D — вид · класс [подкласс] · уровень, для остальных
// систем и без чарника — кампания. Имя рядом, как везде.
function characterSubtitle(c: MyCharacter): string {
  const s = c.sheet;
  if (s && s.format === "dnd_character" && (s.race || s.class || s.level)) {
    const cls = [s.class, s.subclass ? `[${s.subclass}]` : ""].filter(Boolean).join(" ");
    return [s.race, [cls, s.level > 0 ? `${s.level} ур.` : ""].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  }
  return c.campaign_name ?? "без кампании";
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

// Чарники игрока: все его персонажи на этом сервере + создание нового.
// Создание идёт от кампании (первый шаг), потом система (по умолчанию —
// кампании), потом имя: меньше неинтуитивных кликов, чем «создай в пустоте,
// а Мастер потом привяжет». После создания — сразу в визард (?newSheet=1).
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
      navigate(`/characters/${created.id}/sheet`);
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
      navigate(`/characters/${result.id}/sheet`);
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

  // Система кампании — умолчание: менять нужно редко, а выбирать каждый раз
  // заставляло думать ни о чём.
  function pickCampaign(id: string) {
    setCampaignId(id);
    if (!id) {
      setSystemId("");
      return;
    }
    const camp = campaigns?.find((c) => c.id === Number(id));
    setSystemId(camp?.system_id ? String(camp.system_id) : "");
  }

  async function create(goSheet: boolean) {
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
      // Выбор лучше навязывания: кому профиль (досье, заметки), кому сразу
      // чарник. Визард откроется и там, и там (?newSheet=1).
      navigate(goSheet ? `/characters/${created.id}/sheet?newSheet=1` : `/characters/${created.id}?tab=statblock&newSheet=1`);
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
              + Новый чарник
            </button>
            <button type="button" disabled={importing} onClick={() => importFile.current?.click()}>
              {importing ? "Импортируем…" : "Импортировать персонажа"}
            </button>
            <input
              ref={importFile}
              hidden
              type="file"
              accept=".html,text/html"
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
      {characters !== null && characters.length === 0 && !creating && (
        <p className="muted">Чарников пока нет — заведите первого.</p>
      )}
      {characters !== null && characters.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {characters.map((c) => (
            <Link key={c.id} to={`/characters/${c.id}`} className="card row" style={{ textDecoration: "none", gap: 12 }}>
              <strong>{c.character_name}</strong>
              <span className="muted">{characterSubtitle(c)}</span>
            </Link>
          ))}
        </div>
      )}
      {creating && (
        <div className="card stack">
          <strong>Новый чарник</strong>
          <label>
            Кампания
            <select value={campaignId} onChange={(e) => pickCampaign(e.target.value)}>
              <option value="">Без кампании</option>
              {(campaigns ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {/* Пустой список читается как поломка: игрок видит одну строку «Без
              кампании» и не понимает, почему его стола там нет. Причина бывает
              разная — его убрали из состава, кампанию увели в архив, — и снаружи
              они неразличимы, поэтому говорим о следствии и к кому идти. */}
          {campaigns !== null && campaigns.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              Вероятно, у вас нет доступа к кампании — уточните у своего мастера.
            </p>
          )}
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
          <label>
            Имя персонажа
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как зовут?"
              onKeyDown={(e) => {
                if (e.key === "Enter") void create(true);
              }}
            />
          </label>
          {createError && <p className="error">{createError}</p>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="primary" disabled={saving} onClick={() => void create(false)}>
              {saving ? "Создаю…" : "В профиль"}
            </button>
            <button type="button" disabled={saving} onClick={() => void create(true)}>
              Сразу в чарник
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
