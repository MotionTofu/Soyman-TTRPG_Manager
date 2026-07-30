import { useEffect, useState } from "react";
import type { ImageResource } from "./types";

interface Props {
  scope: "session" | "setting";
  entityId: number;
  campaignId: number;
  serverUrl: string;
  token: string;
}

// "Показывать игрокам изображения" — GM taps an image, every connected
// мобил-игрок in this campaign gets it pushed via the server's WebSocket
// broadcast (see server/src/services/realtime.ts + routes/campaigns.ts
// POST /:id/show-image, built in Phase 0 but never triggered by any client
// until now). No new backend needed here — just reusing the existing image
// list + broadcast endpoints.
//
// /files/* requires the same Bearer auth as the API (see index.ts) — a
// plain <img src> can't attach that header, so thumbnails are fetched as
// blobs here, same fix as мобил-игрок's receiving side (ShowImageListener).
export function ImagePicker({ scope, entityId, campaignId, serverUrl, token }: Props) {
  const [images, setImages] = useState<ImageResource[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [sentId, setSentId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const idParam = scope === "session" ? "session_id" : "setting_id";
    window.gmApp
      .apiGet<ImageResource[]>(`/api/resources?scope=${scope}&${idParam}=${entityId}&category=image`)
      .then(setImages)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [scope, entityId]);

  useEffect(() => {
    if (!images) return;
    let cancelled = false;
    (async () => {
      for (const img of images) {
        const url = img.file_url || img.link_url;
        if (!url || !/^\/files\//.test(url)) continue; // external link_url — just used directly on the receiving end
        try {
          const res = await fetch(`${serverUrl.replace(/\/$/, "")}${url}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok || cancelled) continue;
          const blob = await res.blob();
          if (cancelled) return;
          setThumbs((prev) => ({ ...prev, [img.id]: URL.createObjectURL(blob) }));
        } catch {
          // skip a thumbnail that fails to load rather than failing the whole grid
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [images, serverUrl, token]);

  async function send(image: ImageResource) {
    const url = image.file_url || image.link_url;
    if (!url) return;
    setError("");
    try {
      await window.gmApp.apiPost(`/api/campaigns/${campaignId}/show-image`, { url });
      setSentId(image.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!images) return <p className="muted">Загрузка…</p>;
  if (images.length === 0) return <p className="muted">Изображений пока нет.</p>;

  return (
    <div className="stack">
      {sentId != null && <p className="muted">Показано игрокам ✓</p>}
      <div className="image-grid">
        {images.map((img) => (
          <button key={img.id} onClick={() => send(img)} title={img.name}>
            {thumbs[img.id] ? <img src={thumbs[img.id]} alt={img.name} /> : <span className="muted">…</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
