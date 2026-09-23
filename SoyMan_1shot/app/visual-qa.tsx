// Development-only, unsaved visual fixture for dense sheet review.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../client/src/data/queryClient';
import { DndCharacterView } from '../../client/src/components/dnd/DndCharacterForm';
import { DndRuntimeContext } from '../../client/src/components/dnd/DndRuntime';
import { applyTheme, findTheme } from '../../client/src/themes';
import { emptyDndCharacter } from '@shared/dnd/normalize';
import type { DndSpellEntry } from '@shared/dnd/types';
import '../../client/src/index.css';
import '../../client/src/dnd-sheet.css';
import '../../client/src/creature-card.css';
import '../../client/src/rich-text.css';
import '../../client/src/statblock.css';
import '../../client/src/zine.css';
import '../../client/src/fantasy-punk-skin.css';
import './tokens.css';
import './shell.css';
import './components.css';
import './sheet.css';
import './modals.css';

applyTheme(findTheme('noir'));
const spell = (name: string, prepared: 0 | 1 | 2, school = 'Воплощение'): DndSpellEntry =>
  ({ entryId: null, name, prepared, school, castingTiming: 'action' });
const fixture = emptyDndCharacter();
fixture.characterName = 'Лунная странница Астэрия';
fixture.raceName = 'Эльф';
fixture.backgroundName = 'Картограф';
fixture.classes = [{ classId: null, className: 'Чародей', subclassId: null, subclassName: '', level: 5, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: 'Харизма' }];
fixture.abilities = { str: 8, dex: 16, con: 14, int: 12, wis: 13, cha: 18 };
fixture.proficiencyBonus = '+3';
fixture.armorClass = '15';
fixture.hitPointMax = '38';
fixture.hitPointsCurrent = '29';
fixture.speeds.walk = 30;
fixture.inspiration = true;
fixture.spellSlotsManual = true;
fixture.spellSlotLevels = 3;
fixture.spellSlotPips = [4, 3, 2, 0, 0, 0, 0, 0, 0];
fixture.spellSlotsUsed = [1, 1, 0, 0, 0, 0, 0, 0, 0];
fixture.cantrips = [spell('Огненная стрела', 1), spell('Леденящее прикосновение', 1), spell('Метка звезды', 2), spell('Починка', 0), spell('Волшебная рука', 1)];
fixture.spellsByLevel = [
  [spell('Доспехи мага', 1, 'Ограждение'), spell('Лечащее слово', 1), spell('Волшебная стрела', 2), spell('Падение пёрышком', 0), spell('Туманное облако', 1), spell('Щит', 1, 'Ограждение'), spell('Опознание', 0)],
  [spell('Туманный шаг', 1), spell('Зеркальный образ', 1), spell('Паутина', 0), spell('Палящий луч', 1), spell('Невидимость', 0)],
  [spell('Огненный шар', 1), spell('Контрзаклинание', 1), spell('Ускорение', 0)],
  [], [], [], [], [], [],
];

function App() {
  const [value, setValue] = useState(fixture);
  return <DndRuntimeContext.Provider value={{ allowDiceRolls: false, campaignConnected: false, detached: true }}>
    <header className="oneshot-header"><strong>OneShot SoyMan / Visual QA</strong></header>
    <div className="oneshot-sheet"><div className="fp-page-backdrop" aria-hidden="true" /><DndCharacterView value={value} portraitUrl="/mascot/hero-idle.webp" onQuickUpdate={patch => setValue(current => ({ ...current, ...patch }))} /></div>
  </DndRuntimeContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><MemoryRouter><App /></MemoryRouter></QueryClientProvider>);
