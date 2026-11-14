import { useContext, type ReactNode } from "react";
import { LitmRich } from "./LitmBook";
import type { Dice, RollRow } from "./litmOracles";
import { OracleLanguage } from "./useLitmOracle";

export function OracleText({ text, en }: { text: string; en?: string }) {
  const bilingual = useContext(OracleLanguage);
  return <><span title={!bilingual ? en : undefined}><LitmRich text={text} /></span>
    {bilingual && en && en !== text && <span className="lo-en" lang="en"><LitmRich text={en} /></span>}</>;
}

export function RollBar({ children }: { children: ReactNode }) {
  return <div className="lo-rollbar">{children}</div>;
}

export function RollButton({ children, onClick, disabled }: {
  children: ReactNode; onClick: () => void; disabled?: boolean;
}) {
  return <button type="button" className="d-btn lo-roll" onClick={onClick} disabled={disabled}>{children}</button>;
}

export function DiceResult({ roll, total }: { roll?: Dice; total?: string }) {
  if (!roll) return null;
  return <span className="lo-dice" aria-label={"Кости " + roll.dice.join(", ")}>
    {roll.dice.map((n, i) => <span key={i}>{n}</span>)}
    {total && <b>→ {total}</b>}
  </span>;
}

export function OracleTable<T extends RollRow>({ rows, columns, columnNames, selected, onPick, className = "" }: {
  rows: readonly T[];
  columns: (row: T) => ReactNode[];
  columnNames: readonly ReactNode[];
  selected?: T | T[];
  onPick?: (row: T) => void;
  className?: string;
}) {
  return <table className={"lo-table " + className}>
    <thead><tr>{columnNames.map((name, i) => <th key={i} scope="col">{name}</th>)}</tr></thead>
    <tbody>{rows.map((row) => {
      const picked = Array.isArray(selected) ? selected.includes(row) : row === selected;
      return <tr key={row.roll} className={picked ? "is-picked" : undefined} onClick={onPick ? (event) => {
        if (event.target instanceof Element && !event.target.closest("button, a")) onPick(row);
      } : undefined}>
        <th scope="row">
          {onPick ? <button type="button" className="lo-value" aria-label={"Выбрать " + row.roll}
            aria-pressed={picked} onClick={() => onPick(row)}>{row.roll}</button> : row.roll}
        </th>
        {columns(row).map((cell, i) => <td key={i}>{cell}</td>)}
      </tr>;
    })}</tbody>
  </table>;
}
