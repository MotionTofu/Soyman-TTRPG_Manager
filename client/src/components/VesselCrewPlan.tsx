import { useState } from "react";
import { isSafeImageUrl } from "../utils/safeUrl";
import { CREW_DRAG_MIME, readCrewDrag, type CrewDrag, type Vessel } from "../data/campaignVessels";

// Чертёж корабля кампании (спека profiles-paper-2, «Корабль кампании»;
// доска 39): картинка и пины — основы, своё у корабля только экипаж под
// пином поста и красный цвет разбитого поста. Пины здесь не двигаются:
// раскладка правится на чертеже судна в компендиуме.

export function VesselCrewPlan({
  vessel,
  large = false,
  onDropCrew,
}: {
  vessel: Vessel;
  /** Вкладка «Чертёж»: подписи постов крупнее и всегда видны. */
  large?: boolean;
  /** Перетаскивание человека на пин поста; без него чертёж только читается. */
  onDropCrew?: (postId: number, item: CrewDrag) => void;
}) {
  const [over, setOver] = useState<number | null>(null);
  const url = vessel.blueprint_image_url;
  if (!url || !isSafeImageUrl(url)) return null;
  const postsById = new Map(vessel.posts.map((p) => [p.id, p]));

  return (
    <div className={`vessel-plan${large ? " is-large" : ""}`}>
      <img src={url} alt={`Чертёж: ${vessel.name}`} />
      {vessel.pins.map((pin) => {
        const post = pin.post_id != null ? postsById.get(pin.post_id) : undefined;
        if (pin.post_id != null && !post) return null;
        const names = post?.crew.map((c) => c.name) ?? [];
        if (post && post.unnamed > 0) names.push(`+${post.unnamed}`);
        const drop = post && onDropCrew;
        return (
          <div
            key={pin.id}
            className={[
              "vessel-plan__pin",
              post ? "" : "is-label",
              post?.broken ? "is-broken" : "",
              over === post?.id ? "is-over" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            // инлайн-стиль намеренно — положение пина на картинке
            style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
            onDragOver={
              drop
                ? (e) => {
                    if (!e.dataTransfer.types.includes(CREW_DRAG_MIME)) return;
                    e.preventDefault();
                    setOver(post.id);
                  }
                : undefined
            }
            onDragLeave={drop ? () => setOver(null) : undefined}
            onDrop={
              drop
                ? (e) => {
                    e.preventDefault();
                    setOver(null);
                    const item = readCrewDrag(e);
                    if (item) onDropCrew(post.id, item);
                  }
                : undefined
            }
            title={post ? `${post.name}${post.broken ? " — выведен из строя" : ""}` : pin.label}
          >
            <span className="vessel-plan__dot" />
            {(large || !post) && <span className="vessel-plan__post">{pin.label}</span>}
            {names.length > 0 && <span className="vessel-plan__crew">{names.join(", ")}</span>}
          </div>
        );
      })}
    </div>
  );
}
