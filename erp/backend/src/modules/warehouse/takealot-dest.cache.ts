import { DEFAULT_TAKEALOT_DEST_ROWS, type TakealotDestRow } from './takealot-dest.defaults'

let cached: TakealotDestRow[] | null = null

export function setTakealotDestCache(rows: TakealotDestRow[]) {
  cached = rows
}

export function getTakealotDestCache(): TakealotDestRow[] {
  return cached?.length ? cached : DEFAULT_TAKEALOT_DEST_ROWS
}

export function getEnabledTakealotDestRows(): TakealotDestRow[] {
  return getTakealotDestCache().filter((row) => row.enabled)
}
