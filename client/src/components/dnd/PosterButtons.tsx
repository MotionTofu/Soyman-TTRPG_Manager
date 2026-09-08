import { useState } from "react";
import { downloadPoster, sharePoster, type PosterData } from "./CharacterPoster";

// Кнопки постера: PNG-скачивание + системный шаринг с фолбэком.
// Данные отдаёт родитель колбэком — собираются в момент нажатия,
// поэтому кнопки не протухают при правках между рендерами.
export function PosterButtons({
  getData,
  fileBase,
}: {
  getData: () => PosterData;
  fileBase: string;
}) {
  const [busy, setBusy] = useState<null | "png" | "share">(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "png" | "share") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const data = getData();
      if (kind === "png") {
        await downloadPoster(data, fileBase);
      } else {
        await sharePoster(data, fileBase);
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
    <div className="stack" style={{ gap: "var(--sp-1)" }}>
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
