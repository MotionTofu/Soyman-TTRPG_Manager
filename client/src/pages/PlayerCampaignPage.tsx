import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "../components/mentions/MentionText";
import { PlayerContentReader, type ReaderEntry } from "../components/PlayerContentReader";
import type {
  PartyMember,
  PlayerSection,
  SettingPlayerContent,
  VisibleCampaignContent,
  WorldExplorationEntry,
  WorldExplorationKind,
} from "../types";

function formatDate(y: number, m: number, d: number): string {
  return `${d}.${m}.${y}`;
}

const KIND_TABS: { kind: WorldExplorationKind; label: string; extraLabel: string | null }[] = [
  { kind: "being", label: "Существа", extraLabel: "Место обитания" },
  { kind: "location", label: "Локации", extraLabel: "Обитатели" },
  { kind: "item", label: "Предметы", extraLabel: null },
  { kind: "event", label: "События", extraLabel: null },
];

const TABS = ["От мастера", "Исследование мира", "Группа"] as const;
type Tab = (typeof TABS)[number];

// Player-role campaign view: everything the GM has explicitly revealed
// (sessions, secrets, lore articles, "Для игроков" sections) plus the
// player-authored "Исследование мира" journal and the rest of the party —
// all through /api/player/*, which filters server-side. This is what
// CampaignDetailPage would show a GM; players never hit the GM-only
// /api/campaigns/:id route at all (see services/playerAccess.ts).
export function PlayerCampaignPage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const [tab, setTab] = useState<Tab>("От мастера");
  const [content, setContent] = useState<VisibleCampaignContent | null>(null);
  const [sections, setSections] = useState<PlayerSection[]>([]);
  const [setting, setSetting] = useState<SettingPlayerContent | null>(null);
  const [party, setParty] = useState<PartyMember[]>([]);
  const [entries, setEntries] = useState<WorldExplorationEntry[]>([]);
  const [kind, setKind] = useState<WorldExplorationKind>("being");
  const [newName, setNewName] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [readerIndex, setReaderIndex] = useState<number | null>(null);

  useEffect(() => {
    api.get<VisibleCampaignContent>(`/player/campaigns/${campaignId}/visible`).then(setContent);
    api.get<PlayerSection[]>(`/player/campaigns/${campaignId}/player-sections`).then(setSections);
    api.get<SettingPlayerContent>(`/player/campaigns/${campaignId}/setting-player-content`).then(setSetting);
    api.get<PartyMember[]>(`/player/campaigns/${campaignId}/party`).then(setParty);
    refreshEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  function refreshEntries() {
    api.get<WorldExplorationEntry[]>(`/player/campaigns/${campaignId}/world-entries`).then(setEntries);
  }

  async function addEntry() {
    await api.post(`/player/campaigns/${campaignId}/world-entries`, { kind, name: newName || "Без имени" });
    setNewName("");
    refreshEntries();
  }

  if (!content) return <p className="muted">Загрузка…</p>;

  const nothingVisible =
    content.sessions.length === 0 &&
    content.secrets.length === 0 &&
    content.locationArticles.length === 0 &&
    content.beingArticles.length === 0 &&
    content.chronicleEvents.length === 0 &&
    sections.length === 0 &&
    (!setting ||
      (setting.locations.length === 0 &&
        setting.beings.length === 0 &&
        setting.communities.length === 0 &&
        setting.chronicleEvents.length === 0));

  const list = entries.filter((e) => e.kind === kind);
  const activeTab = KIND_TABS.find((t) => t.kind === kind)!;

  const today = new Date().toISOString().slice(0, 10);
  const nextSession = content
    ? [...content.schedule]
        .filter((s) => s.status === "planned" && s.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))[0]
    : undefined;

  // Flat, ordered entries for the full-screen reader (see
  // components/PlayerContentReader.tsx) grouped back into accordion
  // sections for the collapsed list view — each group only shows its item
  // titles until opened, and clicking an item jumps the reader straight to
  // its position in the flat list so prev/next carries across section
  // boundaries instead of stopping at the section it was opened from.
  const groups: { key: string; label: string; entries: ReaderEntry[] }[] = [];
  if (content) {
    if (content.sessions.length > 0) {
      groups.push({
        key: "sessions",
        label: "Сессии",
        entries: content.sessions.map((s) => ({
          key: `session-${s.id}`,
          section: "Сессии",
          title: s.title ? `${s.date} — ${s.title}` : s.date,
          body: (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={s.main_events} />
            </div>
          ),
        })),
      });
    }
    if (content.chronicleEvents.length > 0) {
      groups.push({
        key: "chronicle",
        label: "Хроника мира",
        entries: content.chronicleEvents.map((e) => ({
          key: `chronicle-${e.id}`,
          section: "Хроника мира",
          title: e.title,
          body: (
            <div className="stack" style={{ gap: 10 }}>
              <span className="muted">{formatDate(e.inworld_year, e.inworld_month, e.inworld_day)}</span>
              {e.description && (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={e.description} />
                </div>
              )}
            </div>
          ),
        })),
      });
    }
    if (content.locationArticles.length > 0) {
      groups.push({
        key: "locations",
        label: "Локации",
        entries: content.locationArticles.map((a) => ({
          key: `loc-${a.id}`,
          section: "Локации",
          title: a.title ? `${a.location_name} — ${a.title}` : a.location_name ?? "Локация",
          body: (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={a.content} />
            </div>
          ),
        })),
      });
    }
    if (content.beingArticles.length > 0) {
      groups.push({
        key: "beings",
        label: "НПЦ",
        entries: content.beingArticles.map((a) => ({
          key: `being-${a.id}`,
          section: "НПЦ",
          title: a.title ? `${a.being_name} — ${a.title}` : a.being_name ?? "НПЦ",
          body: (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={a.content} />
            </div>
          ),
        })),
      });
    }
    if (content.secrets.length > 0) {
      groups.push({
        key: "secrets",
        label: "Раскрытые тайны",
        entries: content.secrets.map((s) => ({
          key: `secret-${s.id}`,
          section: "Раскрытые тайны",
          title: s.title,
          body: s.content ? (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={s.content} />
            </div>
          ) : null,
        })),
      });
    }
  }
  for (const s of sections) {
    if (s.kind === "gallery") {
      const imgs = s.images ?? [];
      if (imgs.length === 0) continue;
      groups.push({
        key: `section-${s.id}`,
        label: s.name,
        entries: imgs.map((img) => ({
          key: `section-${s.id}-img-${img.id}`,
          section: s.name,
          title: img.caption || "Изображение",
          body: <img src={img.image_url} alt={img.caption} style={{ maxWidth: "100%", borderRadius: 6 }} />,
        })),
      });
    } else {
      const arts = s.articles ?? [];
      if (arts.length === 0) continue;
      groups.push({
        key: `section-${s.id}`,
        label: s.name,
        entries: arts.map((a) => ({
          key: `section-${s.id}-art-${a.id}`,
          section: s.name,
          title: a.title || "Без названия",
          body: (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={a.content} />
            </div>
          ),
        })),
      });
    }
  }
  if (setting) {
    if (setting.locations.length > 0) {
      groups.push({
        key: "setting-locations",
        label: "Локации сеттинга",
        entries: setting.locations.map((l) => ({
          key: `setting-loc-${l.id}`,
          section: "Локации сеттинга",
          title: l.name,
          body: l.description ? (
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={l.description} />
            </div>
          ) : null,
        })),
      });
    }
    if (setting.beings.length > 0 || setting.communities.length > 0) {
      groups.push({
        key: "setting-factions",
        label: "Личности и фракции",
        entries: [
          ...setting.beings.map((b) => ({
            key: `setting-being-${b.id}`,
            section: "Личности и фракции",
            title: b.name,
            body: b.history ? (
              <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={b.history} />
              </div>
            ) : null,
          })),
          ...setting.communities.map((c) => ({
            key: `setting-community-${c.id}`,
            section: "Личности и фракции",
            title: c.name,
            body: c.description ? (
              <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={c.description} />
              </div>
            ) : null,
          })),
        ],
      });
    }
    if (setting.chronicleEvents.length > 0) {
      groups.push({
        key: "setting-history",
        label: "История",
        entries: setting.chronicleEvents.map((e) => ({
          key: `setting-event-${e.id}`,
          section: "История",
          title: e.title,
          body: (
            <div className="stack" style={{ gap: 10 }}>
              <span className="muted">{formatDate(e.inworld_year, e.inworld_month, e.inworld_day)}</span>
              {e.description && (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={e.description} />
                </div>
              )}
            </div>
          ),
        })),
      });
    }
  }
  let runningOffset = 0;
  const groupsWithOffset = groups.map((g) => {
    const offset = runningOffset;
    runningOffset += g.entries.length;
    return { ...g, offset };
  });
  const flatEntries = groupsWithOffset.flatMap((g) => g.entries);

  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{content.campaign.name}</h1>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "От мастера" && (
        <div className="stack">
          <p className="card" style={{ margin: 0 }}>
            {nextSession
              ? `Следующая сессия: ${nextSession.date}${nextSession.start_time ? ` в ${nextSession.start_time}` : ""}${nextSession.title ? ` — ${nextSession.title}` : ""}`
              : "Следующая сессия пока не назначена."}
          </p>

          {nothingVisible && <p className="muted">Мастер пока ничего не открыл игрокам в этой кампании.</p>}

          {groupsWithOffset.map((g) => (
            <div key={g.key} className="stack" style={{ gap: 4 }}>
              <button
                type="button"
                className={`player-section-header${openGroup === g.key ? " open" : ""}`}
                onClick={() => setOpenGroup(openGroup === g.key ? null : g.key)}
              >
                {g.label}
              </button>
              {openGroup === g.key && (
                <div className="player-section-items">
                  {g.entries.map((e, i) => (
                    <button
                      key={e.key}
                      type="button"
                      className="player-section-item"
                      onClick={() => setReaderIndex(g.offset + i)}
                    >
                      {e.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {readerIndex != null && (
        <PlayerContentReader
          entries={flatEntries}
          index={readerIndex}
          onNavigate={setReaderIndex}
          onClose={() => setReaderIndex(null)}
        />
      )}

      {tab === "Исследование мира" && (
        <div className="stack">
          <div className="tabs">
            {KIND_TABS.map((t) => (
              <button key={t.kind} className={kind === t.kind ? "active" : ""} onClick={() => setKind(t.kind)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="grid-cards">
            {list.map((entry) => (
              <WorldEntryCard
                key={entry.id}
                entry={entry}
                extraLabel={activeTab.extraLabel}
                onChanged={refreshEntries}
              />
            ))}
          </div>
          {list.length === 0 && <p className="muted">Пока ничего не добавлено.</p>}
          <div className="card stack">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Имя" />
            <button className="primary" onClick={addEntry} style={{ alignSelf: "flex-start" }}>
              + Добавить в «{activeTab.label}»
            </button>
          </div>
        </div>
      )}

      {tab === "Группа" && (
        <div className="stack">
          {party.length === 0 && <p className="muted">Кроме вас, в кампании пока нет других персонажей.</p>}
          <div className="grid-cards">
            {party.map((m) => (
              <div key={m.id} className="card row">
                {m.avatar_image_url ? (
                  <img
                    src={m.avatar_image_url}
                    alt=""
                    style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--bg-elevated)" }} />
                )}
                <div className="stack" style={{ gap: 2 }}>
                  <strong>{m.character_name}</strong>
                  <span className="muted">{m.player_name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Explicit view/edit split — the previous version had every field always
// editable inline (no read-only state at all), which read as broken since
// there was no visible way to just look at an entry without it acting like
// a form. Now: a title row (name, or its input while editing) with actions
// on the right, and the content below it as either rendered text or a
// textarea, matching whichever mode is active.
function WorldEntryCard({
  entry,
  extraLabel,
  onChanged,
}: {
  entry: WorldExplorationEntry;
  extraLabel: string | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const [description, setDescription] = useState(entry.description);
  const [extraField, setExtraField] = useState(entry.extra_field);

  function startEdit() {
    setName(entry.name);
    setDescription(entry.description);
    setExtraField(entry.extra_field);
    setEditing(true);
  }

  async function save() {
    await api.put(`/player/world-entries/${entry.id}`, { name, description, extra_field: extraField });
    setEditing(false);
    onChanged();
  }

  async function remove() {
    if (!confirm("Удалить запись?")) return;
    await api.del(`/player/world-entries/${entry.id}`);
    onChanged();
  }

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Имя"
            style={{ flex: 1, minWidth: 0 }}
          />
        ) : (
          <strong>{entry.name || "Без имени"}</strong>
        )}
        <div className="row" style={{ flexShrink: 0 }}>
          {editing ? (
            <>
              <button className="primary" onClick={save}>
                Сохранить
              </button>
              <button onClick={() => setEditing(false)}>Отмена</button>
            </>
          ) : (
            <>
              <button onClick={startEdit}>Редактировать</button>
              <button className="danger" onClick={remove}>
                Удалить
              </button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Описание"
        />
      ) : (
        entry.description && (
          <p className="muted" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {entry.description}
          </p>
        )
      )}
      {extraLabel &&
        (editing ? (
          <input
            value={extraField}
            onChange={(e) => setExtraField(e.target.value)}
            placeholder={extraLabel}
          />
        ) : (
          entry.extra_field && (
            <span className="muted">
              {extraLabel}: {entry.extra_field}
            </span>
          )
        ))}
      {entry.player_name && (
        <span className="muted" style={{ fontSize: 11 }}>
          Добавил(а): {entry.player_name}
        </span>
      )}
    </div>
  );
}
