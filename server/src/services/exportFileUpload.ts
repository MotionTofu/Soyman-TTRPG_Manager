import fs from "node:fs";
import os from "node:os";
import multer from "multer";
import type { Request, RequestHandler } from "express";

const MAX_EXPORT_FILE_BYTES = 500 * 1024 * 1024;

const upload = multer({
  dest: os.tmpdir(),
  // Busboy signals the limit as soon as it reaches it.
  limits: { fileSize: MAX_EXPORT_FILE_BYTES + 1, files: 1, fields: 0 },
  fileFilter(_req, file, cb) {
    if (!file.originalname.toLowerCase().endsWith(".json")) {
      return cb(new Error("Выберите файл экспорта .json"));
    }
    cb(null, true);
  },
}).single("file");

export const uploadExportFile: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Файл слишком большой — максимум 500 МБ для импорта" });
    }
    if (error || !req.file) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Выберите файл экспорта .json" });
    }
    next();
  });
};

export function readExportFile(req: Request): string {
  const filePath = req.file?.path;
  if (!filePath) throw new Error("Выберите файл экспорта .json");
  try {
    return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  } finally {
    fs.unlinkSync(filePath);
  }
}
