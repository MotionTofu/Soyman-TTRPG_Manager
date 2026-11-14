import { createContext, useContext, useState } from "react";
import { plainOracleText, rowAt, throwDice, type Dice, type Die, type RollRow } from "./litmOracles";

export const OracleLanguage = createContext(false);
export const OracleHistory = createContext<(label: string, roll: string, result: string, rolled?: boolean) => void>(() => {});

export type Picked<T> = { row: T; dice?: Dice };

export function rollFrom<T extends RollRow>(rows: readonly T[], die: Die): Picked<T> | undefined {
  const dice = throwDice(die);
  const row = rowAt(rows, dice.value);
  return row ? { row, dice } : undefined;
}

export function useOracleTable<T extends RollRow>(rows: readonly T[], die: Die, label: string, result: (row: T) => string) {
  const record = useContext(OracleHistory);
  const [picked, setPicked] = useState<Picked<T>>();
  function select(row: T, dice?: Dice) {
    setPicked({ row, dice });
    record(label, String(dice?.value ?? row.roll), plainOracleText(result(row)), !!dice);
  }
  function roll() {
    const next = rollFrom(rows, die);
    if (next) select(next.row, next.dice);
  }
  return { picked, select, roll };
}
