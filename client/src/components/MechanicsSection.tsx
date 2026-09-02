import { CompendiumSection } from "./CompendiumSection";
import type { SystemSection } from "../types";

// Тонкий шов для справочника (§P3): отдельный модуль, как MonsterSection/VehicleSection.
// Логика живёт в CompendiumSection (чтобы не дублировать 2900 строк и не плодить рассинхрон
// пикеров), но у системы появляется свой импорт и своё место для будущих механик-специфичных
// расширений (групповые фильтры, печатный вид, bulk-операции).
// P3.3: дефолт сортировки для справочника уже `alpha` (CompendiumSection:453 `section.kind === "mechanics"`),
// поиск — `debouncedQuery` 200ms (CompendiumSection:714) — отдельный прокси не нужен, но шов сохранён.
export function MechanicsSection(props: { systemId: number; section: SystemSection; focusEntryId?: number }) {
  return <CompendiumSection {...props} />;
}
