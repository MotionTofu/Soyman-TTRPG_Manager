import { useEffect, useState } from "react";
import { api } from "../api/client";
import { refreshMentionIndex } from "../mentions";
import { NavIcon } from "../components/NavIcons";
import type { ArchiveItem, ArchivedFile } from "../types";

const RESTORE_ENDPOINTS: Record<string, string> = {
  campaign: "/campaigns",
  system: "/systems",
  setting: "/settings",
  player: "/players",
  character: "/characters",
  session: "/sessions",
  resource: "/resources",
  mastering: "/mastering",
  location: "/setting-locations",
  being: "/setting-beings",
  artifact: "/artifacts",
  community: "/setting-communities",
  canvas_board: "/canvas/free-boards",
};

// Тип в строке архива подписан по-русски. До этого печатался идентификатор
// (`setting`, `mastering`), и добавление доски дало бы в этом столбце ещё одну
// английскую строку — `canvas_board`. Запасной вариант — сам идентификатор:
// новый тип лучше показать сырым, чем не показать вовсе.
const TYPE_LABELS: Record<string, string> = {
  campaign: "кампания",
  system: "система",
  setting: "сеттинг",
  player: "игрок",
  character: "персонаж",
  session: "сессия",
  resource: "ресурс",
  mastering: "мастерение",
  location: "локация",
  being: "существо",
  artifact: "артефакт",
  community: "сообщество",
  canvas_board: "доска",
};

const TABS = ["Сущности", "Файлы"] as const;

// Что необратимо оборвётся вместе с сущностью (server/src/routes/archive.ts).
// Кампании перечисляются поимённо: сводное «5 кампаний» не даёт понять, что
// среди них та, которую ведут в эту субботу.
interface PurgeImpact {
  detachedCampaigns: string[];
  compendiumLinks: number;
  baseMonsters: number;
  resources: number;
  characters: number;
  masteringNotes: number;
  modules: number;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} ${many}`;
  if (mod10 === 1) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

function impactLines(impact: PurgeImpact | null): string[] {
  if (!impact) return [];
  const lines: string[] = [];
  if (impact.detachedCampaigns.length > 0) {
    lines.push(
      `Останутся без системы: ${impact.detachedCampaigns.join(", ")}. Систему им придётся выбрать заново.`
    );
  }
  const severed: string[] = [];
  if (impact.compendiumLinks > 0)
    severed.push(plural(impact.compendiumLinks, "связь", "связи", "связей") + " со справочником и бестиарием");
  if (impact.baseMonsters > 0)
    severed.push(plural(impact.baseMonsters, "досье", "досье", "досье") + " существ потеряют базовый статблок");
  if (impact.characters > 0)
    severed.push(plural(impact.characters, "персонаж", "персонажа", "персонажей") + " останутся без системы");
  if (impact.resources > 0)
    severed.push(plural(impact.resources, "ресурс", "ресурса", "ресурсов") + " потеряют привязку");
  if (impact.masteringNotes > 0)
    severed.push(plural(impact.masteringNotes, "заметка", "заметки", "заметок") + " мастерения потеряют привязку");
  if (impact.modules > 0)
    severed.push(plural(impact.modules, "модуль", "модуля", "модулей") + " будет удалён");
  if (severed.length > 0) lines.push(`Будет разорвано: ${severed.join("; ")}.`);
  return lines;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${(bytes / 1024).toFixed(0)} КБ`;
}

export function ArchivePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Сущности");
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [files, setFiles] = useState<ArchivedFile[]>([]);

  function refresh() {
    api.get<ArchiveItem[]>("/archive").then(setItems);
    api.get<ArchivedFile[]>("/archived-files").then(setFiles);
  }
  useEffect(refresh, []);

  async function restore(item: ArchiveItem) {
    const base = RESTORE_ENDPOINTS[item.type];
    if (!base) return;
    await api.put(`${base}/${item.id}/restore`);
    refresh();
  }

  async function purge(item: ArchiveItem) {
    let impact: PurgeImpact | null = null;
    try {
      impact = await api.get<PurgeImpact>(`/archive/${item.type}/${item.id}/impact`);
    } catch {
      // Сводка — не условие удаления: если её не удалось получить, спрашиваем
      // общим текстом, а не отказываем в действии.
    }
    const warning = [
      `Удалить «${item.title}» НАВСЕГДА? Это необратимо — запись и все её вложенные данные (разделы, записи, вложения) будут стёрты без возможности восстановления.`,
      ...impactLines(impact),
    ].join("\n\n");
    if (!confirm(warning)) return;
    try {
      await api.del(`/archive/${item.type}/${item.id}`);
    } catch (e) {
      // Иначе ошибка удаления уходила в консоль необработанным промисом, а
      // Мастер видел молча не исчезнувшую строку.
      alert(`Не удалось удалить: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    // Каскад унёс потомков на любую глубину, и ссылки на них в текстах должны
    // стать зачёркнутыми сразу, а не после перезапуска: «жива ли ссылка» —
    // это вопрос к карте глобальных ключей (mentions.ts), и она устарела.
    void refreshMentionIndex();
    refresh();
  }

  async function purgeFile(file: ArchivedFile) {
    if (!confirm(`Удалить файл «${file.original_name}» из архива навсегда?`)) return;
    try {
      await api.del(`/archived-files/${file.id}`);
    } catch (e) {
      alert(`Не удалось удалить: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    refresh();
  }

  async function openArchiveFolder() {
    await api.get("/archived-files/open-folder");
  }

  return (
    <div className="stack">
      <h1 className="muted" style={{ fontSize: "var(--fs-h2)" }}>
        Архив
      </h1>
      <p className="muted">
        Архивированные сущности хранятся здесь и не отображаются в основных разделах. Их
        можно восстановить в любой момент.
      </p>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Сущности" && (
        <div className="stack">
          {items.map((item) => (
            <div key={`${item.type}-${item.id}`} className="archive-row">
              <span>{TYPE_LABELS[item.type] ?? item.type}</span>
              <span>
                {item.title}
                {item.subtitle && ` · ${item.subtitle}`}
              </span>
              <span>{item.archived_at}</span>
              <div className="row" style={{ gap: 8 }}>
                <button onClick={() => restore(item)}>Восстановить</button>
                <button className="danger" onClick={() => purge(item)}>
                  Удалить навсегда
                </button>
              </div>
            </div>
          ))}
          {items.length === 0 && <p className="muted">Архив пуст.</p>}
        </div>
      )}

      {tab === "Файлы" && (
        <div className="stack">
          <div className="row">
            <button onClick={openArchiveFolder}>
              <NavIcon name="folder" /> Открыть папку архива
            </button>
          </div>
          <p className="muted">
            Отдельные файлы, удалённые из последнего места использования с выбором «отправить в
            архив» вместо «удалить навсегда».
          </p>
          {files.map((file) => (
            <div key={file.id} className="archive-row">
              <span>{file.original_owner_type}</span>
              <span>{file.original_name}</span>
              <span className="muted">{formatSize(file.size)}</span>
              <span>{file.archived_at}</span>
              <div className="row" style={{ gap: 8 }}>
                <button className="danger" onClick={() => purgeFile(file)}>
                  Удалить навсегда
                </button>
              </div>
            </div>
          ))}
          {files.length === 0 && <p className="muted">Архивированных файлов пока нет.</p>}
        </div>
      )}
    </div>
  );
}
