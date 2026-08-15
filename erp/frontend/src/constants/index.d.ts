export const ROUTE_MAP: Record<string, string>
export const PO_STATUS: Record<string, { label: string; type: string }>
export const WAREHOUSE_TYPE: Record<string, { label: string; type: string }>
export const INBOUND_STATUS: Record<string, { label: string; type: string }>
export const INBOUND_PENDING_RECEIPT: Set<string>
export function getInboundStatusMeta(status: string): { label: string; type: string; tone: string }
export const LEAD_STATUS: Record<string, { label: string; type: string }>
export const PRODUCT_DEV_STATUS: Record<string, { label: string; type: string }>
export const SYNC_STATUS: Record<string, { label: string; type: string }>
export const ROLE_TEMPLATES: Record<string, string[]>
export const KPI_TONE: Record<string, string>
