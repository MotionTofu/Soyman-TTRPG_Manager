import { useEffect, useState } from "react";
import { hasElectronAPI, type UpdateStatus } from "../electronApi";

// Shared "Обновления" widget — originally lived only in
// StoragesSettingsPage.tsx, extracted so the same check/download/install
// controls can also render directly on the Главная page.
export function UpdateChecker() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (!hasElectronAPI()) return;
    window.electronAPI!.getAppVersion().then(setAppVersion);
    return window.electronAPI!.onUpdateStatus(setUpdate);
  }, []);

  async function checkForUpdates() {
    setUpdate({ status: "checking" });
    const result = await window.electronAPI!.checkForUpdates();
    if (!result.ok) setUpdate({ status: "error", message: "Проверка обновлений недоступна в этом режиме запуска" });
  }

  return (
    <>
      <p className="muted">Текущая версия: {appVersion ?? "…"}</p>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <button onClick={checkForUpdates} disabled={update?.status === "checking" || update?.status === "downloading"}>
          Проверить обновления
        </button>
        <button
          className="primary"
          disabled={update?.status !== "downloaded"}
          onClick={() => window.electronAPI!.quitAndInstall()}
        >
          Обновить
        </button>
        {update && update.status !== "downloaded" && (
          <span className="muted">
            {update.status === "checking" && "Проверяем обновления…"}
            {update.status === "available" && "Обновление найдено, скачиваем…"}
            {update.status === "not-available" && "У вас последняя версия"}
            {update.status === "downloading" &&
              `Скачивание…${update.percent ? " " + Math.round(update.percent) + "%" : ""}`}
            {update.status === "error" && (update.message || "Не удалось проверить обновления")}
          </span>
        )}
      </div>
    </>
  );
}
