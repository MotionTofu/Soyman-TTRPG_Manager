import { createContext, useContext } from 'react';

// Hosts share the same sheet and wizard; table-only hosts disable random rolls.
export const DndRuntimeContext = createContext<{ allowDiceRolls: boolean; campaignConnected: boolean; detached?: boolean }>({ allowDiceRolls: true, campaignConnected: true });
export const useDndRuntime = () => useContext(DndRuntimeContext);
