// Главная OneShot — карты библиотеки (макет «Главная — библиотека», гриллинг
// 2026-09-24). Картинка карты: портрет > подкласс > класс > вид > рубашка.
import { useEffect, useState, type ReactNode } from 'react';
import backEvil from '../../client/src/assets/cards/back-evil.webp';
import { getCatalog, getCatalogPreviews, type Character } from './repository';
import { cardArtIds, cardCaption, draftCaption, displayName, parseWizardDraft, wizardDraftKey, type WizardDraft } from './library.mjs';

interface CatalogMedia { images: Record<string, string>; names: Record<string, string> }

function readDraft(id: number): WizardDraft | null {
  try { return parseWizardDraft(localStorage.getItem(wizardDraftKey(id))); } catch { return null; }
}

// Превью и имена записей справочника — по одному чтению на каталог. Имена
// нужны черновикам (у них только id), картинки — всем без портрета.
export function useCatalogMedia(characters: Character[]) {
  const [media, setMedia] = useState<Record<string, CatalogMedia>>({});
  const keys = [...new Set(characters.filter(c => !c.portrait || !c.content).map(c => c.catalogKey).filter((k): k is string => !!k))].sort().join('\n');
  useEffect(() => {
    let alive = true;
    for (const key of keys ? keys.split('\n') : []) {
      if (media[key]) continue;
      void (async () => {
        const [previews, catalog] = await Promise.all([getCatalogPreviews(key).catch(() => undefined), getCatalog(key).catch(() => undefined)]);
        const images: Record<string, string> = { ...previews?.images };
        const names: Record<string, string> = {};
        for (const e of catalog?.entries ?? []) {
          names[String(e.id)] = e.name;
          if (!images[String(e.id)] && e.avatar_preview_url) images[String(e.id)] = e.avatar_preview_url;
        }
        if (alive) setMedia(m => ({ ...m, [key]: { images, names } }));
      })();
    }
    return () => { alive = false; };
    // media нарочно не в зависимостях: он пополняется этим же эффектом
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  return media;
}

export function LibraryCard({ character: c, media, archived, menuOpen, onMenu, menu }: {
  character: Character;
  media: Record<string, CatalogMedia>;
  archived: boolean;
  menuOpen: boolean;
  onMenu: () => void;
  menu: ReactNode;
}) {
  const draft = c.content ? null : readDraft(c.id);
  const m = c.catalogKey ? media[c.catalogKey] : undefined;
  const art = c.portrait || cardArtIds(c.content, draft).map(id => m?.images[String(id)]).find(Boolean) || backEvil;
  const caption = c.content ? cardCaption(c.content) : draftCaption(draft, id => m?.names[String(id)]);
  const step = typeof draft?.step === 'string' ? draft.step : '';
  const name = displayName(c);
  return <div className={`lib-card${c.content ? '' : ' is-draft'}${archived ? ' is-archived' : ''}`}>
    <a className="lib-card-face" href={`/?character=${c.id}`} aria-label={`${c.content ? 'Открыть лист' : 'Продолжить создание'}: ${name}`}>
      <img src={art} alt="" loading="lazy" />
      {!c.content && <span className="lib-chip">Черновик{step && <><br /><b>{step}</b></>}</span>}
    </a>
    <button type="button" className="lib-dots" aria-label={`Действия: ${name}`} aria-expanded={menuOpen} onClick={onMenu} />
    {menuOpen && <div className="lib-menu" role="menu" aria-label={`Действия: ${name}`}>{menu}</div>}
    <div className="lib-cap"><strong>{name}</strong>{caption && <span>{caption}</span>}</div>
  </div>;
}
