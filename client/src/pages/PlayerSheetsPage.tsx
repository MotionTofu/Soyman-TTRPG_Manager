import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { PageFrame } from "../components/PageFrame";

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
          <button type="button" className="primary" onClick={startCreate}>
            + Новый чарник
          </button>
        )
      }
    >
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
