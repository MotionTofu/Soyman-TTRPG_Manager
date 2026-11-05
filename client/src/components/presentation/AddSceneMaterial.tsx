import { useEffect, useState } from "react";
import { errorText, useAfterWrite, useResource, write } from "../../data/hooks";
import { IMAGE_ACCEPT } from "../../imageUpload";
import { TACTICAL_CELL, type MapSummary } from "../../maps/mapTypes";
import { loadSearchEngine, searchWeb } from "../../searchEngine";
import { Modal } from "../Modal";
import { MentionPickerModal } from "../mentions/MentionPickerModal";
import type { GalleryImage, Resource, ScenePresentation } from "../../types";

// Пустые «Картинка» и «Карта» Пульта (2026-10-29, Q5): материал добавляется
// в саму сцену, как в подготовке, и сразу уходит на экран.

interface SceneRef {
  sceneId: number;
  sceneName: string;
  campaignId: number | null;
}

export function AddScenePicture({ sceneId, sceneName, campaignId, onAdded, onClose }: SceneRef & {
  onAdded: (pres: ScenePresentation) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"resources" | "gallery">("resources");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState<{ type: string; id: number; title: string } | null>(null);
  const [ownerPicker, setOwnerPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const afterWrite = useAfterWrite();
  const resources = useResource<Resource[]>(tab === "resources" ? "/resources?category=image" : null);
  const gallery = useResource<GalleryImage[]>(tab === "gallery" && owner ? `/gallery?owner_type=${owner.type}&owner_id=${owner.id}` : null);
  const rows = tab === "resources"
    ? (resources.data ?? []).filter((r) => r.file_path).map((r) => ({ key: `r${r.id}`, name: r.name, url: r.file_url, source: { kind: "resource", id: r.id } }))
    : (gallery.data ?? []).map((g) => ({ key: `g${g.id}`, name: g.caption || `Изображение ${g.position + 1}`, url: g.image_url, source: { kind: "gallery", id: g.id } }));
  const visible = rows.filter((r) => r.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));

  async function save(body: FormData | { source: { kind: string; id: number } }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const base = `/story/scenes/${sceneId}/presentation`;
      if (body instanceof FormData && campaignId != null) body.append("campaign_id", String(campaignId));
      const payload = body instanceof FormData ? body : { ...body, ...(campaignId != null ? { campaign_id: campaignId } : {}) };
      const pres = await write.post<ScenePresentation>(`${base}/background`, payload, { timeoutMs: 120_000 });
      afterWrite([{ path: base }, { kind: "scene" }, { path: "/sessions" }]);
      onAdded(pres);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function upload(file: File | undefined) {
    if (!file?.type.startsWith("image/")) return;
    const form = new FormData();
    form.append("file", file);
    void save(form);
  }

  // Ctrl+V: картинку, найденную в браузере, копируют и вставляют сюда.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      upload(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  return (
    <Modal wide ariaLabel="Картинка для сцены" closeOnBackdropClick={false} onClose={() => !busy && onClose()}>
      <div className="stack add-material">
        <h2>У сцены «{sceneName}» нет картинки</h2>
        <div
          className={`add-material__drop${over ? " is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            upload(e.dataTransfer.files[0]);
          }}
        >
          <span>Перетащите картинку сюда или вставьте Ctrl+V</span>
          <span className="row" style={{ gap: 8 }}>
            <label className="d-btn d-btn--sm">
              С диска
              <input type="file" accept={IMAGE_ACCEPT} hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
            </label>
            <button type="button" className="d-btn d-btn--sm" onClick={() => searchWeb(sceneName)}>
              Найти в {loadSearchEngine().label}
            </button>
          </span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="d-seg" role="group" aria-label="Из библиотеки">
            <button type="button" className={tab === "resources" ? "active" : undefined} onClick={() => setTab("resources")}>
              Изображения
            </button>
            <button type="button" className={tab === "gallery" ? "active" : undefined} onClick={() => setTab("gallery")}>
              Галерея записи
            </button>
          </span>
          {tab === "gallery" && (
            <button type="button" className="d-btn d-btn--sm" onClick={() => setOwnerPicker(true)}>
              {owner?.title ?? "Выбрать запись"}
            </button>
          )}
          <input aria-label="Поиск картинки" placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="add-material__grid">
          {visible.map((r) => (
            <button key={r.key} type="button" disabled={busy} title={r.name} onClick={() => void save({ source: r.source })}>
              {r.url && <img src={r.url} alt="" loading="lazy" />}
              <span>{r.name}</span>
            </button>
          ))}
          {!visible.length && (
            <p className="muted">{tab === "gallery" && !owner ? "Выберите запись с галереей." : "Ничего не нашлось."}</p>
          )}
        </div>
        {(error || busy) && <p role={error ? "alert" : "status"}>{error ?? "Сохраняю…"}</p>}
      </div>
      {ownerPicker && (
        <MentionPickerModal
          initialQuery=""
          heading="Запись с галереей"
          direct
          onlyTypes={["character", "being", "location", "community", "artifact", "compendium_entry"]}
          onClose={() => setOwnerPicker(false)}
          onPick={(result) => {
            setOwner(result);
            setOwnerPicker(false);
          }}
        />
      )}
    </Modal>
  );
}

export function AddSceneMap({ sceneId, sceneName, campaignId, onAdded, onClose }: SceneRef & {
  onAdded: (sceneId: number, mapId: number) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const afterWrite = useAfterWrite();
  const maps = (useResource<MapSummary[]>("/maps").data ?? []).filter((m) =>
    m.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );

  async function link(mapId: number) {
    const res = await write.post<{ scene_id: number }>(`/story/scenes/${sceneId}/maps`, { map_id: mapId, ...(campaignId != null ? { campaign_id: campaignId } : {}) });
    afterWrite([{ path: `/story/scenes/${sceneId}/maps` }, { kind: "scene" }, { path: "/sessions" }]);
    return res.scene_id;
  }
  async function run(job: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await job();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const pick = (mapId: number) => run(async () => onAdded(await link(mapId), mapId));
  // Новая карта — тактический черновик, как «Быстрая карта» в списке карт;
  // редактор открывается рядом, Пульт остаётся.
  const create = () =>
    run(async () => {
      const created = await write.post<{ id: number }>("/maps", {
        name: sceneName,
        grid: "square",
        scale: "locality",
        cell_lore: TACTICAL_CELL,
        width: 50,
        height: 40,
      });
      afterWrite([{ kind: "map", card: true }]);
      await link(created.id);
      window.open(`/maps/${created.id}/workspace`, "_blank");
    });

  return (
    <Modal ariaLabel="Карта для сцены" closeOnBackdropClick={false} onClose={() => !busy && onClose()}>
      <div className="stack add-material">
        <h2>К сцене «{sceneName}» не привязаны карты</h2>
        <div className="row" style={{ gap: 8 }}>
          <input aria-label="Поиск карты" placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="button" className="d-btn d-btn--sm" disabled={busy} onClick={() => void create()}>
            Новая карта
          </button>
        </div>
        <div className="add-material__list">
          {maps.map((m) => (
            <button key={m.id} type="button" disabled={busy} onClick={() => void pick(m.id)}>
              {m.name}
            </button>
          ))}
          {!maps.length && <p className="muted">Ничего не нашлось.</p>}
        </div>
        {(error || busy) && <p role={error ? "alert" : "status"}>{error ?? "Сохраняю…"}</p>}
      </div>
    </Modal>
  );
}
