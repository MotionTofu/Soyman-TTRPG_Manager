import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAfterWrite, useEntity, write } from "../data/hooks";
import { showSaveError } from "../data/notices";
import { StatblockList } from "../components/StatblockList";
import { LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { ConfirmModal } from "../components/ConfirmModal";
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
  useEffect(() => {
    setDossierOpen(false);
    setRelationsOpen(false);
    setArchiveOpen(false);
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

  // «←» — в кампанию персонажа (Q28); библиотека игрока появится шагом 2.
  const back = () => navigate(character.campaign_id ? `/campaigns/${character.campaign_id}` : "/");

  async function archive() {
    if (!character) return;
    setArchiveOpen(false);
    const name = character.character_name || "Без имени";
    try {
      await deleteWithUndo({
        entityName: name,
        deleteFn: async () => {
          await write.del(`/characters/${character.id}`);
          afterWrite([{ kind: "character" }]);
        },
        restoreFn: async () => {
          await write.put(`/characters/${character.id}/restore`);
          afterWrite([{ kind: "character" }]);
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
        // Связи и граф открыты только Мастеру: игроку сервер их не отдаёт.
        onRelations={isGm ? () => setRelationsOpen(true) : undefined}
        sheetMenu={{
          onDossier: () => setDossierOpen(true),
          onRelations: isGm ? () => setRelationsOpen(true) : undefined,
          player:
            isGm && character.player_name
              ? {
                  name: character.player_name,
                  onOpen: () => navigate(`/players/${character.player_id}`),
                }
              : undefined,
          onArchive: isGm ? () => setArchiveOpen(true) : undefined,
        }}
      />
      {dossierOpen && <CharacterDossierModal character={character} onClose={() => setDossierOpen(false)} />}
      {relationsOpen && <CharacterRelationsModal character={character} onClose={() => setRelationsOpen(false)} />}
      {archiveOpen && (
        <ConfirmModal
          title="Архивировать персонажа?"
          message={`Архивировать «${character.character_name}»? Персонаж пропадёт из ростера, но его можно восстановить из Архива.`}
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
