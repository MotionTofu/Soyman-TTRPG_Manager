import { useResource } from "../data/hooks";
import { safeBackgroundImage } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import type { AppSettings } from "../types";

function bgStyle(url: string | null, blob: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/files/")) return blob ? `url("${blob}")` : undefined;
  return safeBackgroundImage(url);
}

export function SectionBackground() {
  // Фон — из настроек приложения под ключом слоя: смена фона в настройках
  // доходит до открытых разделов без перезагрузки.
  const url = useResource<AppSettings>("/app-settings").data?.home_background_url ?? null;
  const blob = useAuthenticatedFileUrl(url);
  const style = bgStyle(url, blob);
  if (!style) return null;
  return (
    <div className="campaign-bg-layer cover-photo" aria-hidden="true">
      <div className="cover-art-image" style={{ backgroundImage: style }} />
    </div>
  );
}
