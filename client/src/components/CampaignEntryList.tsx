import { useEffect, useState } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { campaignEntryAffects, campaignPaths } from "../data/campaigns";
import { labelled } from "../data/notices";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { CampaignEntry } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { useIsMobile } from "../hooks/useIsMobile";
import { SheetOverlay } from "./sheet/SheetOverlay";
import { EntityTabWorkspace } from "./EntityTabWorkspace";

interface Props {
  campaignId: number;
  category: "notes" | "quotes" | "gm_notes" | "post_production";
  addLabel: string;
  emptyLabel: string;
  // Forwarded to MentionTextarea — preselects "Сеттинг" in the @-mention
  // "Создать новую сущность" flow. Pass campaign.setting_id when known.
  defaultSettingId?: number;
  // Master–Detail: список записей слева, выбранная — справа в чтении.
  // Не задано — плоский список, как раньше (остальные места).
  layout?: "list" | "master-detail";
  /** «Старые заметки» на «Обзоре» (спека campaign-paper, Q32): правятся, новых нет. */
  canAdd?: boolean;
}

const EMPTY: CampaignEntry[] = [];

export function CampaignEntryList({ campaignId, category, addLabel, emptyLabel, defaultSettingId, layout = "list", canAdd = true }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const run = useAction();
  const entries = useResource<CampaignEntry[]>(campaignPaths.entries(campaignId, category)).data ?? EMPTY;
  const [selId, setSelId] = useState<number | null>(null);

  // Выбор пережил удаление/перезагрузку: нет выбранной — берём первую.
  useEffect(() => {
    if (layout !== "master-detail") return;
    if (entries.length > 0 && !entries.some((e) => e.id === selId)) {
      setSelId(entries[0].id);
    }
    if (entries.length === 0) setSelId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, layout]);

  async function addEntry() {
    // Без «Повторить»: ответ мог потеряться после записи, и повтор создал бы вторую.
    const created = await run(
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
    // Сервер отдаёт созданную запись — выбираем её сразу в правке.
    if (layout === "master-detail" && created?.id) setSelId(created.id);
  }

  async function removeEntry(id: number) {
    if (!(await confirm({ message: "Удалить запись?", confirmLabel: "Удалить", danger: true })))
      return;
    await run(labelled("Удаление записи", () => write.del(`/campaign-entries/${id}`)), { affects: campaignEntryAffects(campaignId) });
  }

  const isPostProduction = category === "post_production";

  if (layout === "master-detail") {
    const selected = entries.find((e) => e.id === selId);
    return (
      <EntityTabWorkspace
        sections={[
          {
            id: "all",
            label: "Все записи",
            count: entries.length,
            items: entries.map((e) => ({ id: String(e.id), label: e.title || "Без названия" })),
          },
        ]}
        selection={{ section: "all", item: selId != null ? String(selId) : undefined }}
        onSelect={(next) => next.item != null && setSelId(Number(next.item))}
        workspaceKey={campaignId}
        navFooter={
          <button onClick={addEntry} style={{ alignSelf: "flex-start" }}>
            {addLabel}
          </button>
        }
      >
        {confirmDialog}
        {selected ? (
          <EntryCard
            key={selected.id}
            entry={selected}
            campaignId={campaignId}
            defaultSettingId={defaultSettingId}
            forceOpen
            onRemove={removeEntry}
          />
        ) : (
          <div className="card" style={{ borderStyle: "dashed" }}>
            <p style={{ maxWidth: "62ch" }}>{emptyLabel}</p>
            <button className="primary" onClick={addEntry}>
              {addLabel}
            </button>
          </div>
        )}
      </EntityTabWorkspace>
    );
  }

  return (
    <div className="stack">
      {confirmDialog}
      {entries.map((e) => (
        <EntryCard
          key={e.id}
          entry={e}
          campaignId={campaignId}
          defaultSettingId={defaultSettingId}
          onRemove={removeEntry}
        />
      ))}
      {!canAdd ? null : entries.length === 0 ? (
        <div className="card" style={{ borderStyle: "dashed" }}>
          <p style={{ maxWidth: "62ch" }}>
            {isPostProduction
              ? "Итоги появляются после игры — эпилоги, несбывшиеся линии, идеи для сиквела."
              : emptyLabel}
          </p>
          <button className="primary" onClick={addEntry}>
            {addLabel}
          </button>
        </div>
      ) : (
        <button onClick={addEntry} style={{ alignSelf: "flex-start" }}>
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
  forceOpen = false,
}: {
  entry: CampaignEntry;
  campaignId: number;
  defaultSettingId?: number;
  onRemove: (id: number) => void;
  /** Внутри Master–Detail карточка всегда раскрыта, сворачивать нечего. */
  forceOpen?: boolean;
}) {
  const [editMode, setEditMode] = useState(() => !entry.content);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const open = editMode || expanded || forceOpen;
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

  return (
    <details className="card res-group" open={open} onToggle={(e) => { if (!editMode && !forceOpen) setExpanded((e.currentTarget as HTMLDetailsElement).open); }}>
      <summary className="res-group__band" onClick={(e) => { if (editMode || forceOpen) e.preventDefault(); }}>
        {editMode ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Заголовок"
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, minWidth: 0 }}
          />
        ) : (
          <span className="res-group__title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.title}</span>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(entry.id);
          }}
          style={{ flexShrink: 0 }}
          aria-label="Удалить"
        >
          ✕
        </button>
      </summary>
      <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
        {open &&
          (editMode ? (
            <>
              <div className="reading-text">
                <MentionTextarea value={content} onChange={setContent} rows={4} defaultSettingId={defaultSettingId} />
              </div>
              <div className="row">
                <button className="primary" onClick={save}>
                  Сохранить
                </button>
                <button onClick={() => setEditMode(false)}>Отмена</button>
              </div>
            </>
          ) : (
            <>
              <div className="reading-text" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={entry.content} />
              </div>
              <div className="row">
                <button onClick={() => setEditMode(true)}>Редактировать</button>
                {!isMobile && (
                  <button type="button" title="Открыть листом" aria-label="Открыть листом" onClick={() => setSheetOpen(true)}>⤢</button>
                )}
              </div>
            </>
          ))}
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
      </div>
    </details>
  );
}
