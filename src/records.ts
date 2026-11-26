/**
 * Bästa tid per etapp, sparad i webbläsaren tills konto och sparning finns.
 * shortcut: bara lokalt i den här webbläsaren; flytta till kontot när det byggs.
 */
export interface StageRecord {
  time: number;
  splits: number[];
}

export function loadRecord(stageName: string): StageRecord | null {
  try {
    const r = JSON.parse(localStorage.getItem(`rally.best.${stageName}`) ?? 'null') as StageRecord | null;
    return r && typeof r.time === 'number' && Array.isArray(r.splits) ? r : null;
  } catch {
    return null;
  }
}

export function saveRecord(stageName: string, record: StageRecord) {
  try {
    localStorage.setItem(`rally.best.${stageName}`, JSON.stringify(record));
  } catch {
    // Privat läge eller full lagring: rekordet gäller bara den här sessionen.
  }
}
