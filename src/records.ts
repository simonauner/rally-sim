/**
 * Best time per stage in the browser. The account (account/sync.ts) syncs them between devices.
 */
import { isStageRecord, type StageRecord } from './account/protocol';
import type { StageDef } from './physics/stage';

/** Does a record set on `version` apply to the track in its current version? */
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
    // Records from an older track version are overwritten by the next finished run.
    return isStageRecord(r) && recordValid(r.version, stage) ? r : null;
  } catch {
    return null;
  }
}

export function saveRecord(stage: StageDef, record: StageRecord) {
  try {
    localStorage.setItem(`rally.best.${stage.name}`, JSON.stringify({ ...record, version: stage.version }));
  } catch {
    // Private mode or full storage: the record only applies to this session.
  }
}
