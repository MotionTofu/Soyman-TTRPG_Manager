import { useEffect, useState } from "react";

// Кнопка «на весь экран» для окон показа (второй монитор). Fullscreen API
// требует жеста в самом окне — opener его дать не может, поэтому при
// монтировании пробуем сами (провалится без жеста — останется кнопка),
// а дальше ждём клик. В фуллскрине кнопка прячется (fullscreenchange).
export function FullscreenButton() {
  const [isFs, setIsFs] = useState<boolean>(() => !!document.fullscreenElement);

  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isFs) return null;
  return (
    <button
      type="button"
      className="pres-fs"
      onClick={() => {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }}
    >
      ⛶ На весь экран
    </button>
  );
}
