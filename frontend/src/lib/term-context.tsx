"use client";
import React, { createContext, useContext, useState, useCallback } from "react";

interface TermContextValue {
  termVersion: number;
  bumpTermVersion: () => void;
}

const TermContext = createContext<TermContextValue>({
  termVersion: 0,
  bumpTermVersion: () => {},
});

export function TermProvider({ children }: { children: React.ReactNode }) {
  const [termVersion, setTermVersion] = useState(0);
  const bumpTermVersion = useCallback(() => setTermVersion(v => v + 1), []);
  return (
    <TermContext.Provider value={{ termVersion, bumpTermVersion }}>
      {children}
    </TermContext.Provider>
  );
}

export function useTermVersion() {
  return useContext(TermContext);
}
