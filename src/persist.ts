import fs from "node:fs";
import path from "node:path";
import type { CookieStore, CookieStoreInput } from "./http.ts";

export const PERSIST_VERSION = 2;

export interface PersistData {
  version: number;
  savedAt: string;
  hosts: CookieStoreInput;
}

export function loadPersist(file: string): PersistData | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as PersistData;
    if (!data || typeof data !== "object" || !data.hosts) return undefined;
    return data;
  } catch {
    return undefined;
  }
}

export function savePersist(file: string, hosts: CookieStore): PersistData {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const data: PersistData = {
    version: PERSIST_VERSION,
    savedAt: new Date().toISOString(),
    hosts,
  };
  fs.writeFileSync(resolved, JSON.stringify(data, null, 2), { mode: 0o600 });
  return data;
}
