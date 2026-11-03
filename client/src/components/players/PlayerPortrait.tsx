import { useAuthenticatedFileUrl } from "../../utils/fileUrl";
import { isSafeImageUrl } from "../../utils/safeUrl";

/** Один портрет для списка, паспорта и персонажей; /files требует авторизации. */
export function PlayerPortrait({ url, name, character = false }: { url?: string | null; name: string; character?: boolean }) {
  const safeUrl = url && isSafeImageUrl(url) ? url : null;
  const authenticated = useAuthenticatedFileUrl(safeUrl);
  const source = safeUrl?.startsWith("/files/") ? authenticated : safeUrl;
  return (
    <span className={`player-d-portrait${character ? " player-d-portrait--character" : ""} cover-photo cover-halftone`}>
      {source ? <img className="cover-art-image" src={source} alt={`Портрет: ${name}`} /> : (
        <span className="player-d-placeholder" aria-label={`Портрет не выбран: ${name}`}>
          <span aria-hidden="true">{name.slice(0, 1)}</span>
        </span>
      )}
    </span>
  );
}
