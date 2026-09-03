// Источник владения навыком — от класса, от предыстории или от обоих.
//
// Отдельным модулем, а не в AbilitySavesSkills.tsx: обе функции нужны и
// вкладке «Навыки» в DndCharacterForm, и самой AbilitySavesSkills, а каждая
// такая экспортируемая функция в компонентном файле ломает fast refresh
// (предупреждение react/only-export-components).

// Синий — от класса, зелёный — от предыстории, розовый — от обоих. Сами тона
// живут токенами темы (`--skill-source-*` в themes.ts), здесь только выбор
// класса строки.
export function skillSourceClass(
  skill: string,
  classSkillPool: string[],
  backgroundSkillNames: string[]
): string {
  const fromClass = classSkillPool.includes(skill);
  const fromBackground = backgroundSkillNames.includes(skill);
  if (fromClass && fromBackground) return " skill-source-both";
  if (fromClass) return " skill-source-class";
  if (fromBackground) return " skill-source-background";
  return "";
}

// То же самое словом. На экране скрыто (см. .dnd-skill-source-word), на
// печати — единственное, что остаётся от источника: заливки там гаснут, а
// распечатанный лист чаще всего чёрно-белый.
export function skillSourceWord(
  skill: string,
  classSkillPool: string[],
  backgroundSkillNames: string[]
): string {
  const fromClass = classSkillPool.includes(skill);
  const fromBackground = backgroundSkillNames.includes(skill);
  if (fromClass && fromBackground) return "класс и предыстория";
  if (fromClass) return "класс";
  if (fromBackground) return "предыстория";
  return "";
}
