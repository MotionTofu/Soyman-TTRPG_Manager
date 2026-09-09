import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../../imageUpload";
import { useConfirm } from "../../hooks/useConfirm";
import { EmptyState } from "../EmptyState";
import { PresentationStage, type LayerGeom } from "./PresentationStage";
import { postPreview } from "./previewChannel";
import { getScreens, loadLastScreenId, openOnScreen } from "./screens";
import type { PresentationData, PresentationLayer } from "../../types";

// Вкладка «Представление» сцены и заглавное кампании: фон + слои на холсте
// 16:9 (drag + угловые ручки, координаты в %; Shift — свободное
// растягивание), список слоёв, поля входа (переход + титр + фейд).
//
// Правки сцены несут campaign_id, как остальные карточки страницы сцены:
// первая правка из кампании клонирует сцену (copy-on-write), и id слоёв
// после этого принадлежат копии. Поэтому перед первой слойной правкой
// ensureWritable() материализует копию пустым PUT и переотображает id по
// позиции+имени — иначе первое же движение слоя ушло бы в 404. У заглавного
// копий нет — правится напрямую.
export type PresentationOwner =
  | { kind: "scene"; sceneId: number; sceneName: string; campaignId: number | null }
  | { kind: "campaign"; campaignId: number; campaignName: string };

type EditorData = PresentationData & { scene_id?: number; content_scene_id?: number };

export function PresentationEditor({ owner }: { owner: PresentationOwner }) {
  const [confirmDialog, confirm] = useConfirm();
  const [data, setData] = useState<EditorData | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [fields, setFields] = useState({ transition: "cut", transition_ms: 600, title: "", title_secs: 3, fade_ms: 600 });
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

  const base =
    owner.kind === "scene" ? `/story/scenes/${owner.sceneId}/presentation` : `/campaigns/${owner.campaignId}/cover`;
  const readUrl =
    base + (owner.kind === "scene" && owner.campaignId != null ? `?campaign_id=${owner.campaignId}` : "");
  // Контекст кампании едет телом (DELETE тела не несёт — там query, см. removeLayer).
  const withCtx = (b: Record<string, unknown>) =>
    owner.kind === "scene" && owner.campaignId != null ? { ...b, campaign_id: owner.campaignId } : b;
  const deleteSuffix = owner.kind === "scene" && owner.campaignId != null ? `?campaign_id=${owner.campaignId}` : "";
  const defaultTitle = owner.kind === "scene" ? owner.sceneName : owner.campaignName;
  const ownerKey = owner.kind === "scene" ? `s${owner.sceneId}c${owner.campaignId}` : `c${owner.campaignId}`;

  function refresh() {
    api
      .get<EditorData>(readUrl)
      .then((p) => {
        setData(p);
        // Титр по умолчанию — название сцены/кампании, но только пока
        // представление свежее: стёртый титр не должен воскресать.
        const fresh = !p.background_url && p.layers.length === 0 && !p.title;
        setFields({
          transition: p.transition,
          transition_ms: p.transition_ms,
          title: p.title || (fresh ? defaultTitle : ""),
          title_secs: p.title_secs,
          fade_ms: p.fade_ms,
        });
        setFieldsDirty(false);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [ownerKey]);

  async function ensureWritable(current: EditorData): Promise<{ data: EditorData; map: Map<number, number> }> {
    const map = new Map<number, number>();
    for (const l of current.layers) map.set(l.id, l.id);
    if (owner.kind === "scene" && owner.campaignId != null && current.scene_id === owner.sceneId) {
      // Первая правка из кампании: пустой PUT клонирует сцену вместе со слоями.
      const fresh = await api.put<EditorData>(base, { campaign_id: owner.campaignId });
      setData(fresh);
      map.clear();
      const byKey = new Map(fresh.layers.map((l) => [`${l.position}:${l.name}`, l.id]));
      for (const l of current.layers) {
        const nid = byKey.get(`${l.position}:${l.name}`) ?? fresh.layers[l.position]?.id;
        if (nid != null) map.set(l.id, nid);
      }
      return { data: fresh, map };
    }
    return { data: current, map };
  }

  async function saveFields() {
    try {
      const updated = await api.put<EditorData>(base, withCtx({ ...fields }));
      setData(updated);
      setFieldsDirty(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  }

  function campaignField(form: FormData) {
    if (owner.kind === "scene" && owner.campaignId != null) form.append("campaign_id", String(owner.campaignId));
  }

  async function uploadBackground(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      campaignField(form);
      const updated = await api.post<EditorData>(`${base}/background`, form);
      setData(updated);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить фон");
    } finally {
      setUploading(false);
    }
  }

  async function uploadLayers(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("name", file.name.replace(/\.[^.]+$/, "").slice(0, 200) || "Слой");
        campaignField(form);
        const updated = await api.post<EditorData>(`${base}/layers`, form);
        setData(updated);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить слой");
    } finally {
      setUploading(false);
    }
  }

  function patchLayer(id: number, patch: Partial<PresentationLayer>) {
    if (!data) return;
    setData({ ...data, layers: data.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }

  async function commitGeometry(id: number, geom: LayerGeom) {
    if (!data) return;
    // Без сравнений со стейтом: к моменту коммита замыкание data уже
    // содержит это движение (сравнение дало бы «без изменений» всегда).
    // Неподвижный клик стейдж вообще не коммитит (см. endDrag).
    try {
      const { data: writable, map } = await ensureWritable(data);
      const lid = map.get(id) ?? id;
      const updated = await api.put<PresentationLayer>(`${base}/layers/${lid}`, withCtx({ ...geom }));
      const merged = writable.layers.map((l) => (l.id === lid ? { ...updated, image_url: l.image_url } : l));
      setData({ ...writable, layers: merged });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подвинуть слой");
      refresh();
    }
  }

  function onGeometry(id: number, geom: LayerGeom, commit: boolean) {
    patchLayer(id, geom);
    if (commit) void commitGeometry(id, geom);
  }

  async function saveLayerFlags(id: number, patch: { has_button?: number; visible_on_enter?: number }) {
    if (!data) return;
    const prev = data.layers;
    patchLayer(id, patch);
    try {
      const { data: writable, map } = await ensureWritable(data);
      const lid = map.get(id) ?? id;
      await api.put(`${base}/layers/${lid}`, withCtx({ ...patch }));
      setError(null);
      void writable;
    } catch (e) {
      setData({ ...data, layers: prev });
      setError(e instanceof Error ? e.message : "Не удалось сохранить слой");
    }
  }

  async function commitRename() {
    if (!renaming || !data) {
      setRenaming(null);
      return;
    }
    const name = renaming.name.trim();
    const id = renaming.id;
    setRenaming(null);
    if (!name) {
      refresh();
      return;
    }
    const prev = data.layers;
    patchLayer(id, { name });
    try {
      const { data: writable, map } = await ensureWritable(data);
      const lid = map.get(id) ?? id;
      await api.put(`${base}/layers/${lid}`, withCtx({ name }));
      setError(null);
      void writable;
    } catch (e) {
      setData({ ...data, layers: prev });
      setError(e instanceof Error ? e.message : "Не удалось переименовать");
    }
  }

  async function reorder(draggedId: number, targetId: number) {
    if (!data || draggedId === targetId) return;
    const ids = data.layers.map((l) => l.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const prev = data.layers;
    const order = new Map(ids.map((id, i) => [id, i]));
    setData({ ...data, layers: [...data.layers].sort((a, b) => order.get(a.id)! - order.get(b.id)!) });
    try {
      const { data: writable, map } = await ensureWritable(data);
      const freshOrder = ids.map((id) => map.get(id) ?? id);
      const layers = await api.put<PresentationLayer[]>(
        `${base}/layers/reorder`,
        withCtx({ order: freshOrder })
      );
      setData({ ...writable, layers });
      setError(null);
    } catch (e) {
      setData({ ...data, layers: prev });
      setError(e instanceof Error ? e.message : "Не удалось изменить порядок");
    }
  }

  async function removeLayer(id: number) {
    if (!data) return;
    const layer = data.layers.find((l) => l.id === id);
    const ok = await confirm({
      title: "Убрать слой?",
      message: `Слой «${layer?.name ?? ""}» уйдёт из представления. Файл останется на диске.`,
      confirmLabel: "Убрать",
      danger: true,
    });
    if (!ok) return;
    try {
      const { data: writable, map } = await ensureWritable(data);
      const lid = map.get(id) ?? id;
      await api.del(`${base}/layers/${lid}${deleteSuffix}`);
      setData({ ...writable, layers: writable.layers.filter((l) => l.id !== lid) });
      if (selectedId === id) setSelectedId(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось убрать слой");
    }
  }

  // Предпросмотр входа черновика: на холсте (без edit-режима, с playKey) и
  // в отдельном окне (второй монитор, show-state не трогаем). Параметры —
  // из черновика полей, слои — сохранённые: флаги слоёв пишутся сразу.
  // Хуки — до раннего return ниже, иначе нарушение правил хуков.
  const [previewKey, setPreviewKey] = useState<number | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    []
  );

  if (!data) return <p className="muted">Загрузка…</p>;

  const isEmpty = !data.background_url && data.layers.length === 0;
  const entryVisible = data.layers.filter((l) => l.has_button === 0 || l.visible_on_enter === 1).map((l) => l.id);
  const isOverride = owner.kind === "scene" && owner.campaignId != null && data.scene_id !== owner.sceneId;

  function stopPreview() {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    setPreviewKey(null);
  }
  function startCanvasPreview() {
    stopPreview();
    const key = Date.now();
    setPreviewKey(key);
    // Без титра onTitleDone не позовут — выходим по длительности перехода.
    const ms = fields.transition === "cut" ? 0 : fields.transition_ms;
    const titleMs = fields.title && fields.title_secs > 0 ? fields.title_secs * 1000 : 0;
    previewTimer.current = setTimeout(stopPreview, Math.max(ms, titleMs) + 400);
  }
  async function openWindowPreview() {
    if (!data) return;
    const list = await getScreens();
    const last = loadLastScreenId();
    const target = list.find((s) => s.id === last) ?? list.find((s) => !s.primary) ?? list[0] ?? null;
    openOnScreen("/presentation-preview", "presentation-preview", target);
    // Окно может ещё грузиться: localStorage подхватит при монтировании,
    // канал — если уже открыто.
    postPreview({
      background_url: data.background_url,
      layers: data.layers,
      visibleIds: entryVisible,
      fadeMs: fields.fade_ms,
      transition: fields.transition,
      transitionMs: fields.transition_ms,
      title: fields.title,
      titleSecs: fields.title_secs,
      playKey: Date.now(),
    });
    // Дубль через кадр — если окно открылось между чтением стора и подпиской.
    setTimeout(() => {
      if (!data) return;
      postPreview({
        background_url: data.background_url,
        layers: data.layers,
        visibleIds: data.layers.filter((l) => l.has_button === 0 || l.visible_on_enter === 1).map((l) => l.id),
        fadeMs: fields.fade_ms,
        transition: fields.transition,
        transitionMs: fields.transition_ms,
        title: fields.title,
        titleSecs: fields.title_secs,
        playKey: Date.now(),
      });
    }, 600);
  }

  return (
    <div className="stack">
      {confirmDialog}
      {isOverride && <span className="badge tag">правка кампании</span>}
      {error && (
        <div className="card" style={{ borderColor: "var(--danger, #c00)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--danger, #c00)", fontSize: "var(--fs-meta)" }}>{error}</span>
          <button onClick={() => refresh()}>Повторить</button>
        </div>
      )}

      {isEmpty ? (
        <EmptyState
          title="Представления нет"
          hint={`Положите фон — кадр 16:9 для второго монитора. ${IMAGE_HINT}`}
          action={
            <label className="primary" style={{ padding: "6px 12px", border: "1px solid var(--primary-bg)", cursor: "pointer" }}>
              {uploading ? "Загрузка…" : "Выбрать фон"}
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => uploadBackground(e.target.files?.[0] ?? null)}
              />
            </label>
          }
        />
      ) : (
        <>
          {previewKey != null ? (
            <PresentationStage
              backgroundUrl={data.background_url}
              layers={data.layers}
              visibleIds={entryVisible}
              fadeMs={fields.fade_ms}
              transition={fields.transition}
              transitionMs={fields.transition_ms}
              title={fields.title}
              titleSecs={fields.title_secs}
              playKey={previewKey}
              interactive
              onTitleDone={stopPreview}
              waitingLabel="Пустой кадр"
            />
          ) : (
            <PresentationStage
              backgroundUrl={data.background_url}
              layers={data.layers}
              visibleIds={entryVisible}
              fadeMs={data.fade_ms}
              transition={data.transition}
              transitionMs={data.transition_ms}
              title=""
              titleSecs={0}
              playKey="edit"
              waitingLabel="Пустой кадр"
              edit={{ selectedId, onSelect: setSelectedId, onGeometry, showHidden: true }}
            />
          )}
          <p className="muted" style={{ fontSize: "var(--fs-meta)", maxWidth: "62ch" }}>
            {previewKey != null
              ? "Идёт предпросмотр входа — клик или Esc пропускают титр."
              : "Тяните слой, чтобы двигать; углы — масштаб (пропорции держатся, Shift — свободно). Клик по пустому — снять выбор."}
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <button type="button" onClick={startCanvasPreview} disabled={previewKey != null}>
              ▶ Предпросмотр входа
            </button>
            <button type="button" className="comp-mini" onClick={openWindowPreview} title="Черновик в окне второго монитора">
              ⇱ Предпросмотр в окне
            </button>
          </div>

          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <label className="primary" style={{ padding: "6px 12px", border: "1px solid var(--primary-bg)", cursor: "pointer" }}>
              {uploading ? "Загрузка…" : "Заменить фон"}
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => uploadBackground(e.target.files?.[0] ?? null)}
              />
            </label>
            <label style={{ padding: "6px 12px", border: "1px solid var(--line)", cursor: "pointer" }}>
              {uploading ? "Загрузка…" : "+ Слои"}
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => uploadLayers(e.target.files)}
              />
            </label>
          </div>

          {data.layers.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              {data.layers.map((l) => (
                <div
                  key={l.id}
                  className="row"
                  draggable
                  onDragStart={() => setDragId(l.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragId != null) {
                      void reorder(dragId, l.id);
                      setDragId(null);
                    }
                  }}
                  style={{
                    gap: 8,
                    alignItems: "center",
                    border: selectedId === l.id ? "1px solid var(--accent)" : "1px solid var(--line)",
                    padding: "6px 8px",
                    background: "var(--paper)",
                  }}
                  onClick={() => setSelectedId(l.id)}
                >
                  {l.image_url ? (
                    <img src={l.image_url} alt="" style={{ width: 40, height: 23, objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <span style={{ width: 40, height: 23, background: "var(--paper-2)", flexShrink: 0 }} />
                  )}
                  {renaming?.id === l.id ? (
                    <input
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: l.id, name: e.target.value })}
                      onBlur={() => void commitRename()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ flex: "1 1 120px", minWidth: 0 }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming({ id: l.id, name: l.name });
                      }}
                      title="Переименовать (имя станет подписью кнопки)"
                      style={{ flex: "1 1 120px", minWidth: 0, textAlign: "left", background: "none", border: "none", cursor: "text", padding: 0 }}
                    >
                      <strong>{l.name || "Без имени"}</strong>
                    </button>
                  )}
                  <label className="row muted" style={{ gap: 4, alignItems: "center", cursor: "pointer", fontSize: "var(--fs-micro)" }}>
                    <input
                      type="checkbox"
                      checked={l.has_button === 1}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => void saveLayerFlags(l.id, { has_button: e.target.checked ? 1 : 0 })}
                    />
                    Кнопка
                  </label>
                  <label className="row muted" style={{ gap: 4, alignItems: "center", cursor: "pointer", fontSize: "var(--fs-micro)" }}>
                    <input
                      type="checkbox"
                      checked={l.visible_on_enter === 1}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => void saveLayerFlags(l.id, { visible_on_enter: e.target.checked ? 1 : 0 })}
                    />
                    При входе
                  </label>
                  <button
                    type="button"
                    className="danger comp-mini"
                    aria-label="Убрать слой"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeLayer(l.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                Имя слоя — подпись кнопки в пульте. Порядок в списке = порядок на кадре (тяните строки).
              </span>
            </div>
          )}

          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span className="campaign-field-label" style={{ margin: 0 }}>Переход:</span>
              <select
                value={fields.transition}
                onChange={(e) => {
                  setFields({ ...fields, transition: e.target.value });
                  setFieldsDirty(true);
                }}
              >
                <option value="cut">Резко</option>
                <option value="fade">Кросс-фейд</option>
                <option value="black">Через чёрный</option>
              </select>
              <label className="row muted" style={{ gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: "var(--fs-micro)" }}>мс</span>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={fields.transition_ms}
                  onChange={(e) => {
                    setFields({ ...fields, transition_ms: Number(e.target.value) || 0 });
                    setFieldsDirty(true);
                  }}
                  style={{ width: 76 }}
                />
              </label>
              <label className="row muted" style={{ gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: "var(--fs-micro)" }}>Фейд слоёв, мс</span>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={fields.fade_ms}
                  onChange={(e) => {
                    setFields({ ...fields, fade_ms: Number(e.target.value) || 0 });
                    setFieldsDirty(true);
                  }}
                  style={{ width: 76 }}
                />
              </label>
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span className="campaign-field-label" style={{ margin: 0 }}>Титр:</span>
              <input
                placeholder={defaultTitle}
                value={fields.title}
                onChange={(e) => {
                  setFields({ ...fields, title: e.target.value });
                  setFieldsDirty(true);
                }}
                style={{ flex: "1 1 200px" }}
              />
              <label className="row muted" style={{ gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: "var(--fs-micro)" }}>сек</span>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={fields.title_secs}
                  onChange={(e) => {
                    setFields({ ...fields, title_secs: Number(e.target.value) || 0 });
                    setFieldsDirty(true);
                  }}
                  style={{ width: 64 }}
                />
              </label>
              <button className="primary" onClick={() => void saveFields()} disabled={!fieldsDirty}>
                Сохранить вход
              </button>
            </div>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              Пустой титр — без титра. Титр идёт поверх конца перехода, Esc/клик пропускают.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
