package com.tkl.erp.auth.permission;

import java.util.List;
import java.util.Map;

/**
 * AUTO-GENERATED from shared/permissions.catalog.ts — do not edit by hand.
 * Regenerate: cd backend && npm run sync:java-permissions
 */
public final class PermissionConstants {

    private PermissionConstants() {}

    public static final Map<String, String> ROLE_CODE_TEMPLATE = Map.ofEntries(
            Map.entry("admin", "系统管理员"),
            Map.entry("ops", "运营"),
            Map.entry("ops_manager", "运营主管"),
            Map.entry("purchaser", "采购"),
            Map.entry("purchase_manager", "采购主管"),
            Map.entry("finance", "财务"),
            Map.entry("cs", "销售"),
            Map.entry("sales_manager", "销售主管"),
            Map.entry("coach", "陪跑"),
            Map.entry("coach1", "陪跑1"),
            Map.entry("coach2", "陪跑2"),
            Map.entry("viewer", "产品开发"),
            Map.entry("warehouse", "仓库操作"),
            Map.entry("warehouse_manager", "仓库主管"),
            Map.entry("inbound_clerk", "入库员"),
            Map.entry("outbound_clerk", "出库员"),
            Map.entry("returns_clerk", "退货员"),
            Map.entry("warehouse_reviewer", "复核员"),
            Map.entry("dev_manager", "产品开发主管")
    );

    private static final Map<String, List<String>> ROLE_PERM_TEMPLATES = Map.ofEntries(
            Map.entry("系统管理员", List.of(
                    "dashboard.view", "dashboard.kpi_inventory", "dashboard.kpi_products", "dashboard.kpi_suppliers",
                    "dashboard.kpi_leads", "dashboard.kpi_purchase", "dashboard.kpi_audit", "dashboard.kpi_sync",
                    "dashboard.trends_logistics", "dashboard.pipeline_domestic", "dashboard.pipeline_overseas", "leads_pool.view",
                    "leads_pool.create", "leads_pool.assign", "leads_pool.view_all", "leads_follow.view",
                    "leads_follow.edit", "leads_deals.view", "leads_deals.edit", "leads_reports.view",
                    "leads_pool.export", "leads_deals.export", "leads_reports.export", "products.view",
                    "products.edit", "products.import", "products.print_label", "products.export",
                    "sku_query.export", "product_dev.view", "product_dev.create", "product_dev.edit",
                    "product_audit.view", "product_audit.approve", "product_audit.reject", "product_audit.label",
                    "product_audit.purchase_qty", "suppliers.view", "suppliers.edit", "purchase.view",
                    "purchase.create", "purchase.assign", "purchase.po_audit", "purchase.mark_paid",
                    "purchase.export", "logistics_wh.view", "logistics_wh.receive", "logistics_wh.manage",
                    "logistics_wh.export", "create_inbound.view", "create_inbound.create", "create_inbound.label",
                    "mingrui.view", "mingrui.manage", "warehouse_location.view", "warehouse_location.edit",
                    "warehouse_location.batch_create", "inbound.view", "inbound.arrival_scan", "inbound.receive",
                    "inbound.qc", "inbound.putaway", "inbound.handle_exception", "inbound.confirm_diff",
                    "return.view", "return.receive", "return.process", "return.export",
                    "outbound.view", "outbound.create", "outbound.relabel", "outbound.pick",
                    "outbound.pack", "outbound.ship", "outbound.export", "anheng.view",
                    "anheng.test", "inventory_query.view", "inventory_query.detail", "inventory_query.adjust",
                    "inventory_query.export", "stocktake.view", "stocktake.create", "stocktake.count",
                    "stocktake.approve", "capacity.view", "capacity.manage", "wms_reports.view",
                    "wms_reports.export", "inbound_fee.view", "inbound_fee.manage", "pricing.view",
                    "pricing.set", "pricing.sync_oms", "store_monitor.view", "store_monitor.view_all",
                    "store_monitor.manage", "store_monitor.assign", "cost.view", "cost.export",
                    "operating_ledger.view", "operating_ledger.manage", "operating_ledger.export", "billing.view",
                    "billing.generate", "billing.manual", "billing.export", "receivable_payable.view",
                    "receivable_payable.manual", "receivable_payable.export", "budget_credit.view", "budget_credit.create",
                    "budget_credit.export", "profit_analysis.view", "reports.view", "sync.view",
                    "sync.retry", "sync.export", "operation_log.view", "flow_debug.export",
                    "async_io.import", "async_io.export", "permissions.view", "permissions.manage",
                    "announcement.manage"
            )),
            Map.entry("采购主管", List.of(
                    "dashboard.view", "dashboard.kpi_inventory", "dashboard.kpi_products", "dashboard.kpi_suppliers",
                    "dashboard.kpi_purchase", "dashboard.kpi_audit", "dashboard.kpi_sync", "dashboard.trends_logistics",
                    "dashboard.pipeline_domestic", "dashboard.pipeline_overseas", "products.view", "suppliers.view",
                    "suppliers.edit", "purchase.view", "purchase.create", "purchase.assign",
                    "purchase.po_audit", "purchase.mark_paid", "purchase.export", "sku_query.export",
                    "logistics_wh.view", "logistics_wh.receive", "logistics_wh.manage", "logistics_wh.export",
                    "create_inbound.view", "create_inbound.create", "create_inbound.label", "mingrui.view",
                    "mingrui.manage", "warehouse_location.view", "warehouse_location.edit", "warehouse_location.batch_create",
                    "inbound.view", "inbound.arrival_scan", "inbound.receive", "inbound.qc",
                    "inbound.putaway", "inbound.handle_exception", "inbound.confirm_diff", "return.view",
                    "return.receive", "return.process", "anheng.view", "anheng.test",
                    "outbound.view", "outbound.create", "outbound.relabel", "outbound.pick",
                    "outbound.pack", "outbound.ship", "inventory_query.view", "inventory_query.detail",
                    "inventory_query.adjust", "pricing.view", "cost.view", "cost.export",
                    "sync.view", "sync.retry", "sync.export", "operation_log.view",
                    "profit_analysis.view", "async_io.import", "async_io.export"
            )),
            Map.entry("采购", List.of(
                    "dashboard.view", "dashboard.kpi_products", "dashboard.kpi_suppliers", "dashboard.kpi_purchase",
                    "dashboard.pipeline_domestic", "products.view", "suppliers.view", "purchase.view",
                    "purchase.create", "purchase.mark_paid", "purchase.export", "sku_query.export",
                    "logistics_wh.view", "logistics_wh.receive", "logistics_wh.export", "create_inbound.view",
                    "create_inbound.create", "create_inbound.label", "mingrui.view", "mingrui.manage",
                    "warehouse_location.view", "inbound.view", "inventory_query.view", "inventory_query.detail",
                    "outbound.view", "outbound.create", "pricing.view", "sync.view"
            )),
            Map.entry("销售", List.of(
                    "dashboard.view", "dashboard.kpi_leads", "leads_pool.view", "leads_pool.create",
                    "leads_follow.view", "leads_follow.edit", "leads_deals.view", "leads_deals.edit",
                    "leads_reports.view", "leads_pool.export", "leads_deals.export", "leads_reports.export"
            )),
            Map.entry("销售主管", List.of(
                    "dashboard.view", "dashboard.kpi_leads", "leads_pool.view", "leads_pool.create",
                    "leads_pool.assign", "leads_pool.view_all", "leads_follow.view", "leads_follow.edit",
                    "leads_deals.view", "leads_deals.edit", "leads_reports.view", "leads_pool.export",
                    "leads_deals.export", "leads_reports.export", "operation_log.view", "async_io.export"
            )),
            Map.entry("财务", List.of(
                    "dashboard.view", "dashboard.kpi_purchase", "dashboard.kpi_sync", "dashboard.pipeline_domestic",
                    "products.view", "purchase.view", "cost.view", "cost.export",
                    "operating_ledger.view", "operating_ledger.manage", "operating_ledger.export", "billing.view",
                    "billing.generate", "billing.manual", "billing.export", "wms_reports.view",
                    "inbound_fee.view", "inbound_fee.manage", "receivable_payable.view", "receivable_payable.manual",
                    "receivable_payable.export", "reports.view", "profit_analysis.view", "budget_credit.view",
                    "budget_credit.create", "budget_credit.export", "async_io.export"
            )),
            Map.entry("产品开发主管", List.of(
                    "dashboard.view", "dashboard.kpi_products", "dashboard.kpi_audit", "dashboard.pipeline_domestic",
                    "products.view", "products.edit", "products.import", "products.print_label",
                    "products.export", "sku_query.export", "product_dev.view", "product_dev.create",
                    "product_dev.edit", "product_audit.view", "product_audit.approve", "product_audit.reject",
                    "product_audit.label", "product_audit.purchase_qty", "pricing.view", "pricing.set",
                    "inventory_query.view", "inventory_query.detail", "inventory_query.adjust", "operation_log.view",
                    "async_io.import", "async_io.export", "store_monitor.view", "store_monitor.view_all",
                    "store_monitor.assign"
            )),
            Map.entry("产品开发", List.of(
                    "dashboard.view", "dashboard.kpi_products", "products.view", "product_dev.view",
                    "product_dev.create", "product_dev.edit", "inventory_query.view", "inventory_query.detail",
                    "inventory_query.adjust", "sku_query.export", "store_monitor.view", "store_monitor.view_all"
            )),
            Map.entry("陪跑", List.of(
                    "dashboard.view", "dashboard.kpi_products", "products.view", "pricing.view",
                    "pricing.set", "pricing.sync_oms", "inventory_query.view"
            )),
            Map.entry("陪跑1", List.of(
                    "dashboard.view", "dashboard.kpi_products", "products.view", "pricing.view",
                    "pricing.set", "pricing.sync_oms", "inventory_query.view", "store_monitor.view"
            )),
            Map.entry("陪跑2", List.of(
                    "dashboard.view", "dashboard.kpi_products", "products.view", "pricing.view",
                    "pricing.set", "pricing.sync_oms", "inventory_query.view", "store_monitor.view"
            )),
            Map.entry("运营", List.of(
                    "dashboard.view", "dashboard.kpi_inventory", "dashboard.kpi_products", "dashboard.pipeline_overseas",
                    "products.view", "pricing.view", "pricing.set", "pricing.sync_oms",
                    "store_monitor.view", "store_monitor.view_all", "inventory_query.view", "inventory_query.detail",
                    "inbound.view", "outbound.view"
            )),
            Map.entry("运营主管", List.of(
                    "dashboard.view", "dashboard.kpi_inventory", "dashboard.kpi_products", "dashboard.pipeline_overseas",
                    "products.view", "pricing.view", "pricing.set", "pricing.sync_oms",
                    "store_monitor.view", "store_monitor.view_all", "store_monitor.assign", "store_monitor.manage",
                    "inventory_query.view", "inventory_query.detail", "inbound.view", "outbound.view",
                    "operation_log.view", "async_io.export"
            )),
            Map.entry("仓库", List.of(
                    "dashboard.view", "dashboard.kpi_inventory", "dashboard.kpi_products", "dashboard.kpi_sync",
                    "dashboard.trends_logistics", "dashboard.pipeline_overseas", "products.view", "products.print_label",
                    "logistics_wh.view", "logistics_wh.receive", "logistics_wh.manage", "create_inbound.view",
                    "create_inbound.create", "create_inbound.label", "warehouse_location.view", "warehouse_location.edit",
                    "warehouse_location.batch_create", "inbound.view", "inbound.arrival_scan", "inbound.receive",
                    "inbound.qc", "inbound.putaway", "inbound.confirm_diff", "return.view",
                    "return.receive", "return.process", "return.export", "anheng.view",
                    "anheng.test", "outbound.view", "outbound.create", "outbound.relabel",
                    "outbound.pick", "outbound.pack", "outbound.ship", "outbound.export",
                    "inventory_query.view", "inventory_query.detail", "inventory_query.adjust", "inventory_query.export",
                    "stocktake.view", "stocktake.create", "stocktake.count", "stocktake.approve",
                    "capacity.view", "capacity.manage", "wms_reports.view", "wms_reports.export",
                    "sync.view", "sync.retry", "operation_log.view"
            )),
            Map.entry("仓库操作", List.of(
                    "dashboard.view", "dashboard.kpi_inventory", "dashboard.kpi_products", "dashboard.kpi_sync",
                    "dashboard.trends_logistics", "dashboard.pipeline_overseas", "products.view", "products.print_label",
                    "logistics_wh.view", "logistics_wh.receive", "logistics_wh.manage", "create_inbound.view",
                    "create_inbound.create", "create_inbound.label", "warehouse_location.view", "warehouse_location.edit",
                    "warehouse_location.batch_create", "inbound.view", "inbound.arrival_scan", "inbound.receive",
                    "inbound.qc", "inbound.putaway", "inbound.confirm_diff", "return.view",
                    "return.receive", "return.process", "return.export", "anheng.view",
                    "anheng.test", "outbound.view", "outbound.create", "outbound.relabel",
                    "outbound.pick", "outbound.pack", "outbound.ship", "outbound.export",
                    "inventory_query.view", "inventory_query.detail", "inventory_query.adjust", "inventory_query.export",
                    "stocktake.view", "stocktake.create", "stocktake.count", "capacity.view",
                    "wms_reports.view", "wms_reports.export", "sync.view"
            )),
            Map.entry("仓库主管", List.of(
                    "dashboard.view", "dashboard.kpi_inventory", "dashboard.kpi_products", "dashboard.kpi_sync",
                    "dashboard.trends_logistics", "dashboard.pipeline_overseas", "products.view", "products.print_label",
                    "logistics_wh.view", "logistics_wh.receive", "logistics_wh.manage", "logistics_wh.export",
                    "create_inbound.view", "create_inbound.create", "create_inbound.label", "warehouse_location.view",
                    "warehouse_location.edit", "warehouse_location.batch_create", "inbound.view", "inbound.arrival_scan",
                    "inbound.receive", "inbound.qc", "inbound.putaway", "inbound.handle_exception",
                    "inbound.confirm_diff", "return.view", "return.receive", "return.process",
                    "return.export", "anheng.view", "anheng.test", "outbound.view",
                    "outbound.create", "outbound.relabel", "outbound.pick", "outbound.pack",
                    "outbound.ship", "outbound.export", "inventory_query.view", "inventory_query.detail",
                    "inventory_query.adjust", "inventory_query.export", "stocktake.view", "stocktake.create",
                    "stocktake.count", "stocktake.approve", "capacity.view", "capacity.manage",
                    "wms_reports.view", "wms_reports.export", "sync.view", "sync.retry",
                    "sync.export", "operation_log.view"
            )),
            Map.entry("入库员", List.of(
                    "dashboard.view", "dashboard.kpi_inventory", "dashboard.pipeline_overseas", "products.view",
                    "products.print_label", "warehouse_location.view", "inbound.view", "inbound.arrival_scan",
                    "inbound.receive", "inbound.qc", "inbound.putaway", "anheng.view",
                    "anheng.test", "inventory_query.view", "inventory_query.detail", "inventory_query.export"
            )),
            Map.entry("出库员", List.of(
                    "dashboard.view", "dashboard.kpi_inventory", "dashboard.pipeline_overseas", "products.view",
                    "outbound.view", "outbound.relabel", "outbound.pick", "outbound.pack",
                    "outbound.ship", "outbound.export", "inventory_query.view", "inventory_query.detail",
                    "inventory_query.export"
            )),
            Map.entry("退货员", List.of(
                    "dashboard.view", "dashboard.kpi_inventory", "products.view", "warehouse_location.view",
                    "return.view", "return.receive", "return.process", "return.export",
                    "inbound.view", "inventory_query.view", "inventory_query.detail"
            )),
            Map.entry("复核员", List.of(
                    "dashboard.view", "dashboard.kpi_inventory", "products.view", "outbound.view",
                    "outbound.pack", "outbound.export", "inventory_query.view"
            ))
    );

    public static List<String> defaultPermsForRoleCode(String roleCode) {
        String key = ROLE_CODE_TEMPLATE.get(roleCode);
        if (key == null) {
            return List.of();
        }
        return ROLE_PERM_TEMPLATES.getOrDefault(key, List.of());
    }
}
