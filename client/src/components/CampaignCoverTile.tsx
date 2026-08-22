import { Link } from "react-router-dom";
import type { Campaign } from "../types";
import { formatNearestDate } from "../nearestDate";

// Плитка-обложка (§6.3.1): обложка с подписью поверх и компактная мета под
// ней. Общая для сетки на «Кампаниях» и ряда на главной — два экрана рисуют
// одну и ту же карточку, а не две почти одинаковые.
//
// Дизайн-ревизия сократила мету с шести фактов до трёх и развела их по
// голосам. Было: система, сеттинг, бейдж статуса, бейдж оплаты, «Игроков: N ·
// Сессий состоялось: N», «Ближайшая сессия: 2026-08-30» — шесть строк одним
// приглушённым голосом, при том что на плитку смотрят полсекунды.
//
// Правило, по которому выбрано, что осталось: сводка отвечает «которая это и
// когда следующая», а не описывает объект. Сеттинг, счётчики и оплата никуда
// не делись — они внутри кампании, куда плитка и ведёт.
export function CampaignCoverTile({ campaign: c }: { campaign: Campaign }) {
  const imageUrl = c.thumbnail_image_url ?? c.background_image_url ?? null;

  return (
    <Link to={`/campaigns/${c.id}`} className="card campaign-tile">
      <div className="campaign-tile-cover cover-halftone">
        {imageUrl ? (
          // Обложка — изображение-ФОН, поэтому проходит дуотон (zine.css).
          // Отдельный слой под картинкой нужен, чтобы grayscale-фильтр не
          // достался подписи поверх неё.
          <div className="cover-art cover-photo">
            <div className="cover-art-image" style={{ backgroundImage: `url("${imageUrl}")` }} />
          </div>
        ) : (
          <div className="cover-art cover-art-fallback zine-grain" />
        )}
        <div className="campaign-tile-scrim" />
        <h3 className="campaign-tile-name">{c.name}</h3>
      </div>
      <div className="campaign-tile-meta">
        <div className="campaign-tile-system">{c.system_name ?? "система не выбрана"}</div>
        <div className="campaign-tile-next">
          {/* Ромб — «история/дальше» из словаря разъёмов референса: тип
              кодируется формой, а не цветом (§1.7). */}
          <span className="campaign-tile-next-mark" aria-hidden="true" />
          <span>
            {c.next_planned_date ? formatNearestDate(c.next_planned_date) : "нет запланированных"}
          </span>
        </div>
      </div>
    </Link>
  );
}
