import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

type LinkedResource = { uid: string; file_url: string | null };
const UID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ResourceLinkPage() {
  const { uid } = useParams();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!uid || !UID_RE.test(uid)) { setError("Неверная ссылка на Ресурс"); return; }
    let cancelled = false;
    void api.get<LinkedResource[]>(`/resources/resolve?uids=${uid}`, { timeoutMs: 15_000 })
      .then(rows => {
        if (cancelled) return;
        const fileUrl = rows[0]?.file_url;
        if (fileUrl) window.location.replace(fileUrl);
        else setError("Ресурс недоступен или его файл отсутствует");
      })
      .catch(() => { if (!cancelled) setError("Не удалось открыть Ресурс"); });
    return () => { cancelled = true; };
  }, [uid]);
  return <section className="pdf-markdown__body">
    <p role={error ? "alert" : "status"}>{error || "Открываю Ресурс…"}</p>
    <Link to="/resources">К Ресурсам</Link>
  </section>;
}
