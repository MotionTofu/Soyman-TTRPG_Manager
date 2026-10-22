// Разбор строки типа существа переехал в shared (shared/src/dnd/creatureMeta.ts):
// им пользуется и нормализатор статблока. Здесь — прежний адрес для импортёра.
export {
  CREATURE_SIZES,
  DND_CREATURE_TYPES,
  capitalize,
  cleanChallengeRating,
  matchCreatureType,
  matchSize,
  parseCreatureMeta,
  sameWordStem,
  type CreatureMeta,
} from "@soyman/shared";
