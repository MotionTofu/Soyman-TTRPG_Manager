import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { syncMentionLinks } from "../../mentions";
import { CAMPAIGN_PASSPORT_FIELDS } from "../../settingWorld";
import type { CampaignDetail, StoryArc, StoryArcDetail } from "../../types";
import { PaperFieldsCard } from "../PaperFieldsCard";
import { PassportCard } from "../adventure/AdventureDossier";
import { LinkDropZone } from "../LinkDropZone";

// Паспорт на «Обзоре» кампании (спека campaign-paper, Q7/Q8/Q16–Q18; доски
// 41–42). У кампании — свой, ключами листа 1 тетради. У ваншота своего нет:
// это паспорт его приключения живой ссылкой, правка уходит туда же (в копию
// приключения этой кампании — как правка со страницы приключения).

export function CampaignPassport({ campaign }: { campaign: CampaignDetail }) {
  return campaign.type === "oneshot" ? <OneshotPassport campaign={campaign} /> : <OwnPassport campaign={campaign} />;
}

function OwnPassport({ campaign }: { campaign: CampaignDetail }) {
  const run = useAction();
  const passport = campaign.passport ?? {};
  async function save(next: Record<string, string>) {
    const merged = { ...passport, ...next };
    const done = await run(() => write.put(`/campaigns/${campaign.id}/passport`, { passport: merged }).then(() => true), {
      affects: [{ path: campaignPaths.detail(campaign.id) }],
    });
    if (!done) throw new Error("Не сохранилось");
    // Упоминания в паспорте — ссылки кампании, как прежде в «Препродакшене».
    for (const f of CAMPAIGN_PASSPORT_FIELDS) {
      if ((passport[f.key] ?? "") !== (merged[f.key] ?? ""))
        void syncMentionLinks("campaign", campaign.id, passport[f.key] ?? "", merged[f.key] ?? "");
    }
  }
  return (
    <section className="campaign-passport">
      <PaperFieldsCard
        label="Паспорт"
        fields={CAMPAIGN_PASSPORT_FIELDS}
        values={passport}
        rows
        mentionSettingId={campaign.setting_id}
        empty="Паспорт пуст: премиса, обещание, чем заняты герои…"
        onSave={save}
      />
      {/* Ссылки «Крючки» живут с «Препродакшена» — та же связь, что и была. */}
      <LinkDropZone entityType="preproduction" entityId={campaign.id} title="Крючки (персонажи)" />
    </section>
  );
}

function OneshotPassport({ campaign }: { campaign: CampaignDetail }) {
  const arcs = useResource<StoryArc[]>(campaignPaths.adventures(campaign.id)).data;
  const first = arcs?.[0];
  const detailPath = first ? `/story/arcs/${first.id}?campaign_id=${campaign.id}` : null;
  const arc = useResource<StoryArcDetail>(detailPath).data;
  const run = useAction();
  if (!arcs) return <p className="muted">Загрузка…</p>;
  if (!first) {
    return (
      <p className="creature-card__empty">
        Паспорт ваншота — паспорт его приключения. Выберите приключение ваншота в «Приключениях» ниже.
      </p>
    );
  }
  async function save(patch: Record<string, unknown>) {
    const done = await run(
      () => write.put(`/story/arcs/${first!.id}`, { ...patch, campaign_id: campaign.id }).then(() => true),
      { affects: [{ path: "/story" }, { path: "/canvas" }] }
    );
    if (!done) throw new Error("Не сохранилось");
  }
  return (
    <section className="campaign-passport">
      <p className="campaign-passport__source">
        <Link className="paper-more" to={`/adventures/${first.id}?campaign=${campaign.id}`}>
          паспорт приключения «{first.name}» ›
        </Link>
        {arcs.length > 1 && (
          <span className="muted">
            {" "}
            · ещё:{" "}
            {arcs.slice(1).map((a, i) => (
              <span key={a.id}>
                {i > 0 && ", "}
                <Link to={`/adventures/${a.id}?campaign=${campaign.id}`}>{a.name}</Link>
              </span>
            ))}
          </span>
        )}
      </p>
      {arc ? <PassportCard passport={arc.passport ?? {}} onSave={save} /> : <p className="muted">Загрузка…</p>}
    </section>
  );
}
