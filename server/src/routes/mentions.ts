import { Router } from "express";
import { mentionIndex, prefixOf, sourceCodeOf } from "../services/mentions";

export const mentionsRouter = Router();

/**
 * Карта глобальных ключей для клиента.
 *
 * Ссылки в текстах рендерятся синхронно: `MentionText` разбирает абзац и сразу
 * строит маршрут, без единого запроса, — иначе каждая заметка с меншенами
 * дёргала бы сервер при отрисовке. Значит знание «этот ключ — вот эта строка»
 * должно быть у клиента заранее, и оно приезжает сюда одним куском при старте.
 *
 * Одной картой закрываются сразу три нужды: куда ведёт ссылка, зачёркнута ли
 * она (ключ ни во что не резолвится) и какой локальный id положить в граф
 * связей при сохранении текста.
 */
mentionsRouter.get("/index", (_req, res) => {
  res.json(mentionIndex());
});

/**
 * Готовый ключ для одной сущности.
 *
 * Обычно клиент собирает токен из карты сам и мгновенно. Но сущность могли
 * создать прямо сейчас — тем самым окном «создать новую», из которого её
 * тут же и вставляют, — и в карте её ещё нет. Спросить про одну строку
 * дешевле, чем перезагружать карту целиком ради неё.
 */
mentionsRouter.get("/token", (req, res) => {
  const type = String(req.query.type || "");
  const id = Number(req.query.id);
  if (!type || !Number.isFinite(id)) return res.status(400).json({ error: "нужны type и id" });
  res.json({ prefix: prefixOf(type, id), source: sourceCodeOf(type, id) });
});
