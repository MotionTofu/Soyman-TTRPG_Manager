// Глифы для кнопок пульта. Пак «настоящих» иконок отложен (см. later.md) —
// здесь тот минимум, по которому кнопка уже узнаётся не по подписи.
// Своя картинка (audio_icon_image_path) перекрывает глиф; без того и другого
// кнопка остаётся текстовой — требовать картинку к каждому из полусотни
// звуков значит, что иконок не будет ни у одного.

const PATHS: Record<string, string> = {
  forest: "M12 3 L6 11 H9 L5 17 H19 L15 11 H18 Z M12 17 V21",
  fire: "M12 3c3 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 1 1 2 2 2 0-3 1-5 1-7z",
  tavern: "M4 7h11v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z M15 9h3a2 2 0 0 1 0 5h-3",
  crowd: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M2 20c0-3 3-5 6-5s6 2 6 5 M16 6a3 3 0 0 1 0 6 M17 15c3 0 5 2 5 5",
  water: "M3 8c3-2 5 2 8 0s5-2 8 0 M3 13c3-2 5 2 8 0s5-2 8 0 M3 18c3-2 5 2 8 0s5-2 8 0",
  wind: "M3 8h10a3 3 0 1 0-3-3 M3 13h14a3 3 0 1 1-3 3 M3 18h8",
  cave: "M4 21v-7a8 8 0 0 1 16 0v7 M9 21v-4a3 3 0 0 1 6 0v4",
  road: "M9 3 6 21 M15 3l3 18 M12 5v3 M12 11v3 M12 17v3",
  city: "M3 21h18 M5 21V9l7-5 7 5v12 M10 21v-6h4v6",
  birds: "M3 8c3 0 4 3 7 3s5-4 8-4c2 0 3 1 3 3s-2 3-4 3-4-1-6-1-4 2-6 2",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M19 5l-1.5 1.5 M6.5 17.5 5 19",
  cloud: "M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z",
  rain: "M7 15h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 15z M8 18l-1 3 M12 18l-1 3 M16 18l-1 3",
  storm: "M7 14h9a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 14z M13 14l-3 5h4l-2 5",
  snow: "M7 15h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 15z M9 19h.01 M13 19h.01 M11 21h.01",
  fog: "M4 10h16 M4 14h16 M6 18h12 M6 6h12",
  battle: "M4 4l9 9 M3 6l3-3 M20 4l-9 9 M21 6l-3-3 M9 15l-4 5 M15 15l4 5",
  danger: "M12 3a7 7 0 0 0-7 7v3l2 2v3h10v-3l2-2v-3a7 7 0 0 0-7-7z M9 12h.01 M15 12h.01",
  secret: "M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  success: "M12 3l2.6 6h6.4l-5 4 2 6.5-6-4-6 4 2-6.5-5-4h6.4z",
  fail: "M12 20S4 14 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5-8 11-8 11z M12 8l-2 4h4l-2 4",
  door: "M14 3H6v18h8 M14 3v18 M18 8v8 M18 12h-4",
  bell: "M6 16h12l-2-3v-3a4 4 0 0 0-8 0v3z M10 19a2 2 0 0 0 4 0",
  music: "M9 18V6l11-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  wave: "M4 14v-4 M8 18V6 M12 15V9 M16 20V4 M20 13v-2",
};

export const SOUND_ICON_NAMES = Object.keys(PATHS);

export function SoundIcon({
  name,
  imageUrl,
  size = 22,
}: {
  name: string | null;
  imageUrl?: string | null;
  size?: number;
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        style={{ objectFit: "cover", display: "block" }}
      />
    );
  }
  const path = name ? PATHS[name] : null;
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
