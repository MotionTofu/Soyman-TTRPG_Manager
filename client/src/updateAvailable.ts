import { useEffect, useState } from "react";
import { hasElectronAPI, type UpdateStatus } from "./electronApi";

// Есть ли готовое к установке обновление — для точки в навигации.
//
// Дизайн-ревизия убрала блок «Обновления» с главной: обслуживание приложения
// это не владения мастера, и первой позиции рельса оно не стоило. Но убрать
// блок и не оставить ничего значило бы, что про обновление узнают, только
// зайдя в настройки. Точка на пункте «Настройки» — минимальная замена: она
// ничего не занимает, пока обновления нет, и не требует действия, когда оно
// есть.
//
// Реагируем только на состояния, где мастеру ЕСТЬ что сделать. «Проверяем» и
// «у вас последняя версия» — это ход проверки, а не новость; точка на них
// мигала бы при каждом запуске и перестала бы что-либо значить.
const ACTIONABLE: UpdateStatus["status"][] = ["available", "downloading", "downloaded"];

export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!hasElectronAPI()) return;
    return window.electronAPI!.onUpdateStatus((s) => setAvailable(ACTIONABLE.includes(s.status)));
  }, []);

  return available;
}
