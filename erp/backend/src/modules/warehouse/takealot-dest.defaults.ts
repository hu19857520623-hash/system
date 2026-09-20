export type TakealotDestRow = {
  id?: number
  code: string
  omsWarehouseId: string | null
  label: string
  city: string | null
  matchAliases: string[]
  enabled: boolean
  sortOrder: number
}

export const DEFAULT_TAKEALOT_DEST_ROWS: TakealotDestRow[] = [
  { code: 'JHB', omsWarehouseId: null, label: 'JHB', city: '约翰内斯堡', matchAliases: ['JHB'], enabled: true, sortOrder: 10 },
  { code: 'JHB1', omsWarehouseId: 'jhb1', label: 'JHB1', city: '约翰内斯堡', matchAliases: ['JHB1'], enabled: true, sortOrder: 20 },
  { code: 'JHB3', omsWarehouseId: 'jhb3', label: 'JHB3', city: '约翰内斯堡', matchAliases: ['JHB3', 'JHB'], enabled: true, sortOrder: 30 },
  { code: 'CPT1', omsWarehouseId: 'cpt1', label: 'CPT1', city: '开普敦', matchAliases: ['CPT1', 'CPT'], enabled: true, sortOrder: 40 },
  { code: 'CPT2', omsWarehouseId: 'cpt2', label: 'CPT2', city: '开普敦', matchAliases: ['CPT2'], enabled: true, sortOrder: 50 },
  { code: 'DBN', omsWarehouseId: 'dbn', label: 'DBN', city: '德班', matchAliases: ['DBN', 'DBN1'], enabled: true, sortOrder: 60 },
  { code: 'DBN1', omsWarehouseId: 'dbn', label: 'DBN1', city: '德班', matchAliases: ['DBN1'], enabled: true, sortOrder: 70 },
]
