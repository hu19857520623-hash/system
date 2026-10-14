"""Regenerate the read-only flow dictionary from Prisma schemas and route declarations."""
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SCALARS={'String','Int','BigInt','Float','Decimal','Boolean','DateTime','Json','Bytes'}
EXCLUDED={'PortalUser','PaymentMethod','WcsDeviceConfig'}
def stage(name):
    for pattern,label in [('Inbound','入库'),('Outbound|PickAllocation','出库'),('Return','退件'),('Inventory|Stocktake|Capacity|Warehouse','库存与仓库'),('Purchase|Supplier|LogisticsReceipt|Mingrui','采购与中转'),('Lead','线索与成交'),('Billing|Fee|Recharge|Cost|Ledger|Profit|Rent|PriceTemplate','费用与结算'),('Product|CodeMapping|PlatformSku|QcReport','商品与 SKU'),('Customer|Store|Region|Catalog|Order','客户与订单'),('Sync|Webhook|Operation|Async|Announcement|Message|Wcs','同步与作业日志')]:
        if re.search(pattern,name):return label
    return '其他业务'
tables=[]
for system,path in [('ERP','erp/backend/prisma/schema.prisma'),('OMS','oms/prisma/schema.prisma')]:
    text=(ROOT/path).read_text(encoding='utf-8')
    blocks=list(re.finditer(r'^model (\w+) \{(.*?)^\}',text,re.M|re.S))
    for match in blocks:
        name,body=match.group(1,2)
        if name.startswith('Sys') or name in EXCLUDED:continue
        table_match=re.search(r'@@map\("([\w]+)"\)',body)
        if not table_match:continue
        fields=[];relations=[]
        line=text[:match.start()].count('\n')+1
        for offset,row in enumerate(body.splitlines(),1):
            field=re.match(r'\s*(\w+)\s+(\w+)([?\[\]]*)\s*(.*)',row)
            if not field:continue
            key,kind,suffix,tail=field.groups()
            if kind not in SCALARS:
                rel=re.search(r'@relation\([^\n]*fields:\s*\[([^\]]+)\][^\n]*references:\s*\[([^\]]+)\]',tail)
                if rel:relations.append({'target':kind,'fields':[x.strip() for x in rel[1].split(',')],'references':[x.strip() for x in rel[2].split(',')], 'kind':'schema 声明'})
                continue
            if re.search(r'password|secret|token|apiKey|permissions',key,re.I):continue
            mapped=re.search(r'@map\("(\w+)"\)',tail)
            fields.append({'name':key,'column':mapped[1] if mapped else key,'type':kind,'nullable':'?' in suffix,'primary':'@id' in tail,'comment':tail.split('//',1)[1].strip() if '//' in tail else '', 'line':line+offset})
        tables.append({'system':system,'model':name,'table':table_match[1],'stage':stage(name),'source':path,'fields':fields,'relations':relations})
# Service code also joins these explicit business IDs without Prisma @relation.
# Keep their provenance distinct from declared schema relations.
id_links={'ERP':{'productId':'Product','inboundId':'InboundOrder','inboundItemId':'InboundOrderItem','outboundId':'OutboundOrder','outboundItemId':'OutboundOrderItem','returnId':'ReturnOrder','poId':'PurchaseOrder','pricingId':'ProductPricing','locationId':'WarehouseLocation','customerId':'Customer'},'OMS':{'customerId':'CustomerAccount'}}
for table in tables:
    linked={f for rel in table['relations'] for f in rel['fields']}
    for field in table['fields']:
        target=id_links[table['system']].get(field['name'])
        if target and field['name'] not in linked:
            table['relations'].append({'target':target,'fields':[field['name']],'references':['id'],'kind':'业务 ID 关联约定，非 schema 外键'})
endpoints=[]
for path in sorted((ROOT/'erp/backend/src/modules').rglob('*.controller.ts')):
    if path.parent.name in {'auth','users','permissions'}:continue
    text=path.read_text(encoding='utf-8');base=re.search(r"@Controller\(['\"]([^'\"]*)",text)
    if not base:continue
    for match in re.finditer(r"@(Get|Post|Put|Patch|Delete)\(\s*(?:['\"]([^'\"]*)['\"])?\s*\)",text):
        segment=text[match.end():];fn=re.search(r'^\s*(?:async\s+)?(\w+)\s*\(',segment,re.M)
        if not fn:continue
        name=fn[1];line=text[:match.start()].count('\n')+1
        routes='/api/'+base[1]+('/'+match[2] if match[2] else '')
        # This is a source excerpt, not an invented DTO contract.
        next_route=re.search(r'\n\s*@(?:Get|Post|Put|Patch|Delete)\(',segment)
        excerpt=segment[:next_route.start() if next_route else len(segment)].strip()[:3000]
        endpoints.append({'system':'ERP','method':match[1].upper(),'path':routes,'handler':name,'stage':stage(path.parent.name.title().replace('-','')),'source':path.relative_to(ROOT).as_posix(),'line':line,'declaration':excerpt})
path=ROOT/'oms/server/index.ts';text=path.read_text(encoding='utf-8')
for match in re.finditer(r"app\.(get|post|put|patch|delete)\(\s*['\"]([^'\"]+)['\"]",text):
    if '/auth/' in match[2] or 'bootstrap' in match[2]:continue
    endpoints.append({'system':'OMS','method':match[1].upper(),'path':match[2],'handler':'Express handler','stage':stage(match[2].title()),'source':'oms/server/index.ts','line':text[:match.start()].count('\n')+1,'declaration':text[match.end():match.end()+1200]})
flows=[
 {'name':'商品身份','from':'OMS 建品 / ERP 采购商品','to':'SKU 查询 → 入库明细 → 库存 → 出库明细','fields':'customerCode / customerId / customerSku / internalSku / sku / productId','rule':'客户 SKU 用于显示；内部 SKU 用于系统关联。SKU 必须同时核对客户及仓库。'},
 {'name':'预约入库','from':'OMS InboundOrder','to':'ERP inbound_order / inbound_order_item / inbound_carton','fields':'inboundNo / warehouse / warehouseCode / lineItems / expectedQty / boxCount','rule':'OMS warehouse 别名映射为 ERP warehouseCode；同一 inboundNo 以 ERP 作业状态为准。'},
 {'name':'收货与清点','from':'PDA / ERP 到仓与清点','to':'ERP 入库 → OMS 入库状态','fields':'receivedCartonCount / actualQty / diffQty / qcStatus / lengthCm / widthCm / heightCm / weightKg','rule':'箱数和 SKU 件数分别确认；零实收不产生库存，需要填写原因结束。'},
 {'name':'上架','from':'入库清点明细','to':'库位批次 → ERP inventory → OMS inventory','fields':'inboundItemId / locationCode / putawayQty / availableQty / lockedQty / pendingShelving','rule':'同一客户、内部 SKU、仓库的 ERP 库存与 OMS 镜像不能相加。'},
 {'name':'出库与费用','from':'OMS OutboundOrder → ERP OutboundOrder','to':'PDA 拣货 / 装箱 / 发运 → OMS 费用对账','fields':'outboundNo / referenceNo / trackingNo / lengthCm / widthCm / heightCm / weightKg / measureSnapshot / actualFeesTotal / settlementDelta','rule':'使用测量值和订单费率快照计算实际费用，预扣与实扣分开。'},
 {'name':'退件','from':'出库 / 退件订单','to':'退件清点 → 重新入库或其他处理 → 费用','fields':'returnNo / outboundNo / customerCode / sku / quantity / disposition / status','rule':'关联记录以实际 schema 关系为准；未声明外键的单号关联在实时视图中按相同单号匹配。'},
]
result={'version':1,'tables':tables,'endpoints':endpoints,'flows':flows,'notes':['字段目录来自源码，不代表每个接口都会返回每个数据库字段。','接口页展示真实路由及源码声明；any 类型接口需结合实时响应核对字段。','实时视图只读，关联结果有表级上限，缺失表及截断均明确显示。']}
dest=ROOT/'erp/backend/src/modules/flow-debug/catalog.generated.json';dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'{len(tables)} business tables, {sum(len(t["fields"]) for t in tables)} scalar fields, {len(endpoints)} routes')
