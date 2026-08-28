import { useEffect, useState } from "react";
import { DND_PREFS_EVENT, loadDndPrefs } from "../dndPrefs";

// Настройки D&D-статблока, следящие за переключением во «Внешнем виде».
// Кости характеристик нарисованы одновременно в статблоке, в карточке
// существа и в листе персонажа — переключение «модификатор / значение»
// должно доходить до всех открытых карточек, а не только до тех, что
// перерисуются сами.
export function useDndPrefs() {
  const [prefs, setPrefs] = useState(loadDndPrefs);
  useEffect(() => {
    const onChange = () => setPrefs(loadDndPrefs());
    window.addEventListener(DND_PREFS_EVENT, onChange);
    // storage — это второе окно приложения (у пульта сессии есть отдельное).
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(DND_PREFS_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return prefs;
}
