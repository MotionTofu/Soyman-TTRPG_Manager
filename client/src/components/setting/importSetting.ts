import { write, type ActionOptions } from "../../data/hooks";
import type { Setting } from "../../types";

type Confirm = (o: { title: string; message: string; confirmLabel: string; cancelLabel: string }) => Promise<boolean>;
type Run = <R>(action: () => Promise<R>, options: ActionOptions) => Promise<R | undefined>;

/** Импорт сеттинга из файла — общий для списка («Импорт» в шапке) и «…» профиля. */
export async function importSettingFile(file: File, confirm: Confirm, run: Run): Promise<Setting | undefined> {
  const data = JSON.parse(await file.text());
  // Файл может нести сотни мегабайт картинок. Спрашиваем один раз здесь, а
  // не гоняем флаг через маршрут молча: раскладывать их по хранилищу человек
  // не обязан, а всё остальное содержимое приезжает в любом случае.
  let withImages = true;
  if (file.size > 5 * 1024 * 1024) {
    withImages = await confirm({
      title: "Импорт с изображениями?",
      message: `Файл весит ${(file.size / 1024 / 1024).toFixed(0)} МБ — похоже, в нём есть изображения.\n\nОК — поставить вместе с картинками.\nОтмена — только тексты и связи, без картинок.`,
      confirmLabel: "С картинками",
      cancelLabel: "Без картинок",
    });
  }
  // Повтор импорта поставил бы второй сеттинг — поэтому без «Повторить».
  return run(() => write.post<Setting>(`/settings/import${withImages ? "" : "?images=0"}`, data), {
    affects: [{ kind: "setting" }],
    retry: false,
  });
}
