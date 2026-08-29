import type { ZineGraphicName } from "../components/ZineGraphics";

export interface GenreCategory {
  name: string;
  icon: ZineGraphicName;
  color: string;
  subgenres: string[];
}

export const GENRE_CATEGORIES: GenreCategory[] = [
  {
    name: "Фэнтези",
    icon: "fantasySwords",
    color: "#4A7C59",
    subgenres: [
      "классическое фэнтези",
      "гримдарк",
      "хай фэнтези",
      "лоу фэнтези",
      "растик фэнтези",
      "фолк фэнтези",
      "эпическое фэнтези",
    ],
  },
  {
    name: "Научная фантастика",
    icon: "cosmicOrbit",
    color: "#3B6B8A",
    subgenres: [
      "космическая опера",
      "постапокалипсис",
      "киберпанк",
      "хард-СФ",
    ],
  },
  {
    name: "Хоррор и мистика",
    icon: "skullDie",
    color: "#7A2E2E",
    subgenres: [
      "лавкрафтианский ужас",
      "экзистенциальный хоррор",
      "готик хоррор",
      "бади хоррор",
      "слэшер",
      "катастрофа",
      "психологический хоррор",
    ],
  },
  {
    name: "Современность и реализм",
    icon: "anarchyStar",
    color: "#5C5C5C",
    subgenres: [
      "нуар",
      "шпионский триллер",
      "городская фантастика",
      "реалистичное выживание",
    ],
  },
];

export const MAX_GENRES = 3;
