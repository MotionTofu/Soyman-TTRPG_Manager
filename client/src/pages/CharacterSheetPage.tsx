import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { StatblockList } from "../components/StatblockList";
import type { Character } from "../types";

/**
 * Чарник на весь экран — свой маршрут `/characters/:id/sheet`.
 *
 * Зачем отдельная страница, а не наложение поверх профиля (как у существ,
 * .sb-fullscreen-mobile): на своём адресе системная кнопка «назад» на
 * телефоне закрывает лист, а не уводит со страницы персонажа, и ссылкой на
 * лист можно поделиться. Решено гриллингом 2026-09-04.
 *
 * На экране только лист: визард, импорт из Long Story Short, корзина и
 * «добавить чарник» остались на профиле — лист заполняют дома и не спеша,
 * там крошки и вкладки помогают, а здесь по нему играют.
 */
export function CharacterSheetPage() {
  const { id } = useParams();
  const characterId = Number(id);
  const navigate = useNavigate();
  const [character, setCharacter] = useState<Character | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<Character>(`/characters/${characterId}`)
      .then((c) => {
        if (alive) setCharacter(c);
      })
      .catch(() => {
        if (alive) setLoadError("Персонаж не найден");
      });
    return () => {
      alive = false;
    };
  }, [characterId]);

  // Подпись URL портрета живёт 60 секунд: протухшую картинку лист прячет сам
  // и зовёт сюда за свежей ссылкой (см. onPortraitRefresh в DndCharacterView).
  function refreshPortrait() {
    api
      .get<Character>(`/characters/${characterId}`)
      .then(setCharacter)
      .catch(() => {});
  }

  // Панели приложения прячутся на время: чарник занимает весь экран, у него
  // снизу свои дела (лента ресурсов, свайп между картами), а нижняя
  // навигация отъедает полосу и ловит краевые свайпы. Класс на body — тот
  // же приём, что у пульта (body.live-hide-dock).
  useEffect(() => {
    document.body.classList.add("sheet-fullscreen");
    return () => document.body.classList.remove("sheet-fullscreen");
  }, []);

  function close() {
    // Именно на вкладку «Чарник» профиля, а не «назад» по истории: на этот
    // адрес приходят и по прямой ссылке, где никакой истории нет.
    navigate(`/characters/${characterId}?tab=statblock`);
  }

  return (
    <div className="sheet-page">
      {loadError ? (
        <p className="error" role="alert">
          {loadError}
        </p>
      ) : (
        <StatblockList
          ownerType="character"
          ownerId={characterId}
          campaignId={character?.campaign_id ?? undefined}
          ownerName={character?.character_name}
          ownerPlayerName={character?.player_name}
          ownerPortraitUrl={character?.avatar_image_url}
          soleOnPage
          sheetOnly
          onSheetBack={close}
          onPortraitRefresh={refreshPortrait}
        />
      )}
    </div>
  );
}
