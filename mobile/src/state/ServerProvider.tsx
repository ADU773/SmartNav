import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiBaseSource, DEFAULT_API_BASE_URL, isPlausibleApiBase, normalizeApiBase } from "../config/env";
import { probeServer } from "../lib/api";
import { recordDiagnostic } from "../lib/diagnostics";

const STORAGE_KEY = "smartnav.manualApiBase";

interface ServerContextValue {
  /** The address the app will actually use, or null if nothing is configured. */
  apiBase: string | null;
  source: ApiBaseSource;
  manualApiBase: string | null;
  /** Backend address carried by the current session's QR code. Deliberately
   * never written to storage: a QR is a one-off instruction from whatever
   * screen happened to be in front of the camera. */
  sessionApiBase: string | null;
  setSessionApiBase: (value: string | null) => void;
  /** Validates the address against a live backend before storing it. */
  saveManualApiBase: (value: string) => Promise<void>;
  clearManualApiBase: () => Promise<void>;
  /** Promotes the current session's QR address to the saved default, on an
   * explicit user action only. */
  rememberSessionApiBase: () => Promise<void>;
  ready: boolean;
}

const ServerContext = createContext<ServerContextValue | null>(null);

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const [manualApiBase, setManualApiBase] = useState<string | null>(null);
  const [sessionApiBase, setSessionApiBase] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (stored && isPlausibleApiBase(stored)) setManualApiBase(stored);
      })
      .catch((error) => recordDiagnostic("server config", `could not read saved address — ${String(error)}`))
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { apiBase, source } = useMemo<{ apiBase: string | null; source: ApiBaseSource }>(() => {
    if (sessionApiBase) return { apiBase: sessionApiBase, source: "session" };
    if (manualApiBase) return { apiBase: manualApiBase, source: "manual" };
    if (DEFAULT_API_BASE_URL) return { apiBase: normalizeApiBase(DEFAULT_API_BASE_URL), source: "env" };
    return { apiBase: null, source: "none" };
  }, [sessionApiBase, manualApiBase]);

  const saveManualApiBase = useCallback(async (value: string) => {
    const normalized = normalizeApiBase(value);
    if (!normalized || !isPlausibleApiBase(normalized)) {
      throw new Error("Enter an address like 192.168.1.20:5000.");
    }
    await probeServer(normalized);
    await AsyncStorage.setItem(STORAGE_KEY, normalized);
    setManualApiBase(normalized);
    recordDiagnostic("server config", `saved ${normalized}`);
  }, []);

  const clearManualApiBase = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setManualApiBase(null);
    recordDiagnostic("server config", "cleared saved address");
  }, []);

  const rememberSessionApiBase = useCallback(async () => {
    if (!sessionApiBase) return;
    await AsyncStorage.setItem(STORAGE_KEY, sessionApiBase);
    setManualApiBase(sessionApiBase);
    recordDiagnostic("server config", `remembered ${sessionApiBase} from QR`);
  }, [sessionApiBase]);

  const value = useMemo(
    () => ({
      apiBase,
      source,
      manualApiBase,
      sessionApiBase,
      setSessionApiBase,
      saveManualApiBase,
      clearManualApiBase,
      rememberSessionApiBase,
      ready,
    }),
    [apiBase, source, manualApiBase, sessionApiBase, saveManualApiBase, clearManualApiBase, rememberSessionApiBase, ready],
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServer(): ServerContextValue {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error("useServer must be used within a ServerProvider");
  return ctx;
}
