import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAfterWrite, useEntity, useResource, write } from "../data/hooks";
import { showSaveError } from "../data/notices";
import { StatblockList } from "../components/StatblockList";
import { LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { ConfirmModal } from "../components/ConfirmModal";
import { Modal } from "../components/Modal";
import { CharacterDossier, CharacterDossierModal, CharacterRelationsModal } from "../components/CharacterDossier";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { useCurrentUser } from "../api/currentUser";
import type { Character } from "../types";

/**
 * Персонаж = лист (гриллинг 2026-09-27): страница персонажа сразу открывает
 * его лист на весь экран. Профиль с вкладками ушёл — главы, галерея и даты
 * живут в «Досье» листа (у LitM и без листа — окном из «⋯»), отношения — на
 * обороте карты D&D и в «⋯», имя — из самого листа.
 */
export function CharacterDetailPage() {
  const { id } = useParams();
  const characterId = Number(id);
  const navigate = useNavigate();
  const afterWrite = useAfterWrite();
  const { user } = useCurrentUser();
  const isGm = user?.role !== "player";
  const { deleteWithUndo } = useUndoDelete();

  // Карточка — из кэша слоя данных (docs/adr/0001): правки игроков и других
  // окон обновляет DataLayerSync.
  const characterState = useEntity<Character>("character", characterId);
  const character = characterState.data ?? null;
  // Ошибка перечитывания поверх уже загруженного персонажа страницу не прячет.
  const readError = character ? null : characterState.error;
  const notFound = readError != null && /404|not found|не найден/i.test(readError);

  const [dossierOpen, setDossierOpen] = useState(false);
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  useEffect(() => {
    setDossierOpen(false);
    setRelationsOpen(false);
    setArchiveOpen(false);
    setRequestOpen(false);
  }, [characterId]);

  // Панели приложения прячутся: лист занимает весь экран (тот же приём, что
  // у пульта, body.live-hide-dock).
  useEffect(() => {
    document.body.classList.add("sheet-fullscreen");
    return () => document.body.classList.remove("sheet-fullscreen");
  }, []);

  if (notFound) {
    return (
      <div className="stack" style={{ padding: 24 }}>
        <EmptyState
          kind="error"
          title="Персонаж не найден"
          hint="Возможно, он был архивирован или ссылка устарела."
          action={<Link to="/campaigns">К кампаниям</Link>}
        />
      </div>
    );
  }
  if (readError) {
    return (
      <div className="stack" style={{ padding: 24 }}>
        <LoadErrorCard message={<>Не удалось загрузить персонажа: {readError}</>} onRetry={() => characterState.reload()} />
      </div>
    );
  }
  if (!character) return <p className="muted">Загрузка…</p>;

  // «←» — Мастеру в кампанию персонажа (Q28), игроку — в его библиотеку.
  const back = () => navigate(!isGm ? "/sheets" : character.campaign_id ? `/campaigns/${character.campaign_id}` : "/");
  // Игрок архивирует только персонажа «без кампании» (Q16), Мастер — любого.
  const canArchive = isGm || character.campaign_id == null;
  const affects = [{ kind: "character" as const, id: character.id }, { path: "/player/me" }];

  async function playerAction(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      afterWrite(affects);
    } catch (e) {
      showSaveError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Заявка в кампанию и вывод из архивной — только сам игрок (Q11/Q12).
  const playerActions = isGm
    ? []
    : character.requested_campaign_id
      ? [
          {
            label: `Отозвать заявку в «${character.requested_campaign_name ?? "кампанию"}»`,
            onClick: () =>
              void playerAction("Не удалось отозвать заявку", () => write.del(`/player/characters/${character.id}/campaign-request`)),
          },
        ]
      : character.campaign_id == null
        ? [{ label: "Подать в кампанию…", onClick: () => setRequestOpen(true) }]
        : character.campaign_archived
          ? [
              {
                label: `Вывести из архивной «${character.campaign_name ?? "кампании"}»`,
                onClick: () =>
                  void playerAction("Не удалось вывести из кампании", () => write.post(`/player/characters/${character.id}/leave-campaign`)),
              },
            ]
          : [];

  async function archive() {
    if (!character) return;
    setArchiveOpen(false);
    const name = character.character_name || "Без имени";
    try {
      await deleteWithUndo({
        entityName: name,
        // У игрока — свои маршруты: общий DELETE /characters/:id ему закрыт.
        deleteFn: async () => {
          await (isGm ? write.del(`/characters/${character.id}`) : write.post(`/player/characters/${character.id}/archive`));
          afterWrite([{ kind: "character" }, { path: "/player/me" }]);
        },
        restoreFn: async () => {
          await (isGm ? write.put(`/characters/${character.id}/restore`) : write.post(`/player/characters/${character.id}/unarchive`));
          afterWrite([{ kind: "character" }, { path: "/player/me" }]);
        },
      });
    } catch (e) {
      showSaveError(`Не удалось архивировать «${name}»: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    back();
  }

  return (
    <div className="sheet-page">
      <div className="fp-page-backdrop" aria-hidden="true" />
      <StatblockList
        ownerType="character"
        ownerId={character.id}
        campaignId={character.campaign_id ?? undefined}
        ownerName={character.character_name}
        ownerPlayerName={character.player_name}
        ownerPortraitUrl={character.avatar_image_url}
        soleOnPage
        sheetOnly
        onSheetBack={back}
        onPortraitRefresh={() => characterState.reload()}
        systemCode={character.system_code}
        systemName={character.system_name}
        campaignName={character.campaign_name}
        dossierExtra={<CharacterDossier character={character} />}
        // Игроку — просмотр связей с тем, что он и так видит; граф — только Мастеру.
        onRelations={() => setRelationsOpen(true)}
        sheetMenu={{
          onDossier: () => setDossierOpen(true),
          onRelations: () => setRelationsOpen(true),
          player:
            isGm && character.player_name
              ? {
                  name: character.player_name,
                  onOpen: () => navigate(`/players/${character.player_id}`),
                }
              : undefined,
          actions: playerActions,
          onArchive: canArchive ? () => setArchiveOpen(true) : undefined,
        }}
      />
      {dossierOpen && <CharacterDossierModal character={character} onClose={() => setDossierOpen(false)} />}
      {relationsOpen && <CharacterRelationsModal character={character} readOnly={!isGm} onClose={() => setRelationsOpen(false)} />}
      {requestOpen && (
        <CampaignRequestModal
          onClose={() => setRequestOpen(false)}
          onPick={(campaignId) =>
            void playerAction("Не удалось подать заявку", async () => {
              await write.post(`/player/characters/${character.id}/campaign-request`, { campaign_id: campaignId });
              setRequestOpen(false);
            })
          }
        />
      )}
      {archiveOpen && (
        <ConfirmModal
          title="Архивировать персонажа?"
          message={
            isGm
              ? `Архивировать «${character.character_name}»? Персонаж пропадёт из ростера, но его можно восстановить из Архива.`
              : `Архивировать «${character.character_name}»? Персонаж пропадёт из библиотеки; вернуть можно кнопкой «Отменить» или попросив Мастера.`
          }
          confirmLabel="Архивировать"
          cancelLabel="Отмена"
          danger
          onClose={() => setArchiveOpen(false)}
          onConfirm={archive}
        />
      )}
    </div>
  );
}

/**
 * «Подать в кампанию» (Q11): кампании игрока из ростера, где он не выбыл.
 * Заявку принимает Мастер — до тех пор персонаж остаётся «без кампании».
 */
function CampaignRequestModal({ onClose, onPick }: { onClose: () => void; onPick: (campaignId: number) => void }) {
  const campaigns = useResource<{ id: number; name: string; system_name: string | null }[]>("/player/campaigns");
  return (
    <Modal ariaLabel="Подать в кампанию" onClose={onClose}>
      <h3>Подать в кампанию</h3>
      <p className="muted">Мастер увидит заявку в составе кампании; пока он не примет её, персонаж остаётся «без кампании».</p>
      {campaigns.error && <p className="error">{campaigns.error}</p>}
      {campaigns.data?.length === 0 && <p className="muted">Кампаний, куда можно подать, нет — уточните у своего Мастера.</p>}
      <div className="stack" style={{ gap: 6 }}>
        {(campaigns.data ?? []).map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c.id)} style={{ textAlign: "left" }}>
            {c.name}
            {c.system_name && <span className="muted"> · {c.system_name}</span>}
          </button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </Modal>
  );
}
