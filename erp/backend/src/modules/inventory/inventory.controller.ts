import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { InventoryService } from './inventory.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@Controller('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @RequireAnyPerm('inventory_query.view', 'logistics_wh.view', 'outbound.view', 'outbound.create')
  @Get()
  query(
    @Query()
    q: PaginationDto & {
      warehouseCode?: string
      warehouseCodes?: string
      warehouseType?: string
      onlyAvailable?: string
      supplierKeyword?: string
      skuCodes?: string
      productCode?: string
      exactSku?: string
      barcode?: string
      category?: string
      qtyType?: string
      qtyMin?: string
      qtyMax?: string
      lowStockOnly?: string
      keyword?: string
      customerKeyword?: string
      dataSource?: string
    },
  ) {
    return this.service.query(q)
  }

  @RequireAnyPerm('inventory_query.view', 'inventory_query.detail', 'outbound.view', 'outbound.create')
  @Get('sku-query')
  skuQuery(
    @Query()
    q: PaginationDto & {
      keyword?: string
      title?: string
      skuCodes?: string
      barcode?: string
      category?: string
      brand?: string
      supplierKeyword?: string
      statusFilter?: string
      stockFilter?: string
      costMin?: string
      costMax?: string
      createdFrom?: string
      createdTo?: string
      updatedFrom?: string
      updatedTo?: string
    },
  ) {
    return this.service.querySkuCatalog(q)
  }

  @RequirePerms('inventory_query.adjust')
  @Patch('sku-query/:id')
  updateSkuCatalogItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.updateSkuCatalogItem(id, body, userId)
  }

  @RequireAnyPerm('inventory_query.view', 'inventory_query.detail', 'outbound.view', 'outbound.create')
  @Get('by-location')
  byLocation(@Query() q: { warehouseCode?: string; sku?: string; locationCode?: string }) {
    return this.service.queryByLocation(q)
  }

  @RequirePerms('inventory_query.adjust')
  @Post('by-location')
  addLocationStock(
    @Body() body: {
      sku: string
      warehouseCode: string
      locationCode: string
      qty: number
      remark?: string
      customerCode: string
    },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.addLocationStock(body, userId)
  }

  @RequirePerms('inventory_query.adjust')
  @Post('location-change')
  changeLocationStock(
    @Body() body: {
      customerCode: string
      sku: string
      warehouseCode: string
      fromLocationCode?: string
      toLocationCode: string
      qty: number
      remark?: string
    },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.applyLocationChange(body, userId)
  }

  @RequirePerms('inventory_query.adjust')
  @Post('location-change/batch')
  batchChangeLocationStock(
    @Body() body: {
      rows?: Array<{
        customerCode: string
        sku: string
        warehouseCode: string
        fromLocationCode?: string
        toLocationCode: string
        qty: number
        remark?: string
      }>
      content?: string
      defaultWarehouse?: string
    },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.batchApplyLocationChange(body, userId)
  }

  @RequirePerms('inventory_query.adjust')
  @Patch('by-location/:id')
  adjustLocation(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { qty?: number; locationCode?: string; remark?: string; customerCode: string },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.updateLocationLine(id, body, userId)
  }

  @RequirePerms('inventory_query.adjust')
  @Post('catalog-reclaim')
  reclaimCatalogHolding(
    @Body() body: { customerCode: string; sku: string; quantity: number; remark?: string },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.reclaimCatalogHolding(body, userId)
  }

  @RequireAnyPerm('inventory_query.view', 'inventory_query.detail', 'logistics_wh.view')
  @Get('catalog-purchases')
  catalogPurchases(
    @Query() q: PaginationDto & { sku?: string; customerCode?: string },
  ) {
    return this.service.catalogPurchases(q)
  }

  @RequireAnyPerm('inventory_query.view', 'inventory_query.detail', 'logistics_wh.view')
  @Get('logs/:sku/outbound')
  outboundLogs(@Param('sku') sku: string, @Query('warehouseCode') warehouseCode?: string) {
    return this.service.outboundLogs(sku, warehouseCode)
  }

  @RequireAnyPerm('inventory_query.view', 'inventory_query.detail', 'logistics_wh.view')
  @Get('logs/:sku')
  logs(@Param('sku') sku: string, @Query('warehouseCode') warehouseCode?: string) {
    return this.service.logs(sku, warehouseCode)
  }
}
