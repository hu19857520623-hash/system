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
            Map.entry("ops_manager", "采购主管"),
            Map.entry("purchaser", "采购"),
            Map.entry("finance", "财务"),
            Map.entry("cs", "销售"),
            Map.entry("sales_manager", "销售主管"),
            Map.entry("coach", "陪跑"),
            Map.entry("coach1", "陪跑1"),
            Map.entry("coach2", "陪跑2"),
            Map.entry("viewer", "产品开发"),
            Map.entry("warehouse", "仓库"),
            Map.entry("dev_manager", "产品开发主管")
    );

    private static final Map<String, List<String>> ROLE_PERM_TEMPLATES = Map.ofEntries(
            Map.entry("系统管理员", List.of(
                    "leads_pool.view", "leads_pool.create", "leads_pool.assign", "leads_pool.view_all",
                    "leads_follow.view", "leads_follow.edit", "leads_deals.view", "leads_deals.edit",
                    "leads_reports.view", "products.view", "products.edit", "products.import",
                    "product_dev.view", "product_dev.create", "product_dev.edit", "pricing.view",
                    "pricing.set", "pricing.sync_oms", "pricing.freight_callback", "product_audit.view",
                    "product_audit.approve", "product_audit.reject", "product_audit.label", "product_audit.purchase_qty",
                    "suppliers.view", "suppliers.edit", "purchase.view", "purchase.create",
                    "purchase.assign", "purchase.po_audit", "purchase.finance_audit", "logistics_wh.view",
                    "logistics_wh.receive", "logistics_wh.manage", "create_inbound.view", "create_inbound.create",
                    "create_inbound.label", "warehouse_location.view", "warehouse_location.edit", "warehouse_location.batch_create",
                    "inbound.view", "inbound.arrival_scan", "inbound.receive", "inbound.qc",
                    "inbound.putaway", "inbound.handle_exception", "inbound.confirm_diff", "return.view",
                    "return.receive", "return.process", "outbound.view", "outbound.create",
                    "outbound.relabel", "outbound.pick", "outbound.pack", "outbound.ship",
                    "inventory_query.view", "inventory_query.detail", "inventory_query.adjust", "cost.view",
                    "sync.view", "sync.retry", "operation_log.view", "billing.view",
                    "billing.generate", "billing.manual", "receivable_payable.view", "receivable_payable.manual",
                    "reports.view", "profit_analysis.view", "budget_credit.view", "budget_credit.create",
                    "async_io.import", "async_io.export", "permissions.view", "permissions.manage",
                    "store_monitor.view", "store_monitor.view_all", "store_monitor.manage", "store_monitor.assign"
            )),
            Map.entry("采购主管", List.of(
                    "products.view", "suppliers.view", "suppliers.edit", "pricing.view",
                    "pricing.freight_callback", "purchase.view", "purchase.create", "purchase.assign",
                    "purchase.po_audit", "logistics_wh.view", "logistics_wh.receive", "logistics_wh.manage",
                    "create_inbound.view", "create_inbound.create", "create_inbound.label", "warehouse_location.view",
                    "warehouse_location.edit", "warehouse_location.batch_create", "inbound.view", "inbound.arrival_scan",
                    "inbound.receive", "inbound.qc", "inbound.putaway", "inbound.handle_exception",
                    "inbound.confirm_diff", "outbound.view", "outbound.create", "outbound.relabel",
                    "outbound.pick", "outbound.pack", "outbound.ship", "inventory_query.view",
                    "inventory_query.detail", "inventory_query.adjust", "cost.view", "sync.view",
                    "sync.retry", "operation_log.view", "profit_analysis.view", "async_io.import",
                    "async_io.export"
            )),
            Map.entry("采购", List.of(
                    "products.view", "suppliers.view", "pricing.view", "pricing.freight_callback",
                    "purchase.view", "purchase.create", "logistics_wh.view", "logistics_wh.receive",
                    "create_inbound.view", "create_inbound.create", "create_inbound.label", "warehouse_location.view",
                    "inbound.view", "inventory_query.view", "inventory_query.detail", "outbound.view",
                    "outbound.create", "sync.view"
            )),
            Map.entry("销售", List.of(
                    "leads_pool.view", "leads_pool.create", "leads_follow.view", "leads_follow.edit",
                    "leads_deals.view", "leads_deals.edit", "leads_reports.view"
            )),
            Map.entry("销售主管", List.of(
                    "leads_pool.view", "leads_pool.create", "leads_pool.assign", "leads_pool.view_all",
                    "leads_follow.view", "leads_follow.edit", "leads_deals.view", "leads_deals.edit",
                    "leads_reports.view", "operation_log.view", "async_io.export"
            )),
            Map.entry("财务", List.of(
                    "products.view", "purchase.view", "purchase.finance_audit", "cost.view",
                    "billing.view", "billing.generate", "billing.manual", "receivable_payable.view",
                    "receivable_payable.manual", "reports.view", "profit_analysis.view", "budget_credit.view",
                    "budget_credit.create", "async_io.export"
            )),
            Map.entry("产品开发主管", List.of(
                    "products.view", "products.edit", "products.import", "product_dev.view",
                    "product_dev.create", "product_dev.edit", "product_audit.view", "product_audit.approve",
                    "product_audit.reject", "product_audit.label", "product_audit.purchase_qty", "pricing.view",
                    "pricing.set", "inventory_query.view", "inventory_query.detail", "inventory_query.adjust",
                    "operation_log.view", "async_io.import", "async_io.export", "store_monitor.view",
                    "store_monitor.view_all", "store_monitor.assign"
            )),
            Map.entry("产品开发", List.of(
                    "products.view", "product_dev.view", "product_dev.create", "product_dev.edit",
                    "inventory_query.view", "inventory_query.detail", "inventory_query.adjust", "store_monitor.view",
                    "store_monitor.view_all"
            )),
            Map.entry("陪跑", List.of(
                    "products.view", "pricing.view", "pricing.set", "pricing.sync_oms",
                    "inventory_query.view"
            )),
            Map.entry("陪跑1", List.of(
                    "products.view", "pricing.view", "pricing.set", "pricing.sync_oms",
                    "inventory_query.view", "store_monitor.view"
            )),
            Map.entry("陪跑2", List.of(
                    "products.view", "pricing.view", "pricing.set", "pricing.sync_oms",
                    "inventory_query.view", "store_monitor.view"
            )),
            Map.entry("仓库", List.of(
                    "logistics_wh.view", "logistics_wh.receive", "logistics_wh.manage", "create_inbound.view",
                    "create_inbound.create", "create_inbound.label", "warehouse_location.view", "warehouse_location.edit",
                    "warehouse_location.batch_create", "inbound.view", "inbound.arrival_scan", "inbound.receive",
                    "inbound.qc", "inbound.putaway", "inbound.handle_exception", "inbound.confirm_diff",
                    "outbound.view", "outbound.create", "outbound.relabel", "outbound.pick",
                    "outbound.pack", "outbound.ship", "inventory_query.view", "inventory_query.detail",
                    "inventory_query.adjust", "sync.view", "sync.retry", "operation_log.view"
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
