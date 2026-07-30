import { Router } from "express";
import { totalEarnings } from "../services/finance";

export const financeRouter = Router();

financeRouter.get("/summary", (_req, res) => {
  res.json(totalEarnings());
});
