/** @deprecated 请使用 importFailureDetail + lineImportResult */
export type { ImportRowFailure } from './importFailureDetail'
export {
  downloadImportFailuresCsv,
  formatImportFailureLine,
  showImportFailuresDialog,
} from './importFailureDetail'
export { reportLineImportResult, type LineImportResultOptions } from './lineImportResult'
