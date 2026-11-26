/**
 * Bästa tid per etapp i webbläsaren. Kontot (account/sync.ts) synkar dem mellan enheter.
 */
import { isStageRecord, type StageRecord } from './account/protocol';
import type { StageDef } from './physics/stage';

/** Gäller ett rekord satt på `version` för banan i dess nuvarande version? */
export function recordValid(version: string | undefined, stage: StageDef): boolean {
  if (!version) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  const [curMajor] = stage.version.split('.').map(Number);
  const [sMajor, sMinor, sPatch] = stage.recordsSince.split('.').map(Number);
  if (major !== curMajor) return false;
  return major! > sMajor! || (major === sMajor && (minor! > sMinor! || (minor === sMinor && patch! >= sPatch!)));
}

export function loadRecord(stage: StageDef): StageRecord | null {
  try {
    const r: unknown = JSON.parse(localStorage.getItem(`rally.best.${stage.name}`) ?? 'null');
    // Rekord från en äldre banversion skrivs över av nästa åk i mål.
    return isStageRecord(r) && recordValid(r.version, stage) ? r : null;
  } catch {
    return null;
  }
}

export function saveRecord(stage: StageDef, record: StageRecord) {
  try {
    localStorage.setItem(`rally.best.${stage.name}`, JSON.stringify({ ...record, version: stage.version }));
  } catch {
    // Privat läge eller full lagring: rekordet gäller bara den här sessionen.
  }
}
