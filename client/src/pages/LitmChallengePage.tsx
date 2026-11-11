import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EntityPage } from "../components/EntityPage";
import { EntryImagesTab } from "../components/EntryImagesTab";
import { MentionsTab } from "../components/MentionsTab";
import { LitmChallengeEditor } from "../components/litm/LitmChallengeEditor";
import { LitmChallengeProfile } from "../components/litm/LitmChallengeProfile";
import { Rating, Roles } from "../components/litm/LitmBook";
import { challengeProfile, structuredFromLegacy } from "../components/litm/litmChallenge";
import { cleanProfile, litmChallengeAffects, saveLitmChallenge } from "../components/litm/litmChallengeSave";
import { compendiumPaths } from "../data/compendiumEntries";
import { useAction, useResource } from "../data/hooks";
import { statblockListPath } from "../data/statblocks";
import { useTabState } from "../hooks/useTabState";
import type { CompendiumEntry, Statblock, System, SystemSection } from "../types";
import "../components/litm/litm-book.css";

// «Досье» первым — словарь вкладок карточек (check-entity-page); внутри — профиль книги.
const TABS = ["Досье", "Галерея", "Упоминания"] as const;
const NO_STATBLOCKS: Statblock[] = [];

/** Вызов Legend in the Mist — своя страница, не страница существа D&D
 *  (решение 2026-11-06, Q2): у вызова нет КЗ, хитов и карточки «За столом»;
 *  в «Досье» — профиль книги и его правка, дальше галерея и упоминания. */
export function LitmChallengePage({ entry, system }: { entry: CompendiumEntry; system: System | null }) {
  const [tab, selectTab] = useTabState(TABS, "Досье", { Профиль: "Досье", Статблоки: "Досье", Изображения: "Галерея" });
  const [params, setParams] = useSearchParams();
  const sections = useResource<SystemSection[]>(system ? compendiumPaths.sections(system.id) : null).data;
  const sectionName = sections?.find((s) => s.id === entry.section_id)?.name ?? "";
  const statblocksState = useResource<Statblock[]>(statblockListPath("compendium_entry", entry.id));
  const statblocks = statblocksState.data ?? NO_STATBLOCKS;
  const statblock = statblocks.find((s) => s.format === "litm_challenge");
  const profile = challengeProfile(entry, statblock);
  const editing = params.get("edit") === "1";
  const setEditing = (on: boolean) => setParams((p) => { if (on) p.set("edit", "1"); else p.delete("edit"); return p; }, { replace: true });
  const [busy, setBusy] = useState(false);
  const run = useAction();

  async function save(draft: typeof profile) {
    setBusy(true);
    const ok = await run(() => saveLitmChallenge(entry, statblock, cleanProfile(draft)).then(() => true), { affects: litmChallengeAffects(entry) });
    setBusy(false);
    if (ok) setEditing(false);
  }

  return (
    <EntityPage
      crumbs={[
        { label: "Системы", to: "/systems" },
        ...(system ? [{ label: system.name, to: `/systems/${system.id}` }] : []),
        ...(sectionName && system ? [{ label: sectionName, to: `/systems/${system.id}?section=${entry.section_id}` }] : []),
        { label: entry.name },
      ]}
      entityType="compendium_entry"
      title={entry.name}
      paper
      meta={
        <span className="paper-ident-tags">
          <span className="badge tag">Вызов</span>
          {profile.location && <span className="badge tag">{profile.location}</span>}
        </span>
      }
      tabs={TABS}
      tab={tab}
      onTab={(t) => selectTab(t as (typeof TABS)[number])}
    >
      {tab === "Досье" && (
        <div className="dossier">
          <aside className="dossier__aside">
            <button type="button" className="dossier__portrait" title="Сменить портрет — в «Галерее»" onClick={() => selectTab("Галерея")}>
              {entry.avatar_image_url ? <img src={entry.avatar_image_url} alt={`Портрет: ${entry.name}`} /> : <span className="dossier__portrait-empty">Портрет</span>}
              <span className="dossier__portrait-hint">Сменить в «Галерее»</span>
            </button>
            <dl className="paper-facts">
              {system && <div><dt className="paper-label">Система</dt><dd>{system.name}{sectionName ? ` · ${sectionName}` : ""}</dd></div>}
              {profile.roles.length > 0 && <div><dt className="paper-label">Роли</dt><dd>{profile.roles.join(" · ")}</dd></div>}
              {profile.rating > 0 && <div><dt className="paper-label">Рейтинг</dt><dd>{profile.rating} из 5</dd></div>}
              {entry.name_original && <div><dt className="paper-label">По-другому</dt><dd>{[entry.name_original, ...(entry.aliases ?? [])].join(" · ")}</dd></div>}
              {profile.page && <div><dt className="paper-label">Книга</dt><dd>том II · с. {profile.page}</dd></div>}
            </dl>
          </aside>
          <div className="dossier__main">
            <section className="litm-book litm-book--page" aria-label={`Вызов: ${entry.name}`}>
              {editing && !statblocksState.data ? (
                // Форма запоминает профиль при открытии — ждём статблок, иначе откроется пустой.
                <p className="lb-empty">Загрузка профиля…</p>
              ) : editing ? (
                <LitmChallengeEditor key={statblock?.id ?? "new"} initial={structuredFromLegacy(profile)} busy={busy} onSave={save} onCancel={() => setEditing(false)} />
              ) : (
                <>
                  <div className="lb-file">
                    <span className="lb-kind">Профиль вызова</span>
                    {profile.location && <span>{profile.location}</span>}
                    {profile.roles.length > 0 && <Roles roles={profile.roles} />}
                    {profile.rating > 0 && <span>рейтинг <Rating value={profile.rating} /></span>}
                    <span className="lb-file__end"><button type="button" className="d-btn d-btn--sm" onClick={() => setEditing(true)}>Править</button></span>
                  </div>
                  <LitmChallengeProfile profile={profile} />
                  {profile.legacy && <p className="lb-ed__hint">Свой вызов в прежнем текстовом виде. «Править» разложит его по спискам книги — проверьте угрозы и теги перед сохранением.</p>}
                  {profile.page && <div className="lb-src">Legend in the Mist · том II · с. {profile.page}</div>}
                </>
              )}
            </section>
          </div>
        </div>
      )}
      {tab === "Галерея" && (
        <EntryImagesTab entryId={entry.id} entryName={entry.name} entryKind={entry.kind} avatarUrl={entry.avatar_image_url ?? null} />
      )}
      {tab === "Упоминания" && <MentionsTab entityType="compendium_entry" entityId={entry.id} />}
    </EntityPage>
  );
}
