import { useState } from "react";
import { Link } from "react-router-dom";
import { errorText, useAfterWrite, useResource, write } from "../../data/hooks";
import type { MapSummary } from "../../maps/mapTypes";

interface LinkedMap { id: number; name: string; grid: string; width: number; height: number }
interface SceneMapsData { scene_id: number; maps: LinkedMap[] }

export function SceneMaps({ sceneId, campaignId }: { sceneId: number; campaignId: number | null }) {
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/story/scenes/${sceneId}/maps${campaignId != null ? `?campaign_id=${campaignId}` : ""}`;
  const linked = useResource<SceneMapsData>(path);
  const all = useResource<MapSummary[]>("/maps").data ?? [];
  const afterWrite = useAfterWrite();
  const ids = new Set((linked.data?.maps ?? []).map((m) => m.id));

  async function change(mapId: number, remove: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (remove) await write.del(`/story/scenes/${sceneId}/maps/${mapId}${campaignId != null ? `?campaign_id=${campaignId}` : ""}`);
      else await write.post(`/story/scenes/${sceneId}/maps`, { map_id: mapId, campaign_id: campaignId });
      afterWrite([{ path }, { kind: "scene" }, { path: "/sessions" }]);
      setSelected(0);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return <div className="card stack">
    <div className="campaign-overview-header">Карты сцены</div>
    <p className="muted" style={{ margin: 0 }}>Привязанные карты доступны на пульте сессии для показа на втором экране.</p>
    {linked.error && <p role="alert">Не удалось загрузить карты: {linked.error}</p>}
    {(linked.data?.maps ?? []).map((map) => <div key={map.id} className="row" style={{ gap: 8, alignItems: "center" }}>
      <Link to={`/maps/${map.id}`}>{map.name}</Link>
      <span className="muted">{map.width}×{map.height}</span>
      <button type="button" disabled={busy} onClick={() => void change(map.id, true)}>Убрать из сцены</button>
    </div>)}
    {linked.data && linked.data.maps.length === 0 && <span className="muted">Карты пока не привязаны.</span>}
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <select aria-label="Карта для сцены" value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
        <option value={0}>Выберите карту…</option>
        {all.filter((map) => !ids.has(map.id)).map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
      </select>
      <button type="button" disabled={busy || !selected} onClick={() => void change(selected, false)}>Привязать карту</button>
    </div>
    {error && <p role="alert">Карта не привязалась: {error}</p>}
  </div>;
}
