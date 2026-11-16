import { write } from "./hooks";
import type { Module } from "../types";

const MAX_MODULE_FILE_BYTES = 500 * 1024 * 1024;

export async function importModuleFile(file: File, install?: "system"): Promise<Module> {
  if (file.size > MAX_MODULE_FILE_BYTES) {
    throw new Error("Файл слишком большой — максимум 500 МБ для импорта");
  }
  const form = new FormData();
  form.append("file", file, file.name);
  return write.post<Module>(install === "system" ? "/modules/import-file?install=system" : "/modules/import-file", form, {
    timeoutMs: 600_000,
  });
}
