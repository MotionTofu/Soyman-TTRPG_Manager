import { useQueries } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { deriveSheet } from "@shared/dnd/derive";
import { normalizeDndCharacter } from "@shared/dnd/normalize";
import { resourceQuery } from "../../data/hooks";
import { statblockListPath } from "../../data/statblocks";
import { isSafeImageUrl } from "../../utils/safeUrl";
import type { CampaignDebt, Character, RosterPlayer } from "../../types";
import { liveEffectEntryIds, withLiveEffects } from "../dnd/dndFeatures";
import { useCompendiumEntries } from "../dnd/useCompendiumEntries";
import { ContextMenu } from "../ContextMenu";
import "./campaign-dossier.css";

interface Props {
  roster: RosterPlayer[];
  characters: Character[];
  debts: CampaignDebt[];
  currency: string;
  hideFinance: boolean;
  addingFor: number | null;
  drafts: Record<number, string>;
  onDraft: (playerId: number, name: string) => void;
  onStartAdding: (playerId: number) => void;
  onCancelAdding: () => void;
  onAddCharacter: (playerId: number) => void;
  onPeek: (characterId: number) => void;
  onArchive: (characterId: number, name: string) => void;
  onToggleLeft: (playerId: number, status: string) => void;
  onRemovePlayer: (playerId: number) => void;
}

export function CampaignDossierFiles(props: Props) {
  const { roster, characters, debts, currency, hideFinance, addingFor, drafts } = props;
  const [menu, setMenu] = useState<{ playerId: number; x: number; y: number } | null>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuPlayer = menu ? roster.find((p) => p.id === menu.playerId) : undefined;
  const closeMenu = useCallback(() => {
    if (menuRoot.current?.contains(document.activeElement)) menuTrigger.current?.focus({ preventScroll: true });
    setMenu(null);
  }, []);
  useLayoutEffect(() => {
    if (!menu || !menuPlayer) return;
    menuRoot.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node) || !menuRoot.current?.contains(e.target)) closeMenu();
    };
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [menu, menuPlayer, closeMenu]);
  // Keep the sheet's query keys and live compendium effects: updates in another
  // window must change the numbers here without saving the character again.
  const statblocks = useQueries({
    queries: characters.map((c) => resourceQuery<{ content: string; format: string }[]>(statblockListPath("character", c.id))),
  });
  const parsed = statblocks.map((q) => {
    const dnd = q.data?.find((s) => s.format === "dnd_character");
    try { return dnd ? normalizeDndCharacter(JSON.parse(dnd.content || "{}")) : null; }
    catch { return null; }
  });
  const getEntry = useCompendiumEntries(parsed.flatMap((d) => d ? liveEffectEntryIds(d) : []));
  const stats = new Map(characters.map((c, i) => {
    const q = statblocks[i];
    let values: (string | number)[] = ["—", "—", "—", "—"];
    try {
      if (parsed[i]) {
        const sheet = deriveSheet(withLiveEffects(parsed[i]!, getEntry));
        values = [sheet.level.value || "—", sheet.armorClass.value, sheet.maxHitPoints.value || "—", sheet.walkSpeed.value || "—"];
      }
    } catch { /* An unreadable sheet must not hide the player or their actions. */ }
    return [c.id, { values, loading: q.isPending, error: q.isError, retry: () => void q.refetch() }] as const;
  }));

  return <><ul className="dossier-files">
    {roster.map((p, index) => {
      const playerCharacters = characters.filter((c) => c.player_id === p.id);
      const isLeft = p.roster_status === "left";
      const debt = debts.find((d) => d.player_id === p.id);
      return <li className={`dossier-file${isLeft ? " is-left" : ""}`} key={p.id}>
        <header className="dossier-file__header">
          <span className="dossier-file__number">Дело / {String(index + 1).padStart(2, "0")}</span>
          <Link className="dossier-file__player" to={`/players/${p.id}`}>{p.name}</Link>
        </header>
        {debt && !hideFinance && <p className="dossier-file__debt">
          Долг {debt.owed} {currency} · {debt.sessions} {debt.sessions === 1 ? "игра" : debt.sessions < 5 ? "игры" : "игр"}
        </p>}
        <ul className="dossier-file__characters">
          {playerCharacters.map((c) => {
            const img = c.thumbnail_image_url ?? c.avatar_image_url;
            const info = stats.get(c.id)!;
            return <li className="dossier-character" key={c.id}>
              <Link className="dossier-photo" to={`/characters/${c.id}`} aria-label={`Лист персонажа ${c.character_name}`} title={c.character_name}>
                {img && isSafeImageUrl(img)
                  ? <img className="dossier-photo__image" src={img} alt="" loading="lazy" />
                  : <span className="dossier-photo__placeholder" aria-hidden="true">{c.character_name.slice(0, 1)}</span>}
                <span className="dossier-photo__frame" aria-hidden="true" />
                <span className="dossier-photo__signature">{c.character_name}</span>
              </Link>
              <div className="dossier-character__info">
                <p className="dossier-character__status">{isLeft ? "Игрок покинул состав" : "В составе"}</p>
                <dl className="dossier-stats" aria-label={`Характеристики ${c.character_name}`} aria-busy={info.loading}>
                  {["Ур.", "КЗ", "Хиты", "Скорость"].map((label, i) => <div key={label}>
                    <dt>{label}</dt><dd>{info.loading ? "…" : info.values[i]}</dd>
                  </div>)}
                </dl>
                {info.error && <button type="button" className="dossier-text-action" onClick={info.retry}>Повторить загрузку</button>}
                <button type="button" className="dossier-view" onClick={() => props.onPeek(c.id)} aria-label={`Быстрый просмотр ${c.character_name}`}>Просмотр</button>
              </div>
            </li>;
          })}
        </ul>
        {!playerCharacters.length && <p className="dossier-file__empty">{isLeft ? "Игрок покинул состав · персонажей пока нет" : "Персонажей пока нет"}</p>}
        {addingFor === p.id && <form className="dossier-create" onSubmit={(e) => { e.preventDefault(); props.onAddCharacter(p.id); }}>
          <label htmlFor={`dossier-name-${p.id}`}>Имя персонажа</label>
          <input id={`dossier-name-${p.id}`} autoFocus value={drafts[p.id] ?? ""}
            onChange={(e) => props.onDraft(p.id, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); props.onCancelAdding(); } }} />
          <div className="dossier-create__actions">
            <button type="submit" className="dossier-text-action" disabled={!(drafts[p.id] ?? "").trim()}>Добавить</button>
            <button type="button" className="dossier-text-action" onClick={props.onCancelAdding}>Отмена</button>
          </div>
        </form>}
        <footer className="dossier-file__footer">
          <button type="button" className="dossier-text-action" onClick={() => props.onStartAdding(p.id)} aria-label={`Добавить персонажа игроку ${p.name}`}>+ Персонаж</button>
          <button type="button" className="dossier-text-action dossier-actions-trigger"
            aria-label={`Действия с делом ${p.name}`} aria-haspopup="menu" aria-expanded={menu?.playerId === p.id}
            aria-controls={menu?.playerId === p.id ? `dossier-actions-${p.id}` : undefined}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              if (menu?.playerId === p.id) { closeMenu(); return; }
              menuTrigger.current = e.currentTarget;
              const at = e.currentTarget.getBoundingClientRect();
              setMenu({ playerId: p.id, x: at.left, y: at.bottom });
            }}><span aria-hidden="true">▸ </span>Действия</button>
        </footer>
      </li>;
    })}
  </ul>
  {menu && menuPlayer && createPortal(<div className="dossier-action-menu paper-scope" id={`dossier-actions-${menu.playerId}`} ref={menuRoot}
    onKeyDown={(e) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const buttons = [...(menuRoot.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      if (!buttons.length) return;
      e.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    }}>
    <ContextMenu x={menu.x} y={menu.y} title={menuPlayer.name} ariaLabel={`Действия с делом ${menuPlayer.name}`} onClose={closeMenu}
      items={[
        { label: menuPlayer.roster_status === 'left' ? 'Вернуть в состав' : 'Игрок покинул кампанию', onClick: () => props.onToggleLeft(menuPlayer.id, menuPlayer.roster_status) },
        { label: 'Убрать игрока из состава', danger: true, onClick: () => props.onRemovePlayer(menuPlayer.id) },
        ...characters.filter((c) => c.player_id === menuPlayer.id).map((c) => ({ label: `В архив: ${c.character_name}`, danger: true, onClick: () => props.onArchive(c.id, c.character_name) })),
      ]} />
  </div>, document.body)}
  </>;
}
