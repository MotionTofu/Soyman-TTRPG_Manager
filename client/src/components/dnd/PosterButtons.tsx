import { useState } from "react";
import { downloadBlob, posterFileName, shareBlobFile } from "./CharacterPoster";

// Кнопки постера: PNG-скачивание + системный шаринг с фолбэком.
// Blob отдаёт родитель колбэком — собирается в момент нажатия, поэтому
// кнопки не протухают при правках между рендерами. Что внутри blob —
// дело родителя: визард рисует canvas (CharacterPoster), карта снимает
// лицевую сторону (cardSnapshot).
export function PosterButtons({
  getBlob,
  fileBase,
  shareTitle,
}: {
  getBlob: () => Promise<Blob>;
  fileBase: string;
  shareTitle: string;
}) {
  const [busy, setBusy] = useState<null | "png" | "share">(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "png" | "share") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const blob = await getBlob();
      if (kind === "png") {
        downloadBlob(blob, posterFileName(fileBase));
      } else {
        await shareBlobFile(blob, fileBase, shareTitle);
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        // свайп «отмена» в системном шаринге — не ошибка
      } else {
        setError(e instanceof Error && e.message ? e.message : "Не удалось собрать постер");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: "var(--sp-2)" }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={() => void run("png")} disabled={busy !== null}>
          {busy === "png" ? "Собираю…" : "Скачать постер (PNG)"}
        </button>
        <button type="button" onClick={() => void run("share")} disabled={busy !== null}>
          {busy === "share" ? "Собираю…" : "Поделиться"}
        </button>
      </div>
      {error && (
        <div className="sb-save-status is-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
