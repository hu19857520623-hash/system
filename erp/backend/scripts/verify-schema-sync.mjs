/**
 * Compare critical Prisma-mapped columns/tables with live MySQL.
 * Usage: npm run verify:schema
 */
import { PrismaClient } from '@prisma/client'

const checks = [
  {
    table: 'outbound_order',
    columns: [
      'cargo_type',
      'fba_warehouse',
      'seller_store_name',
      'appointment_date',
      'recipient_json',
      'problem_type',
      'exception_type',
    ],
  },
  { table: 'warehouse', columns: ['required_outbound_files'] },
  { table: 'inbound_order', columns: ['oms_customer_code', 'inbound_type', 'delivery_method', 'reference_no', 'eta'] },
  { table: 'product', columns: ['sea_freight_per_unit', 'domestic_fee_per_unit', 'customer_sku', 'declared_name_en', 'declared_name_cn', 'unit', 'has_battery'] },
  { table: 'product_pricing', columns: ['inbound_qty', 'sold_qty', 'visible_stock_qty'] },
  { table: 'customer_sku_inventory', columns: ['customer_id', 'sku', 'quantity'] },
  { table: 'inbound_carton', columns: ['inbound_id', 'box_code'] },
  { table: 'inbound_carton_item', columns: ['carton_id', 'sku'] },
  { table: 'oms_catalog_order', columns: ['order_no', 'customer_id', 'sku'] },
  { table: 'billing_charge', columns: ['charge_no', 'customer_id', 'charge_type', 'biz_ref', 'operation_type'] },
  { table: 'stocktake_plan', columns: ['stocktake_no', 'warehouse_code', 'mode', 'status'] },
  { table: 'stocktake_line', columns: ['plan_id', 'sku', 'book_qty'] },
  { table: 'inbound_draft', columns: ['draft_no', 'form_data', 'saved_at'] },
  { table: 'inbound_attachment', columns: ['inbound_id', 'file_name', 'file_path'] },
  {
    table: 'outbound_attachment',
    columns: [
      'outbound_id',
      'file_path',
      'sku',
      'platform_barcode',
      'unit_index',
      'source_page',
      'source_row',
      'source_column',
      'label_role',
      'content_hash',
    ],
  },
  { table: 'purchase_order', columns: ['payment_status', 'paid_at', 'paid_by'] },
  { table: 'lead_deal_attachment', columns: ['deal_id', 'file_name', 'file_path'] },
  { table: 'mingrui_shipment', columns: ['shipment_no', 'status', 'mingrui_order_no', 'api_status'] },
  { table: 'takealot_store', columns: ['api_key', 'coach_role', 'store_name'] },
  { table: 'operating_ledger', columns: ['entry_no', 'direction', 'category', 'amount', 'currency', 'occurred_on'] },
  { table: 'wcs_weigh_event', columns: ['tickets_num', 'weight_kg', 'raw_json', 'result', 'message'] },
  { table: 'wcs_weigh_photo', columns: ['express_no', 'file_path', 'is_ok'] },
  { table: 'wcs_device_config', columns: ['enabled', 'device_key', 'chute_message', 'require_member_id'] },
]

const prisma = new PrismaClient()

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    table,
    column,
  )
  return Number(rows[0]?.c) > 0
}

async function tableExists(table) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    table,
  )
  return Number(rows[0]?.c) > 0
}

async function main() {
  const missing = []
  for (const { table, columns } of checks) {
    if (!(await tableExists(table))) {
      missing.push(`TABLE ${table}`)
      continue
    }
    for (const col of columns) {
      if (!(await columnExists(table, col))) missing.push(`${table}.${col}`)
    }
  }

  if (missing.length) {
    console.error('Schema drift detected:')
    for (const m of missing) console.error('  -', m)
    console.error('\nFix: npm run migrate:all (do not baseline a database with missing objects)')
    process.exit(1)
  }

  console.log('Schema sync OK: all critical tables/columns present.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
