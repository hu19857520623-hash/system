import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'

import { PrismaModule } from './common/prisma/prisma.module'
import { PermissionsModule } from './common/permissions/permissions.module'
import { OmsInternalAuthModule } from './common/oms-internal-auth.module'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard'
import { RolesGuard } from './common/guards/roles.guard'
import { PermissionsGuard } from './common/guards/permissions.guard'

import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { ProductsModule } from './modules/products/products.module'
import { SuppliersModule } from './modules/suppliers/suppliers.module'
import { ProductDevModule } from './modules/product-dev/product-dev.module'
import { PurchaseModule } from './modules/purchase/purchase.module'
import { InboundModule } from './modules/inbound/inbound.module'
import { InventoryModule } from './modules/inventory/inventory.module'
import { LeadsModule } from './modules/leads/leads.module'
import { CustomersModule } from './modules/customers/customers.module'
import { BillingModule } from './modules/billing/billing.module'
import { CostModule } from './modules/cost/cost.module'
import { SyncLogModule } from './modules/sync-log/sync-log.module'
import { AsyncIoModule } from './modules/async-io/async-io.module'
import { AnnouncementModule } from './modules/announcement/announcement.module'
import { ProfitModule } from './modules/profit/profit.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { WarehouseModule } from './modules/warehouse/warehouse.module'
import { FreightBillModule } from './modules/freight-bill/freight-bill.module'
import { PricingModule } from './modules/pricing/pricing.module'
import { LogisticsReceiptModule } from './modules/logistics-receipt/logistics-receipt.module'
import { WarehouseLocationModule } from './modules/warehouse-location/warehouse-location.module'
import { OutboundModule } from './modules/outbound/outbound.module'
import { StoreMonitorModule } from './modules/store-monitor/store-monitor.module'
import { OperationLogModule } from './modules/operation-log/operation-log.module'
import { ReturnsModule } from './modules/returns/returns.module'
import { MingruiModule } from './modules/mingrui/mingrui.module'
import { OperatingLedgerModule } from './modules/operating-ledger/operating-ledger.module'
import { validateEnvironment } from './config/environment'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    OmsInternalAuthModule,
    PrismaModule,
    PermissionsModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    SuppliersModule,
    ProductDevModule,
    PurchaseModule,
    InboundModule,
    InventoryModule,
    LeadsModule,
    CustomersModule,
    BillingModule,
    CostModule,
    SyncLogModule,
    AsyncIoModule,
    AnnouncementModule,
    ProfitModule,
    DashboardModule,
    WarehouseModule,
    FreightBillModule,
    PricingModule,
    LogisticsReceiptModule,
    OutboundModule,
    ReturnsModule,
    MingruiModule,
    OperatingLedgerModule,
    StoreMonitorModule,
    WarehouseLocationModule,
    OperationLogModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
