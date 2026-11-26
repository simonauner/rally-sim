/**
 * Bästa tid per etapp, sparad i webbläsaren tills konto och sparning finns.
 * shortcut: bara lokalt i den här webbläsaren; flytta till kontot när det byggs.
 */
import type { GhostData } from './physics/ghost';
import type { StageDef } from './physics/stage';

export interface StageRecord {
  time: number;
  splits: number[];
  /** Saknas i rekord sparade innan ghosten fanns. */
  ghost?: GhostData;
  /** Banversionen rekordet sattes på. Saknas i rekord från innan banor versionerades. */
  version?: string;
}

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
    const r = JSON.parse(localStorage.getItem(`rally.best.${stage.name}`) ?? 'null') as StageRecord | null;
    if (!r || typeof r.time !== 'number' || !Array.isArray(r.splits)) return null;
    // Rekord från en äldre banversion skrivs över av nästa åk i mål.
    if (!recordValid(r.version, stage)) return null;
    if (r.ghost && !(typeof r.ghost.hz === 'number' && Array.isArray(r.ghost.frames))) delete r.ghost;
    return r;
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
