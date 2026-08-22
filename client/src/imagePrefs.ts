// Дуотон на декоративных изображениях (дизайн-ревизия, см. design_revision.md §3).
//
// Обложки кампаний и фон главной проходят обработку в два полюса —
// --ink → --paper текущего режима, — чтобы пять разных по стилистике артов
// читались как один экран. Правило области жёсткое: обработка ложится на
// изображение-ФОН и никогда на изображение-СОДЕРЖИМОЕ. Карты локаций,
// портреты, галерея и лайтбокс остаются как загружены — дуотоновая карта
// это сломанная карта.
//
// Тумблер сквозной (как loadRadiusOverride/loadHideFinance), а не свойство
// режима: «не перекрашивай мои арты» — убеждение про свои картинки, оно не
// должно меняться от смены темы. Гасит ТОЛЬКО дуотон: зерно, растр и наклоны
// интерфейса это отделка, а не чужие изображения, и остаются.
const KEY = "rpgManagerCoverDuotone";
const CHANGE_EVENT = "cover-duotone-changed";

export function loadCoverDuotone(): boolean {
  try {
    // По умолчанию включён: единство экрана — это то, ради чего он заведён.
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveCoverDuotone(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "0");
  } catch {
    /* ignore */
  }
  applyCoverDuotone();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// Пишет флаг на <html>, а не пробрасывает пропсом через дерево: обработку
// применяет CSS (.cover-duotone), и переключение должно доходить до каждой
// обложки в приложении одним движением, включая уже отрисованные.
export function applyCoverDuotone(): void {
  document.documentElement.toggleAttribute("data-cover-duotone", loadCoverDuotone());
}

export { CHANGE_EVENT as COVER_DUOTONE_EVENT };
