// Приёмка вида «Д» в браузере: матрица тема × ширина × страница.
//
// Как пользоваться: открыть приложение (стенд на копии базы, вход Мастером),
// вставить этот файл в консоль (или javascript_tool) и вызвать
//   window.__accept(["/campaigns/2?tab=Сюжет", "/settings/1?tab=География"])
// Каждая страница грузится в невидимый iframe нужной ширины и темы; метрики
// снимаются после затишья DOM, поэтому сценарий работает и при скрытой панели
// браузера, когда снимки экрана устаревают. На строку результата:
//   ox — горизонтальная прокрутка (должна быть 0), acid — видимые кислотные
//   кнопки (одна на вкладку), focal/seg — рамки и сегменты, rawKeys — сырые
//   ключи типов в тексте, nan — NaN/undefined/[object Object], empty — пустая
//   страница, wide — что вылезает за край, errs — ошибки страницы.
// Долгий прогон (> 45 с) запускать без await и читать window.__acc_log.
// Шире — scripts/check-all.mjs (типы, lint, тесты, чужие файлы).
window.__accept = async (urls, widths = [1440, 375], themes = ["light", "dark"]) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = (window.__acc_log = []);
  const prevTheme = localStorage.getItem("rpgManagerTheme");
  for (const theme of themes) {
    localStorage.setItem("rpgManagerTheme", JSON.stringify({ themeId: theme }));
    for (const w of widths) {
      for (const url of urls) {
        const f = document.createElement("iframe");
        f.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${w > 700 ? 1000 : 812}px;opacity:0;pointer-events:none;border:0;z-index:-1`;
        document.body.appendChild(f);
        const errs = [];
        f.src = url;
        await new Promise((r) => (f.onload = r));
        try { f.contentWindow.addEventListener("error", (e) => errs.push(String(e.message).slice(0, 80))); } catch {}
        const doc = () => f.contentDocument;
        let last = -1, still = 0;
        for (let i = 0; i < 40 && still < 3; i++) {
          await sleep(250);
          const n = doc().body ? doc().body.innerText.length : 0;
          still = n === last && n > 200 ? still + 1 : 0;
          last = n;
        }
        const d = doc(), de = d.documentElement, win = f.contentWindow;
        const vis = (e) => { const r = e.getBoundingClientRect(); const s = win.getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
        const txt = d.body.innerText;
        // элементы, вылезающие за правый край (на телефоне)
        const wide = [...d.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 2 && win.getComputedStyle(e).position !== "fixed"; })
          .filter((e) => !e.closest("[class*=scroll], .d-seg, nav, [class*=tabs], [class*=strip], table, .chr-axis, canvas"))
          .slice(0, 3).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}→${Math.round(e.getBoundingClientRect().right)}`);
        out.push({
          url: decodeURIComponent(url.replace(location.origin, "")), theme: de.getAttribute("data-theme-mode") || de.getAttribute("data-theme-id"), w,
          ox: de.scrollWidth - de.clientWidth,
          acid: [...d.querySelectorAll(".d-btn--primary")].filter(vis).map((e) => e.textContent.trim().slice(0, 26)),
          focal: [...d.querySelectorAll(".d-focal")].filter(vis).length,
          seg: [...d.querySelectorAll(".d-seg")].filter(vis).length,
          bg: win.getComputedStyle(d.body).backgroundColor,
          rawKeys: (txt.match(/\b(LOCATION|BEING|EVENT|CHARACTER|ARTIFACT|COMMUNITY)\b/g) || []).slice(0, 3),
          nan: /\bNaN\b|undefined|\[object Object\]/.test(txt),
          empty: txt.trim().length < 200,
          wide, errs,
        });
        f.remove();
      }
    }
  }
  if (prevTheme == null) localStorage.removeItem("rpgManagerTheme"); else localStorage.setItem("rpgManagerTheme", prevTheme);
  return out;
};
"ready";
