import { useState } from "react";
import { Modal } from "./Modal";
import { useResource, errorText } from "../data/hooks";
import type { Resource } from "../types";

export function ImageLibraryModal({ onClose, onSelect }: { onClose: () => void; onSelect: (file: File) => void | Promise<void> }) {
  const library = useResource<Resource[]>("/resources?category=image");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal wide onClose={onClose} ariaLabel="Картинка из библиотеки"><h2>Из библиотеки</h2>
    {(library.error || error) && <p role="alert">{library.error || error}</p>}
    {library.error && <button type="button" onClick={library.reload}>Повторить</button>}
    <div className="profile-library-grid">{(library.data ?? []).filter((r) => r.file_url).map((r) => <button type="button" key={r.id} disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const response = await fetch(r.file_url!);
        if (!response.ok) throw new Error("Не удалось прочитать картинку");
        const blob = await response.blob();
        await onSelect(new File([blob], r.file_path?.split(/[\\/]/).pop() || `${r.name}.png`, { type: blob.type }));
        onClose();
      } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    }}><img src={r.file_url!} alt="" loading="lazy" /><span>{r.name}</span></button>)}</div>
    {library.loading && <p>Загрузка…</p>}{library.data?.length === 0 && <p className="muted">В библиотеке пока нет картинок.</p>}
  </Modal>;
}
