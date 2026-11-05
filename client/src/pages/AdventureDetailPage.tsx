import {ProjectWorkbooks} from "../components/workbooks/ProjectWorkbooks";
import { settingAdventuresPath } from "../layout/useSettingCrumbs";
import { AdventureParticipants } from "../components/adventure/AdventureDossier";
import { useRef, useState } from "react";
import { RevealList } from "../components/RevealList";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import type { Affect } from "../data/entities";
import { LoadErrorCard } from "../components/Loadable";
import { EntityPage } from "../components/EntityPage";
import { ProfileHero, ProfileBlock, ProfileText } from "../components/profiles/ProfileParts";
import { AdventureDescription, AdventurePassport, AdventureOutcomes, AdventureMetadataEditor, adventureFacts } from "../components/profiles/AdventureDossier";
import { AdventureChapters } from "../components/profiles/AdventureChapters";
import { countHoles, holesLabel } from "../components/profiles/sceneProgress";
import { TagChips } from "../components/TagChips";
import { campaignPaths } from "../data/campaigns";
import { arcCluesPath } from "../data/canvas";
import type { ArcClues, CampaignAdventureTree, StoryArc } from "../types";
import "../components/profiles/scene-adventure.css";
import { MentionText } from "../components/mentions/MentionText";
import { useTabState } from "../hooks/useTabState";
import { sceneWord } from "../sceneKinds";
import { CrossLinksWizard } from "../components/CrossLinksWizard";
import type { Setting, StoryArcDetail } from "../types";
import { NavIcon } from "../components/NavIcons";
import { useConfirm, usePrompt } from "../hooks/useConfirm";
import { downloadJson } from "../downloadJson";
import { ExportProgress } from "../components/ExportProgress";
import { readOnce } from "../data/imperative";
import { useImageCrop } from "../hooks/useImageCrop";

// «Действующие лица» и «Награды» убраны с профиля: список действующих лиц
// собирался из связей сцен и информационной пользы не нёс, а награды книги без
// работы с сокровищницей выглядели свалкой строк. Данные наград и связей
// остались в базе нетронутыми — вернуть их будет чем.
// «Выводы» — список узлового дизайна (Q6): что партия может знать и куда идти.
// Досье · Главы и сцены · Тайны и вехи (гриллинг 2026-10-02, Q15, доска 36):
// выводы, вехи и тайны — то, что партия узнаёт и чего достигает, — одной
// вкладкой тремя разделами.
const TABS = ["Досье", "Главы и сцены", "Тайны и вехи"] as const;

// Правка приключения видна не только здесь: главы, сцены, вехи и тайны
// читают полотно, дерево сцен и тайны кампании на пульте. Всё это лежит под
// `/story`, `/sessions` и `/canvas`; перечитываются из них только открытые.
const STORY_AFFECTS: Affect[] = [{ path: "/story" }, { path: "/sessions" }, { path: "/canvas" }];

const CERTAINTY_LABEL: Record<string, string> = { known: "известно", reported: "сообщение", rumor: "слух", disputed: "спорно" };

const SECRET_KINDS = [
  { key: "secret", label: "Тайна" },
  { key: "thread", label: "Нить" },
];

// Profile of one adventure. Opened from a setting (originals) or from a
// campaign (?campaign=<id>), where scene edits go through the copy-on-write
// layer and milestones/secrets/scenes additionally carry that campaign's
// progress.
export function AdventureDetailPage() {
  const [confirmDialog, confirm] = useConfirm();
  const [promptDialog, promptText] = usePrompt();
  const { id } = useParams();
  const arcId = Number(id);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const campaignId = params.get("campaign") ? Number(params.get("campaign")) : null;

  const arcState = useResource<StoryArcDetail>(`/story/arcs/${arcId}${campaignId ? `?campaign_id=${campaignId}` : ""}`);
  const arc = arcState.data ?? null;
  const setting = useResource<Setting>(arc ? `/settings/${arc.setting_id}` : null).data ?? null;
  const arcCampaigns = useResource<{ id: number; name: string }[]>(`/story/arcs/${arcId}/campaigns`).data ?? [];
  const run = useAction();
  const [tab, selectTab] = useTabState(TABS, "Досье", {
    Обзор: "Досье",
    Выводы: "Тайны и вехи",
    Вехи: "Тайны и вехи",
    "Тайны и зацепки": "Тайны и вехи",
  });
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  // Обложка (доска 37): из кампании ложится в её копию приключения.
  const coverCrop = useImageCrop("thumbnail", (file) => {
    const form = new FormData();
    form.append("file", file);
    if (campaignId != null) form.append("campaign_id", String(campaignId));
    setUploadingCover(true);
    void run(() => write.post(`/story/arcs/${arcId}/thumbnail`, form, { timeoutMs: 60_000 }), {
      affects: STORY_AFFECTS,
    }).finally(() => setUploadingCover(false));
  });

  const coverInput = useRef<HTMLInputElement>(null);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const peers = useResource<StoryArc[]>(arc ? `/story/arcs?setting_id=${arc.setting_id}` : null).data ?? [];
  const tree = useResource<CampaignAdventureTree[]>(campaignId ? campaignPaths.tree(campaignId) : null).data;
  const clues = useResource<ArcClues>(campaignId && arc ? arcCluesPath(arc.id, campaignId) : null).data;

  if (arcState.error && !arc) {
    return <LoadErrorCard message={<>Не удалось загрузить приключение: {arcState.error}</>} onRetry={arcState.reload} />;
  }
  if (!arc) return <p className="muted">Загрузка…</p>;

  // Текстовые карточки держат правку открытой, пока сохранение не удалось:
  // для этого им нужна ошибка, а плашку показывает слой.
  async function save(patch: Record<string, unknown>) {
    const done = await run(() => write.put(`/story/arcs/${arcId}`, { ...patch, campaign_id: campaignId }).then(() => true), { affects: STORY_AFFECTS });
    if (!done) throw new Error("Не сохранилось");
  }

  function saveQuietly(patch: Record<string, unknown>) {
    save(patch).catch(() => {
      // Плашку уже показал слой.
    });
  }

  async function archive() {
    if (!(await confirm({ message: "Отправить приключение в архив вместе с главами и сценами?", confirmLabel: "Архивировать", danger: true })))
      return;
    const done = await run(() => write.del(`/story/arcs/${arcId}`).then(() => true), { affects: STORY_AFFECTS });
    if (done) navigate(`/settings/${arc?.setting_id}?tab=${encodeURIComponent("Приключения")}`);
  }

  async function exportArc() {
    // Выгрузка — один синхронный запрос без процента готовности; кнопка
    // дизейблится и показывает бесконечный индикатор, чтобы не выглядело зависшим.
    if (exportBusy || !arc) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const data = await readOnce(`/story/arcs/${arcId}/export`, { timeoutMs: 120000 });
      downloadJson(data, `adventure-${arc.name}.json`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  }


  const neighbours = peers.filter((a) => a.kind === "adventure" && a.is_default !== 1);
  const peerIndex = neighbours.findIndex((a) => a.id === arc.id);
  const neighbour = (offset: number) => { const a = peerIndex < 0 ? undefined : neighbours[peerIndex + offset]; return a ? { name: a.name, href: `/adventures/${a.id}${campaignId ? `?campaign=${campaignId}` : ""}` } : undefined; };
  const inTree = tree?.find((a) => a.id === arc.id);
  const allScenes = inTree ? [...inTree.scenes, ...inTree.chapters.flatMap((c) => c.scenes)] : [];
  const unmarked = !clues || clues.nodes.every((n) => n.clue_in === 0 && n.clue_out === 0);
  const holes = countHoles(allScenes, new Map((unmarked ? [] : clues.nodes).map((n) => [n.shown_id, n])));
  const canvas = `/canvas?setting=${arc.setting_id}&arc=${arc.id}${campaignId ? `&campaign=${campaignId}` : ""}`;
  return <EntityPage
      crumbs={campaignId ? [
        { label: "Кампании", to: "/campaigns" },
        { label: arcCampaigns.find((c) => c.id === campaignId)?.name ?? "Кампания", to: `/campaigns/${campaignId}` },
        { label: "Главы и сцены", to: `/campaigns/${campaignId}?tab=${encodeURIComponent("Главы и сцены")}` },
        { label: arc.name },
      ] : [
        { label: "Сеттинги", to: "/settings" },
        { label: setting?.name ?? "Сеттинг", to: `/settings/${arc.setting_id}` },
        {
          label: "Приключения",
          to: settingAdventuresPath(arc.setting_id, arc.id),
        },
        { label: arc.name },
      ]}
      entityType="adventure" title={arc.name} profile={{ id: arc.id, previous: neighbour(-1), next: neighbour(1) }}
      actions={[
        { label: exportBusy ? "Выгружаем…" : "Выгрузить в файл", onClick: () => void exportArc() },
        ...(arc.is_default !== 1 ? [{ label: "Переименовать", onClick: async () => { const name = await promptText({ title: "Переименовать приключение", message: "Название приключения", defaultValue: arc.name }); if (name?.trim()) saveQuietly({ name: name.trim() }); } }, { label: "Архивировать", danger: true, onClick: archive }] : []),
      ]}
      tabs={TABS} tab={tab} onTab={(t) => selectTab(t as (typeof TABS)[number])}
      overlays={<>{confirmDialog}{promptDialog}{coverCrop.modal}{editingMetadata && <AdventureMetadataEditor arc={arc} onSave={save} onClose={() => setEditingMetadata(false)} />}</>}
    >
      <input ref={coverInput} type="file" accept="image/*" hidden onChange={(e) => { coverCrop.onSelect(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      {tab === "Досье" && <>
        <ProfileHero type="adventure" name={arc.name} createdAt={arc.created_at} subtype={`${arc.scenes.length} ${sceneWord(arc.scenes.length)}`}
          image={arc.thumbnail_image_url} onGallery={() => { if (!uploadingCover) coverInput.current?.click(); }} coverLabel={uploadingCover ? "Загружается…" : "Обложка · щелчок — сменить"}
          labels={<>{adventureFacts(arc).map((fact) => <span className="gch" key={fact}>{fact}</span>)}{arc.source && <span className="gch">{arc.source}</span>}<TagChips profile tags={arc.tags.split(",").map((t) => t.trim()).filter(Boolean)} onChange={(tags) => saveQuietly({ tags: tags.join(", ") })} />{campaignId && inTree && <span className="gch">сыграно {allScenes.filter((s) => s.state?.status === "done").length} из {allScenes.length}</span>}{campaignId && holes > 0 && <span className="adventure-profile-warning">{holesLabel(holes)}</span>}</>}>
          <div className="adventure-profile-actions"><Link className="d-btn" to={canvas}><NavIcon name="canvas" /> Холст</Link><button className="d-btn d-btn--ghost" onClick={() => setEditingMetadata(true)}>Редактировать</button></div>
          <ProfileText title="Завязка" value={arc.hook} onSave={(v) => save({ hook: v })} defaultSettingId={arc.setting_id} focal />
        </ProfileHero>
        <div className="profile-columns"><AdventureDescription arc={arc} onSave={save} /><AdventurePassport arc={arc} onSave={save} /></div>
        <AdventureOutcomes arc={arc} onSave={save} />
        <details className="paper-fold"><summary>Справка <span className="profile-fold-note">логлайн · источник · экспорт · участники · тетради</span></summary><div className="paper-fold__body stack">
          <ProfileText title="Логлайн" value={arc.description} onSave={(v) => save({ description: v })} defaultSettingId={arc.setting_id} />
          <ProfileText title="Источник" value={arc.source} onSave={(v) => save({ source: v })} rows={1} />
          <button className="d-btn" disabled={exportBusy} onClick={() => void exportArc()}>Выгрузить в файл</button>{(exportBusy || exportError) && <ExportProgress error={exportError} />}
          <AdventureParticipants arcId={arcId} settingId={arc.setting_id} /><ProjectWorkbooks type="adventure" id={arcId} />
        </div></details>
      </>}
      {tab === "Главы и сцены" && <>{campaignId == null && <details className="paper-fold"><summary>Связать упоминания в тексте</summary><CrossLinksWizard ownerKind="adventure" ownerId={arcId} help="Ищет имена сущностей в сценах. Запись — после подтверждения." /></details>}<AdventureChapters arc={arc} campaignId={campaignId} /></>}
      {tab === "Тайны и вехи" && <><div className="profile-columns"><Secrets arc={arc} campaignId={campaignId} /><Milestones arc={arc} campaignId={campaignId} /></div><ProfileBlock title="Выводы"><RevealList arcId={arc.id} campaignId={campaignId} /></ProfileBlock></>}
    </EntityPage>;
}

function Milestones({ arc, campaignId }: { arc: StoryArcDetail; campaignId: number | null }) {
  const run = useAction();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sceneId, setSceneId] = useState("");

  async function add() {
    if (!title.trim()) return;
    const body = { title, description, scene_id: sceneId ? Number(sceneId) : null };
    // Без «Повторить»: повтор после потерянного ответа завёл бы веху дважды.
    const done = await run(() => write.post(`/story/arcs/${arc.id}/milestones`, body).then(() => true), {
      affects: STORY_AFFECTS,
      retry: false,
    });
    if (!done) return;
    setTitle("");
    setAdding(false);
    setDescription("");
    setSceneId("");
  }

  async function toggle(milestoneId: number, achieved: boolean) {
    if (!campaignId) return;
    await run(() => write.put(`/story/milestones/${milestoneId}/state`, { campaign_id: campaignId, achieved }), {
      affects: STORY_AFFECTS,
    });
  }

  async function move(milestoneId: number, delta: number) {
    const ids = arc.milestones.map((m) => m.id);
    const i = ids.indexOf(milestoneId);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await run(() => write.put("/story/milestones/reorder", { order: ids }), { affects: STORY_AFFECTS });
  }

  return (
    <ProfileBlock title="Вехи" count={arc.milestones.length} actions={!campaignId && arc.milestones.length > 0 && !adding && <button className="d-btn d-btn--sm d-btn--ghost" onClick={() => setAdding(true)}>+ Веха</button>}>
      <div className="adventure-profile-records stack">
      <span className="muted">
        Ключевые точки сюжета в порядке следования.{" "}
        {campaignId
          ? "Отметки достижения относятся только к этой кампании."
          : "В кампании у каждой вехи появится отметка «достигнута»."}
      </span>
      {arc.milestones.map((m) => (
        <div key={m.id} className="row" style={{ justifyContent: "space-between" }}>
          <span>
            {campaignId && (
              <input
                type="checkbox"
                checked={m.state?.achieved === 1}
                onChange={(e) => toggle(m.id, e.target.checked)}
              />
            )}{" "}
            <strong>{m.title}</strong>
            {m.scene_name && <span className="muted"> · сцена «{m.scene_name}»</span>}
            {m.description && (
              <div className="muted reading-text">
                <MentionText text={m.description} />
              </div>
            )}
          </span>
          <span className="row">
            <button onClick={() => move(m.id, -1)}>↑</button>
            <button onClick={() => move(m.id, 1)}>↓</button>
            {!campaignId && (
              <button
                className="danger"
                onClick={() => void run(() => write.del(`/story/milestones/${m.id}`), { affects: STORY_AFFECTS })}
              >
                ✕
              </button>
            )}
          </span>
        </div>
      ))}
      {arc.milestones.length === 0 && !adding && <div className="profile-invitation"><NavIcon name="book" /><span>Отметки, к которым партия приходит по ходу приключения.</span>{campaignId ? <Link className="d-btn d-btn--sm" to={`/adventures/${arc.id}?tab=${encodeURIComponent("Тайны и вехи")}`}>В основу сеттинга ›</Link> : <button className="d-btn d-btn--sm" onClick={() => setAdding(true)}>+ Веха</button>}</div>}
      {!campaignId && adding && (
        <div className="adventure-profile-add stack">
          <input placeholder="Название вехи" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input
            placeholder="Описание"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
            <option value="">Без привязки к сцене</option>
            <optgroup label={arc.chapters.length > 0 ? "Без главы" : "Сцены"}>
              {arc.scenes
                .filter((s) => s.arc_id === arc.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </optgroup>
            {arc.chapters.map((c) => (
              <optgroup key={c.id} label={c.name}>
                {arc.scenes
                  .filter((s) => s.arc_id === c.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button className="primary" onClick={add}>
            Добавить
          </button>
        </div>
      )}
      </div>
    </ProfileBlock>
  );
}

function Secrets({ arc, campaignId }: { arc: StoryArcDetail; campaignId: number | null }) {
  const run = useAction();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState("secret");

  async function add() {
    if (!title.trim()) return;
    const body = { title, content, kind };
    const done = await run(() => write.post(`/story/arcs/${arc.id}/secrets`, body).then(() => true), {
      affects: STORY_AFFECTS,
      retry: false,
    });
    if (!done) return;
    setTitle("");
    setAdding(false);
    setContent("");
  }

  async function toggle(secretId: number, revealed: boolean) {
    if (!campaignId) return;
    await run(() => write.put(`/story/secrets/${secretId}/state`, { campaign_id: campaignId, revealed }), {
      affects: STORY_AFFECTS,
    });
  }

  return (
    <ProfileBlock title="Тайны и зацепки" count={arc.secrets.length} actions={!campaignId && arc.secrets.length > 0 && !adding && <button className="d-btn d-btn--sm d-btn--ghost" onClick={() => setAdding(true)}>+ Тайна</button>}>
      <div className="adventure-profile-records stack">
      <span className="muted">
        Тайны, улики и сюжетные нити приключения.{" "}
        {campaignId && "Отметка «раскрыто» относится только к этой кампании."}
      </span>
      {arc.secrets.map((s) => (
        <div key={s.id} className="row" style={{ justifyContent: "space-between" }}>
          <span>
            {campaignId && (
              <input
                type="checkbox"
                checked={s.state?.revealed === 1}
                onChange={(e) => toggle(s.id, e.target.checked)}
              />
            )}{" "}
            <strong>{s.title}</strong>
            <span className="muted"> · {SECRET_KINDS.find((k) => k.key === s.kind)?.label}</span>{" "}
            {/* Достоверность (Q15): известно · слух · спорно. Свойство самой
                тайны, а не прогресса кампании — правится только в сеттинге. */}
            {campaignId ? (
              s.certainty && <span className="badge tag">{CERTAINTY_LABEL[s.certainty]}</span>
            ) : (
              <select
                className="secret-certainty"
                value={s.certainty ?? ""}
                aria-label={`Достоверность: ${s.title}`}
                onChange={(e) =>
                  void run(() => write.put(`/story/secrets/${s.id}`, { certainty: e.target.value }), {
                    affects: STORY_AFFECTS,
                  })
                }
              >
                <option value="">достоверность…</option>
                <option value="known">известно</option>
                <option value="reported">сообщение</option>
                <option value="rumor">слух</option>
                <option value="disputed">спорно</option>
              </select>
            )}
            {s.content && (
              <div className="muted reading-text">
                <MentionText text={s.content} />
              </div>
            )}
          </span>
          {!campaignId && (
            <button
              className="danger"
              onClick={() => void run(() => write.del(`/story/secrets/${s.id}`), { affects: STORY_AFFECTS })}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {arc.secrets.length === 0 && !adding && <div className="profile-invitation"><NavIcon name="book" /><span>Что партия может узнать в этом приключении.</span>{campaignId ? <Link className="d-btn d-btn--sm" to={`/adventures/${arc.id}?tab=${encodeURIComponent("Тайны и вехи")}`}>В основу сеттинга ›</Link> : <button className="d-btn d-btn--sm" onClick={() => setAdding(true)}>+ Тайна</button>}</div>}
      {!campaignId && adding && (
        <div className="adventure-profile-add stack">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {SECRET_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
          <input placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input placeholder="Содержание" value={content} onChange={(e) => setContent(e.target.value)} />
          <button className="primary" onClick={add}>
            Добавить
          </button>
        </div>
      )}
      </div>
    </ProfileBlock>
  );
}
