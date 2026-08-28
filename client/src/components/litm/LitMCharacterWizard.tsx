import { useEffect, useState } from "react";
import {
  findLitmSystemId,
  loadLitmTropes,
  loadLitmThemeBooks,
  loadLitmThemeKits,
  type LitmTrope,
  type LitmThemeBook,
  type LitmThemeKit,
} from "./litmCompendium";
import type { LitMCharacterData, LitMThemeCard, LitMPower } from "../../types";

type WizardPath = "manual" | "trope" | "themebook";

const MIGHT_RU: Record<string, string> = {
  origin: "Происхождение",
  adventure: "Приключение",
  greatness: "Величие",
  variable: "Переменное",
};

function emptyTheme(): LitMThemeCard {
  return { power: "", themeType: "", name: "", powerTags: [], weaknessTags: [], quest: "", improve: 0, abandon: 0, milestone: 0, specialImprovements: [] };
}

/** Чип темы: название кита → тип тембука → могущество, фон = цвет Могущества. */
function ThemeChip({ kit, themebookEn, kits, books }: { 
  kit?: LitmThemeKit; 
  themebookEn: string; 
  kits: LitmThemeKit[]; 
  books: LitmThemeBook[] 
}) {
  const themebookKits = kits.filter(k => k.themebookEn === themebookEn);
  const displayKit = kit ?? themebookKits[0];
  const book = books.find(b => b.enName === themebookEn);
  const might = book?.data.might ?? "";
  const ruName = displayKit?.name.split(" [")[0] ?? book?.ruName ?? themebookEn;
  const typeRu = book?.ruName ?? themebookEn;
  
  return (
    <span
      className={`litm-power-${might}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        padding: "4px 8px",
        border: "1.5px solid var(--ink)",
        minWidth: 0,
      }}
    >
      <span style={{ fontWeight: "bold", fontSize: 13, lineHeight: 1.2 }}>
        {ruName}
      </span>
      <span style={{ fontSize: 11, color: "var(--ink-soft, #5c4a38)", lineHeight: 1.2 }}>
        {typeRu}
      </span>
      <span style={{ fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", opacity: .7, lineHeight: 1.3 }}>
        {MIGHT_RU[might] ?? ""}
      </span>
    </span>
  );
}

export function LitMCharacterWizard({
  ownerName,
  ownerPlayerName,
  onComplete,
  onCancel,
}: {
  ownerName?: string;
  ownerPlayerName?: string;
  onComplete: (data: Partial<LitMCharacterData>) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [heroName, setHeroName] = useState(ownerName ?? "");
  const [playerName, setPlayerName] = useState(ownerPlayerName ?? "");
  const [path, setPath] = useState<WizardPath | null>(null);
  const [, setSystemId] = useState<number | null>(null);
  const [tropes, setTropes] = useState<LitmTrope[]>([]);
  const [books, setBooks] = useState<LitmThemeBook[]>([]);
  const [kits, setKits] = useState<LitmThemeKit[]>([]);
  const [selectedTrope, setSelectedTrope] = useState<LitmTrope | null>(null);
  const [chooseIdx, setChooseIdx] = useState<number | null>(null);
  const [groupFilter, setGroupFilter] = useState("");
  const [tbStep, setTbStep] = useState(0);
  const [tbTypes, setTbTypes] = useState<(string | null)[]>([null, null, null, null]);
  const [tbPowerTags, setTbPowerTags] = useState<string[][]>([[], [], [], []]);
  const [tbWeakTags, setTbWeakTags] = useState<string[][]>([[], [], [], []]);
  const [tbQuests, setTbQuests] = useState<string[]>(["", "", "", ""]);
  const [backpackTag] = useState("");

  useEffect(() => {
    findLitmSystemId().then((id) => {
      if (!id) return;
      setSystemId(id);
      loadLitmTropes(id).then(setTropes);
      loadLitmThemeBooks(id).then(setBooks);
      loadLitmThemeKits(id).then(setKits);
    });
  }, []);

  function assembleFromTrope(): LitMCharacterData["themes"] {
    if (!selectedTrope || chooseIdx === null) return [emptyTheme(), emptyTheme(), emptyTheme(), emptyTheme()];
    
    // Build map: themebookEn -> first kit (for auto-pick)
    const kitsByThemebook = new Map<string, LitmThemeKit[]>();
    for (const kit of kits) {
      const arr = kitsByThemebook.get(kit.themebookEn) ?? [];
      arr.push(kit);
      kitsByThemebook.set(kit.themebookEn, arr);
    }
    
    const allTypes = [...selectedTrope.data.themes_fixed, selectedTrope.data.themes_choose_one[chooseIdx]];
    return allTypes.map((themebookEn) => {
      const themebookKits = kitsByThemebook.get(themebookEn) ?? [];
      const kit = themebookKits[0]; // auto-pick first kit
      const book = books.find(b => b.enName === themebookEn);
      const might = book?.data.might ?? "";
      return {
        ...emptyTheme(),
        themeType: themebookEn,
        power: might as LitMPower,
        name: kit ? `${kit.name.split(" [")[0]} [${themebookEn}]` : themebookEn,
        powerTags: kit?.data.powerTags ?? [],
        weaknessTags: kit?.data.weaknessTags ?? [],
        quest: kit?.data.quest ?? "",
        specialImprovements: (book?.data.improvements ?? []).map(i => ({ text: `${i.name} — ${i.text}`, active: false })),
      };
    });
  }

  function assembleFromThemebook(): LitMCharacterData["themes"] {
    return tbTypes.map((en, i) => {
      const book = books.find(b => b.enName === en);
      return {
        ...emptyTheme(),
        themeType: en ?? "",
        power: (book?.data.might ?? "") as LitMPower,
        name: book ? `${book.ruName} [${en}]` : "",
        powerTags: tbPowerTags[i] ?? [],
        weaknessTags: tbWeakTags[i] ?? [],
        quest: tbQuests[i] ?? "",
        specialImprovements: (book?.data.improvements ?? []).map(imp => ({ text: `${imp.name} — ${imp.text}`, active: false })),
      };
    });
  }

  function finish() {
    let themes: LitMCharacterData["themes"] | undefined;
    if (path === "trope" && selectedTrope && chooseIdx !== null) themes = assembleFromTrope();
    if (path === "themebook") themes = assembleFromThemebook();
    onComplete({
      characterName: heroName,
      playerName: playerName,
      backpack: backpackTag ? [backpackTag] : [],
      ...(themes ? { themes } : {}),
    });
  }

  // --- Шаг 0: имя ---
  if (step === 0) {
    return (
      <div className="stack" style={{ maxWidth: 420, margin: "0 auto" }}>
        <h2 style={{ textAlign: "center" }}>Новый герой</h2>
        <label>Имя героя<input value={heroName} onChange={e => setHeroName(e.target.value)} /></label>
        <label>Имя игрока<input value={playerName} onChange={e => setPlayerName(e.target.value)} /></label>
        <button className="primary" disabled={!heroName.trim()} onClick={() => setStep(1)}>Дальше</button>
        <button onClick={onCancel}>Отмена</button>
      </div>
    );
  }

  // --- Шаг 1: выбор пути ---
  if (step === 1) {
    return (
      <div className="stack" style={{ maxWidth: 560, margin: "0 auto" }}>
        <h2 style={{ textAlign: "center" }}>Выберите путь</h2>
        <div className="stack" style={{ gap: 10 }}>
          <button className="card stack" onClick={() => { setPath("manual"); finish(); }} style={{ textAlign: "left", padding: 16 }}>
            <strong>📝 Просто запишите</strong>
            <span className="muted">Четыре темы вручную — полный контроль</span>
          </button>
          <button className="card stack" disabled={tropes.length === 0} onClick={() => { setPath("trope"); setStep(2); }} style={{ textAlign: "left", padding: 16 }}>
            <strong>⚡ Выберите троп</strong>
            <span className="muted">Три темы зальются автоматически, четвёртую выберете из списка</span>
          </button>
          <button className="card stack" disabled={books.length === 0} onClick={() => { setPath("themebook"); setTbStep(0); setStep(3); }} style={{ textAlign: "left", padding: 16 }}>
            <strong>📖 Ответьте на темник</strong>
            <span className="muted">Для каждой из 4 тем: выберите тип и ответьте на вопросы</span>
          </button>
        </div>
        <button onClick={() => setStep(0)}>Назад</button>
      </div>
    );
  }

  // --- Шаг 2: троп-пикер ---
  if (step === 2 && path === "trope") {
    const groups = [...new Set(tropes.map(t => t.data.group))];
    const filtered = groupFilter ? tropes.filter(t => t.data.group === groupFilter) : tropes;

    return (
      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        <h2 style={{ marginBottom: 12 }}>Выберите троп</h2>

        {/* Фильтр по группам */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
          <button
            style={{
              fontFamily: "var(--font-ui)", fontSize: 10, letterSpacing: ".12em",
              textTransform: "uppercase", padding: "4px 10px", cursor: "pointer",
              background: groupFilter === "" ? "var(--ink)" : "transparent",
              color: groupFilter === "" ? "var(--paper)" : "var(--ink)",
              border: "1.5px solid var(--ink)", borderRadius: 0,
            }}
            onClick={() => setGroupFilter("")}
          >Все</button>
          {groups.map(g => (
            <button
              key={g}
              style={{
                fontFamily: "var(--font-ui)", fontSize: 10, letterSpacing: ".12em",
                textTransform: "uppercase", padding: "4px 10px", cursor: "pointer",
                background: groupFilter === g ? "var(--ink)" : "transparent",
                color: groupFilter === g ? "var(--paper)" : "var(--ink)",
                border: "1.5px solid var(--ink)", borderRadius: 0,
              }}
              onClick={() => setGroupFilter(g)}
            >{g}</button>
          ))}
        </div>

        {/* Карточки тропов */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {filtered.map(t => {
            const isSelected = selectedTrope?.id === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { setSelectedTrope(t); setChooseIdx(null); }}
                style={{
                  textAlign: "left", cursor: "pointer",
                  border: isSelected ? "3px solid var(--accent, #D6321E)" : "2px solid var(--ink)",
                  background: "var(--paper, #f2e9d3)",
                  padding: 0, overflow: "hidden", borderRadius: 0,
                  fontFamily: "inherit", color: "inherit",
                }}
              >
                {/* Шапка-плашка */}
                <div style={{
                  background: "var(--ink)", color: "var(--paper)",
                  fontFamily: "var(--font-ui)", fontSize: 10,
                  letterSpacing: ".14em", textTransform: "uppercase",
                  padding: "5px 10px", lineHeight: 1.3,
                }}>
                  {t.data.group}
                </div>
                {/* Имя тропa */}
                <div style={{
                  fontFamily: "var(--font-display)", fontSize: 17,
                  textTransform: "uppercase", letterSpacing: ".03em",
                  lineHeight: 1.15, padding: "10px 12px 6px",
                }}>
                  {t.name.split(" [")[0]}
                </div>
                {/* Темы */}
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 4,
                  padding: "0 12px 12px", alignItems: "stretch",
                }}>
                  {t.data.themes_fixed.map((themebookEn) => (
                    <ThemeChip key={themebookEn} themebookEn={themebookEn} kits={kits} books={books} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {/* Выбор четвёртой темы */}
        {selectedTrope && (
          <div style={{ marginTop: 20, border: "2px solid var(--ink)", padding: 16 }}>
            <div style={{
              fontFamily: "var(--font-ui)", fontSize: 10, letterSpacing: ".14em",
              textTransform: "uppercase", marginBottom: 10,
            }}>
              Четвёртая тема — на выбор
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {selectedTrope.data.themes_choose_one.map((themebookEn, i) => (
                <button
                  key={i}
                  onClick={() => setChooseIdx(i)}
                  style={{
                    cursor: "pointer", fontFamily: "inherit", color: "inherit",
                    border: chooseIdx === i ? "3px solid var(--accent, #D6321E)" : "1.5px solid var(--ink)",
                    background: "transparent", padding: "6px 12px", borderRadius: 0,
                  }}
                >
                  <ThemeChip themebookEn={themebookEn} kits={kits} books={books} />
                </button>
              ))}
            </div>
            <div style={{
              fontFamily: "var(--font-ui)", fontSize: 10, letterSpacing: ".14em",
              textTransform: "uppercase", margin: "14px 0 6px",
            }}>
              Рюкзак — одно на выбор
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {selectedTrope.data.backpack.map((b, i) => (
                <span key={i} style={{
                  fontFamily: "var(--font-mono)", fontSize: 11,
                  border: "1px solid var(--ink)", padding: "2px 6px",
                }}>{b}</span>
              ))}
            </div>
            <button
              className="primary"
              disabled={chooseIdx === null}
              onClick={finish}
              style={{ marginTop: 14, width: "100%" }}
            >
              Создать героя
            </button>
          </div>
        )}

        <button onClick={() => setStep(1)} style={{ marginTop: 14 }}>← Назад к путям</button>
      </div>
    );
  }

  // --- Шаг 3: темник ---
  if (step === 3 && path === "themebook") {
    const themeIdx = tbStep;
    const currentType = tbTypes[themeIdx];
    const currentBook = books.find(b => b.enName === currentType);
    const isLast = themeIdx >= 3;

    return (
      <div className="stack" style={{ maxWidth: 640, margin: "0 auto" }}>
        <h2>Тема {themeIdx + 1} из 4</h2>
        {!currentType && (
          <div className="stack">
            <h3>Выберите тип темы:</h3>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {books.map(b => (
                <button key={b.id} className="card" style={{ padding: "6px 12px", cursor: "pointer" }}
                  onClick={() => {
                    const next = [...tbTypes]; next[themeIdx] = b.enName; setTbTypes(next);
                    setTbPowerTags(prev => { const n = [...prev]; n[themeIdx] = []; return n; });
                    setTbWeakTags(prev => { const n = [...prev]; n[themeIdx] = []; return n; });
                  }}>
                  <span className={`litm-power-${b.data.might}`} style={{ padding: "2px 8px", display: "inline-block" }}>
                    {b.ruName}
                  </span>
                  <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>{MIGHT_RU[b.data.might] ?? ""}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {currentType && currentBook && (
          <div className="stack">
            <h3>{currentBook.ruName} <span className="muted">[{currentBook.enName}]</span></h3>
            <p className="muted" style={{ fontSize: 13 }}>
              Ответьте минимум на 3 вопроса (включая первый) — каждый ответ станет тегом.
              Затем ответьте на один вопрос слабости.
            </p>
            <div className="litm-section-label">Вопросы силовых тегов (минимум 3)</div>
            {currentBook.data.powerQuestions.map((q, qi) => (
              <div key={qi}>
                <label style={{ fontSize: 14 }}>
                  <strong>{String.fromCharCode(65 + qi)}.</strong> {q}
                  <input
                    value={tbPowerTags[themeIdx]?.[qi] ?? ""}
                    onChange={e => {
                      const next = [...tbPowerTags];
                      if (!next[themeIdx]) next[themeIdx] = [];
                      next[themeIdx][qi] = e.target.value;
                      setTbPowerTags(next);
                    }}
                    placeholder="Ответ → тег"
                  />
                </label>
              </div>
            ))}
            <div className="litm-section-label">Слабость (одна)</div>
            {currentBook.data.weaknessQuestions.map((q, qi) => (
              <div key={qi}>
                <label style={{ fontSize: 14 }}>
                  <strong>{String.fromCharCode(65 + qi)}.</strong> {q}
                  <input
                    value={tbWeakTags[themeIdx]?.[qi] ?? ""}
                    onChange={e => {
                      const next = [...tbWeakTags];
                      if (!next[themeIdx]) next[themeIdx] = [];
                      next[themeIdx][qi] = e.target.value;
                      setTbWeakTags(next);
                    }}
                    placeholder="Ответ → тег слабости"
                  />
                </label>
              </div>
            ))}
            <label style={{ fontSize: 14 }}>
              <strong>Квест темы:</strong>
              <input
                value={tbQuests[themeIdx] ?? ""}
                onChange={e => {
                  const next = [...tbQuests]; next[themeIdx] = e.target.value; setTbQuests(next);
                }}
                placeholder="Цель или вера этой грани героя"
              />
            </label>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button onClick={() => {
                if (themeIdx > 0) { setTbStep(themeIdx - 1); }
                else setStep(1);
              }}>Назад</button>
              <button className="primary" onClick={() => {
                if (isLast) { finish(); }
                else { setTbStep(themeIdx + 1); }
              }}>
                {isLast ? "Создать героя" : "Следующая тема →"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return <p className="muted">Загрузка…</p>;
}
