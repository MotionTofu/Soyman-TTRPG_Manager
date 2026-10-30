import { useMemo, useState } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { campaignEntryAffects, campaignPaths } from "../data/campaigns";
import { labelled } from "../data/notices";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { parseMentions, stripMentions, syncMentionLinks } from "../mentions";
import type { CampaignEntry } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { useIsMobile } from "../hooks/useIsMobile";
import { SheetOverlay } from "./sheet/SheetOverlay";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { DSeg } from "./DSeg";
import { NavIcon } from "./NavIcons";
import { parseDateKey } from "../utils/date";
import "./campaign-entries.css";

interface Props {
  campaignId: number;
  category: "notes" | "quotes" | "gm_notes" | "post_production";
  addLabel: string;
  emptyLabel: string;
  // Forwarded to MentionTextarea — preselects "Сеттинг" in the @-mention
  // "Создать новую сущность" flow. Pass campaign.setting_id when known.
  defaultSettingId?: number;
  /** «Старые заметки» на «Обзоре» (спека campaign-paper, Q32): правятся, новых нет. */
  canAdd?: boolean;
  /** Голова вкладки (макет Camp-Player-Notes): заголовок, подпись и кислотная кнопка. */
  title?: string;
  sub?: string;
}

const EMPTY: CampaignEntry[] = [];
const dayMonth = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" });

/**
 * Записи кампании карточками в две колонки (макет Camp-Player-Notes):
 * сегмент «Все записи | С упоминаниями», поиск, новые сверху.
 */
export function CampaignEntryList({ campaignId, category, addLabel, emptyLabel, defaultSettingId, canAdd = true, title, sub }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const run = useAction();
  const entries = useResource<CampaignEntry[]>(campaignPaths.entries(campaignId, category)).data ?? EMPTY;
  const [filter, setFilter] = useState<"all" | "mentions">("all");
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => [...entries].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id), [entries]);
  const withMentions = useMemo(() => sorted.filter((e) => parseMentions(e.content).length > 0), [sorted]);
  const q = query.trim().toLowerCase();
  const shown = (filter === "all" ? sorted : withMentions).filter(
    (e) => !q || `${e.title} ${stripMentions(e.content)}`.toLowerCase().includes(q)
  );

  async function addEntry() {
    // Без «Повторить»: ответ мог потеряться после записи, и повтор создал бы вторую.
    await run(
      labelled("Новая запись", () =>
        write.post<CampaignEntry>("/campaign-entries", {
          campaign_id: campaignId,
          category,
          title: `Запись ${entries.length + 1}`,
          content: "",
        })
      ),
      { affects: campaignEntryAffects(campaignId), retry: false }
    );
  }

  async function removeEntry(id: number) {
    if (!(await confirm({ message: "Удалить запись?", confirmLabel: "Удалить", danger: true })))
      return;
    await run(labelled("Удаление записи", () => write.del(`/campaign-entries/${id}`)), { affects: campaignEntryAffects(campaignId) });
  }

  const emptyText = category === "post_production" ? "Итоги появляются после игры — эпилоги, несбывшиеся линии, идеи для сиквела." : emptyLabel;

  return (
    <div className="entry-cards">
      {confirmDialog}
      {title && (
        <div className="d-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="d-head__sub">{sub}</div>}
          </div>
          {canAdd && (
            <div className="d-head__acts">
              <button type="button" className="d-btn d-btn--primary" onClick={addEntry}>
                {addLabel}
              </button>
            </div>
          )}
        </div>
      )}
      {entries.length > 0 && (
        <div className="entry-cards__bar">
          <DSeg
            label="Отбор записей"
            items={[
              { id: "all", label: "Все записи", count: entries.length },
              { id: "mentions", label: "С упоминаниями", count: withMentions.length },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <label className="d-field entry-cards__search">
            <NavIcon name="search" />
            <input placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск по записям" />
          </label>
        </div>
      )}
      {entries.length === 0 ? (
        canAdd && (
          <div className="entry-cards__empty">
            <p className="muted">{emptyText}</p>
            {!title && (
              <button type="button" className="d-btn d-btn--primary" onClick={addEntry}>
                {addLabel}
              </button>
            )}
          </div>
        )
      ) : shown.length === 0 ? (
        <p className="muted">По этому отбору записей нет — снимите фильтр.</p>
      ) : (
        <div className="entry-cards__grid">
          {shown.map((e) => (
            <EntryCard key={e.id} entry={e} campaignId={campaignId} defaultSettingId={defaultSettingId} onRemove={removeEntry} />
          ))}
        </div>
      )}
      {!title && canAdd && entries.length > 0 && (
        <button type="button" className="d-btn d-btn--sm entry-cards__add" onClick={addEntry}>
          {addLabel}
        </button>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  campaignId,
  defaultSettingId,
  onRemove,
}: {
  entry: CampaignEntry;
  campaignId: number;
  defaultSettingId?: number;
  onRemove: (id: number) => void;
}) {
  const [editMode, setEditMode] = useState(() => !entry.content);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  // Текст записи листом (Q11); заголовок правится в карточке, как раньше.
  const [sheetOpen, setSheetOpen] = useState(false);
  const isMobile = useIsMobile();
  const run = useAction();

  async function saveContent(next: string) {
    const saved = await run(labelled("Запись кампании", () => write.put(`/campaign-entries/${entry.id}`, { content: next }).then(() => true)), {
      affects: campaignEntryAffects(campaignId),
    });
    if (saved === undefined) throw new Error("Запись не сохранилась");
    void syncMentionLinks("campaign", campaignId, entry.content, next);
    setContent(next);
  }

  async function save() {
    // Форма закрывается только после записи: при отказе набранное остаётся.
    const saved = await run(labelled("Запись кампании", () => write.put(`/campaign-entries/${entry.id}`, { title, content }).then(() => true)), {
      affects: campaignEntryAffects(campaignId),
    });
    if (saved === undefined) return;
    void syncMentionLinks("campaign", campaignId, entry.content, content);
    setEditMode(false);
  }

  const menu: ContextMenuItem[] = [
    { label: "Редактировать", onClick: () => setEditMode(true) },
    ...(!isMobile ? [{ label: "Открыть листом", onClick: () => setSheetOpen(true) }] : []),
    { label: "Удалить", danger: true, onClick: () => onRemove(entry.id) },
  ];

  return (
    <article className={`entry-card${editMode ? " is-editing" : ""}`}>
      <header>
        <span className="d-mono">{dayMonth.format(parseDateKey(entry.created_at.slice(0, 10))).replace(".", "")}</span>
        <button
          type="button"
          className="d-dots"
          aria-label="Действия с записью"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt(menuAt ? null : { x: r.left, y: r.bottom });
          }}
        >
          ⋯
        </button>
      </header>
      {editMode ? (
        <>
          <input className="d-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок" aria-label="Заголовок" />
          <div className="reading-text">
            <MentionTextarea value={content} onChange={setContent} rows={4} defaultSettingId={defaultSettingId} />
          </div>
          <div className="entry-card__acts">
            <button type="button" className="d-btn d-btn--sm d-btn--primary" onClick={save}>
              Сохранить
            </button>
            <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={() => setEditMode(false)}>
              Отмена
            </button>
          </div>
        </>
      ) : (
        <>
          <h3>{entry.title}</h3>
          {/* Длинный текст свёрнут в шесть строк; щелчок мимо ссылок раскрывает. */}
          <div
            className={`entry-card__text${expanded ? " is-open" : ""}`}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("a")) setExpanded((v) => !v);
            }}
          >
            <MentionText text={entry.content} />
          </div>
        </>
      )}
      {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} items={menu} onClose={() => setMenuAt(null)} />}
      {sheetOpen && (
        <SheetOverlay
          docKey={`campaign-entry-${entry.id}`}
          caption={entry.title || "Запись кампании"}
          value={entry.content}
          initialMode={entry.content.trim() ? "reading" : "hybrid"}
          defaultSettingId={defaultSettingId}
          onSave={saveContent}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </article>
  );
}
