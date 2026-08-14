import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SearchResult } from "./types";

// Куда «Мешок» может выгрузить содержимое на текущей странице. Зоны приёма
// перетаскивания сами объявляют себя здесь (useUnloadTarget) — иначе мешок
// никак не узнал бы, что на странице есть «Обитатели» и «Связанные
// сущности», а на пульте сессии — «Инициатива».
export interface UnloadTarget {
  id: string;
  label: string;
  accepts: (item: SearchResult) => boolean;
  drop: (item: SearchResult) => Promise<void> | void;
}

// Два контекста, а не один объект с обоими полями: список целей меняется при
// каждой регистрации, и если бы функция register приезжала вместе с ним, у неё
// менялась бы ссылка — эффект в useUnloadTarget перезапускался бы, снимал и
// заново ставил регистрацию, снова меняя список. Это бесконечный цикл
// («Maximum update depth exceeded»), поэтому register живёт в собственном
// контексте со ссылкой, стабильной на всё время жизни провайдера.
const RegisterContext = createContext<((target: UnloadTarget) => () => void) | null>(null);
const TargetsContext = createContext<UnloadTarget[]>([]);

export function UnloadTargetsProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<UnloadTarget[]>([]);

  const register = useCallback((target: UnloadTarget) => {
    setTargets((prev) => [...prev, target]);
    return () => setTargets((prev) => prev.filter((t) => t !== target));
  }, []);

  return (
    <RegisterContext.Provider value={register}>
      <TargetsContext.Provider value={targets}>{children}</TargetsContext.Provider>
    </RegisterContext.Provider>
  );
}

export function useUnloadTargets(): UnloadTarget[] {
  return useContext(TargetsContext);
}

let nextId = 1;

/**
 * Объявить зону приёма целью выгрузки мешка. Вызывается рядом с обычным
 * onDrop: обработчик перетаскивания остаётся как был, здесь описывается то же
 * действие, но принимающее сущность напрямую.
 *
 * `label` — что пользователь увидит в диалоге выгрузки. Передайте null, чтобы
 * не регистрироваться (например, пока данные страницы не загрузились).
 */
export function useUnloadTarget(spec: Omit<UnloadTarget, "id"> | null): void {
  const register = useContext(RegisterContext);
  // Колбэки меняются на каждый рендер страницы, а перерегистрировать зону
  // из-за этого незачем — цель держит ссылку на свежий spec.
  const latest = useRef(spec);
  latest.current = spec;

  const label = spec?.label ?? null;
  useEffect(() => {
    if (!register || label === null) return;
    return register({
      id: `unload-${nextId++}`,
      label,
      accepts: (item) => latest.current?.accepts(item) ?? false,
      drop: (item) => latest.current?.drop(item),
    });
    // register стабилен; перерегистрация нужна только при смене подписи (то
    // есть когда это уже другая зона).
  }, [register, label]);
}
