// Development-only, unsaved visual fixture for dense sheet review.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../client/src/data/queryClient';
import { DndCharacterView } from '../../client/src/components/dnd/DndCharacterForm';
import { DndRuntimeContext } from '../../client/src/components/dnd/DndRuntime';
import { Modal } from '../../client/src/components/Modal';
import { Button } from './ui/Button';
import { ActionRow } from './ui/ActionRow';
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
const portraitUrl = new URLSearchParams(window.location.search).get('portrait') === 'none'
  ? undefined
  : '/mascot/hero-idle.webp';
const arcanumCase = new URLSearchParams(window.location.search).get('case') === 'arcanum';
const modalCase = new URLSearchParams(window.location.search).get('case') === 'modals';
const spell = (name: string, prepared: 0 | 1 | 2, school = 'Воплощение', combat: Partial<DndSpellEntry> = {}): DndSpellEntry =>
  ({ entryId: null, name, prepared, school, castingTiming: 'action', ...combat });
// Боевые строки для вкладки «Действия»: без записей справочника лист берёт
// их по старому признаку category/damage.
const hit = (damage: string, range: string, timing: DndSpellEntry['castingTiming'] = 'action'): Partial<DndSpellEntry> =>
  ({ category: 'Боевое', attackSave: 'Атака', damage, range, castingTiming: timing });
const fixture = emptyDndCharacter();
fixture.characterName = 'Лунная странница Астэрия';
fixture.raceName = 'Эльф';
fixture.backgroundName = 'Картограф';
fixture.classes = [{ classId: null, className: 'Чародей', subclassId: null, subclassName: '', level: 5, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: 'Харизма' }];
if (arcanumCase) fixture.classes = [{ classId: null, className: 'Колдун', subclassId: null, subclassName: '', level: 11, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: 'Харизма' }];
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
fixture.cantrips = [spell('Огненная стрела', 1, 'Воплощение', hit('2к10 огонь', '120 фт')), spell('Леденящее прикосновение', 1, 'Некромантия', hit('2к10 некрот.', 'касание')), spell('Метка звезды', 2), spell('Починка', 0), spell('Волшебная рука', 1)];
fixture.spellsByLevel = [
  [spell('Доспехи мага', 1, 'Ограждение'), spell('Лечащее слово', 1), spell('Волшебная стрела', 2, 'Воплощение', hit('3 × 1к4+1 сил.', '120 фт')), spell('Падение пёрышком', 0), spell('Туманное облако', 1), spell('Щит', 1, 'Ограждение', { category: 'Боевое', damage: '+5 к КЗ', range: 'на себя', castingTiming: 'reaction' }), spell('Опознание', 0)],
  [spell('Туманный шаг', 1), spell('Зеркальный образ', 1), spell('Паутина', 0), spell('Палящий луч', 1), spell('Невидимость', 0)],
  [spell('Огненный шар', 1), spell('Контрзаклинание', 1), spell('Ускорение', 0)],
  [], [], [], [], [], [],
];
// Снаряжение по доске макета: оружие в руке даёт строку «Действий», счёт и
// заряды — кнопку траты.
fixture.equipmentSections = [{
  name: 'Снаряжение',
  items: [
    { id: 'qa-dagger', name: 'Кинжал', qty: '2', weight: '1 фнт', notes: '', equipped: true, weaponDamage: '1к4 колющ.', weaponAttackMelee: true, weaponProperties: 'Лёгкое, метательное' },
    { id: 'qa-wand', name: 'Жезл волшебных стрел', qty: '', weight: '1 фнт', notes: '', equipped: true, chargesMax: '7', chargesLeft: 5 },
    { id: 'qa-potion', name: 'Зелье лечения', qty: '2', weight: '½ фнт', notes: '' },
    { id: 'qa-rations', name: 'Рационы', qty: '5', weight: '2 фнт', notes: '' },
    { id: 'qa-pack', name: 'Набор путешественника', qty: '', weight: '38 фнт', notes: '' },
  ],
}];
fixture.coins = { ...fixture.coins, cp: '14', sp: '32', gp: '54', pp: '1' };
// Особенности по доске макета: группы, уровни у классовых.
const feat = (name: string, level?: number, description = 'Описание особенности.') => ({ name, description, level });
fixture.speciesFeatures = [feat('Тёмное зрение'), feat('Родословная фей'), feat('Транс'), feat('Острые чувства')];
fixture.classFeatures = [
  feat('Колдовство', 1),
  feat('Врождённое чародейство', 1, 'Бонусным действием высвободите магию на 1 минуту: Сл спасброска ваших заклинаний чародея +1, и броски атаки ими совершаются с преимуществом.'),
  feat('Источник магии', 2),
  feat('Метамагия', 2),
  feat('Чародейское восстановление', 5),
];
fixture.feats = [feat('Посвящённый в магию: волшебник')];
fixture.sensesList = [{ name: 'Тёмное зрение', distance: '60' }];
// Состояния карты по доске Sheet-Card-States: ?state=fight|down|stable.
const stateCase = new URLSearchParams(window.location.search).get('state');
if (stateCase === 'fight') Object.assign(fixture, { conditions: ['Отравлен', 'Лежит', 'Испуган'], concentration: 'есть', exhaustion: 2, hitPointsTemp: '5' });
if (stateCase === 'down' || stateCase === 'stable') Object.assign(fixture, { conditions: ['Лежит'], hitPointsCurrent: '0', deathSaveSuccesses: stateCase === 'stable' ? 3 : 2, deathSaveFailures: stateCase === 'stable' ? 0 : 1 });

// Static, unsaved examples of app-owned dialogs. Their actions only close the
// preview: this page never imports, publishes, or resolves sync state.
function ModalFixture() {
  const [open, setOpen] = useState<'import' | 'share' | 'conflict' | null>(null);
  return <>
    <header className="oneshot-header"><strong>OneShot SoyMan / Modal QA</strong></header>
    <main className="oneshot-home" style={{ padding: 16 }}>
      <ActionRow>
        <Button onClick={() => setOpen('import')}>Импорт</Button>
        <Button onClick={() => setOpen('share')}>Публикация</Button>
        <Button onClick={() => setOpen('conflict')}>Конфликт</Button>
      </ActionRow>
    </main>
    {open && <Modal className="oneshot-modal" ariaLabel={{ import: 'Импорт персонажа', share: 'Публикация персонажа для мастера', conflict: 'Конфликты синхронизации' }[open]} onClose={() => setOpen(null)}>
      {open === 'import' && <>
        <h3>Найден существующий персонаж «Лунная странница Астэрия»</h3>
        <p>Файл может содержать более новое игровое состояние.</p>
        <p className="muted">Данные из файла заменят текущее состояние этого персонажа: хиты, ресурсы, заклинания, заметки и остальные данные листа.</p>
        <ActionRow><Button variant="primary" onClick={() => setOpen(null)}>Обновить существующего</Button><Button onClick={() => setOpen(null)}>Создать копию</Button><Button onClick={() => setOpen(null)}>Отмена</Button></ActionRow>
      </>}
      {open === 'share' && <>
        <h3>Поделиться с мастером — «Лунная странница Астэрия»</h3>
        <p className="muted">Ссылка создана.</p>
        <p><a href="#qa-link">https://example.invalid/s/long-character-share-link-for-layout-check</a></p>
        <ActionRow><Button variant="primary" onClick={() => setOpen(null)}>Скопировать ссылку</Button><a role="button" href="#qa-link">Открыть</a><Button onClick={() => setOpen(null)}>Обновить опубликованную версию</Button><Button variant="danger" onClick={() => setOpen(null)}>Отключить ссылку</Button></ActionRow>
        <ActionRow><Button onClick={() => setOpen(null)}>Закрыть</Button></ActionRow>
      </>}
      {open === 'conflict' && <>
        <h3>Конфликты синхронизации</h3>
        <p className="muted">Обе версии персонажа изменились после последней синхронизации.</p>
        <section aria-label="Конфликт: Лунная странница Астэрия"><h2>Персонаж «Лунная странница Астэрия» удалён на другом устройстве, но здесь есть несинхронизированные изменения.</h2><ActionRow><Button variant="primary" onClick={() => setOpen(null)}>Оставить версию этого устройства</Button><Button variant="danger" onClick={() => setOpen(null)}>Удалить и здесь</Button></ActionRow></section>
        <ActionRow><Button onClick={() => setOpen(null)}>Отмена</Button></ActionRow>
      </>}
    </Modal>}
  </>;
}

function App() {
  const [value, setValue] = useState(fixture);
  if (modalCase) return <ModalFixture />;
  return <DndRuntimeContext.Provider value={{ allowDiceRolls: false, campaignConnected: false, detached: true }}>
    <header className="oneshot-header"><strong>OneShot SoyMan / Visual QA</strong></header>
    <div className="oneshot-sheet"><div className="fp-page-backdrop" aria-hidden="true" /><DndCharacterView value={value} portraitUrl={portraitUrl} onQuickUpdate={patch => setValue(current => ({ ...current, ...patch }))} /></div>
  </DndRuntimeContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><MemoryRouter><App /></MemoryRouter></QueryClientProvider>);
