import { useEffect, useState } from "react";
import { api } from "../api/client";
import { safeBackgroundImage } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import type { AppSettings } from "../types";

function bgStyle(url: string | null, blob: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/files/")) return blob ? `url("${blob}")` : undefined;
  return safeBackgroundImage(url);
}

export function SectionBackground() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    api.get<AppSettings>("/app-settings").then((s) => setUrl(s.home_background_url)).catch(() => {});
  }, []);
  const blob = useAuthenticatedFileUrl(url);
  const style = bgStyle(url, blob);
  if (!style) return null;
  return (
    <div className="campaign-bg-layer cover-photo" aria-hidden="true">
      <div className="cover-art-image" style={{ backgroundImage: style }} />
    </div>
  );
}
