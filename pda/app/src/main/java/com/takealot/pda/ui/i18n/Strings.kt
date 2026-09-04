package com.takealot.pda.ui.i18n

import com.takealot.pda.PdaApp

fun tr(key: String, vararg args: Any): String {
    val language = PdaApp.instance.language.language.code
    val value = (translations[language]?.get(key) ?: translations["zh"]?.get(key) ?: key)
    return if (args.isEmpty()) value else value.format(*args)
}

private val translations = mapOf(
    "zh" to mapOf(
        "settings" to "设置", "language" to "语言", "greeting" to "你好，%s", "light_work" to "轻量仓库作业",
        "work_warehouse" to "作业仓库", "no_warehouse" to "未选择仓库", "resume" to "继续未完成作业", "my_todo" to "我的待办",
        "inbound_todo" to "入库待办", "outbound_todo" to "出库待办", "tap_to_handle" to "点击处理", "no_todo" to "暂无待办",
        "inbound" to "入库", "outbound" to "出库", "arrival" to "到仓扫描", "arrival_hint" to "只扫入库单号",
        "receive" to "扫箱收货", "receive_hint" to "扫外箱标或 SKU", "qc" to "清点", "qc_hint" to "扫 SKU 或条码累加实收",
        "putaway" to "上架", "putaway_hint" to "扫 SKU 或条码再扫库位", "pick" to "拣货", "pick_hint" to "仅扫本工位已分配的出库单，可按箱扫",
        "review" to "复核", "review_hint" to "逐件扫 SKU 或条码后再提交", "select_warehouse" to "请先选择作业仓", "no_permission" to "无权限",
        "stocktake" to "盘点", "stocktake_hint" to "扫盘点单，按库位清点", "stocktake_todo" to "盘点待办",
        "scan_stocktake" to "扫盘点单号 / 库位 / SKU",
        "login" to "登录", "logging_in" to "登录中…", "server" to "服务器", "username" to "用户名", "password" to "密码",
        "pda_title" to "仓库 PDA", "pda_subtitle" to "入库到仓 / 收货清点 / 上架 / 出库拣货 / 盘点", "account" to "账号", "warehouse_code" to "仓库编码",
        "save" to "保存", "logout" to "退出登录", "back" to "返回", "server_hint" to "仅仓库职位可登录。运营、销售等办公账号请使用电脑端。",
        "scan_inbound" to "扫入库单号", "scan_carton" to "扫外箱标", "scan_sku" to "扫 SKU 或条码", "scan_sku_location" to "扫 SKU / 条码或库位", "scan_outbound" to "扫出库单号",
    ),
    "en" to mapOf(
        "settings" to "Settings", "language" to "Language", "greeting" to "Hello, %s", "light_work" to "Warehouse operations",
        "work_warehouse" to "Working warehouse", "no_warehouse" to "No warehouse selected", "resume" to "Resume unfinished work", "my_todo" to "My tasks",
        "inbound_todo" to "Inbound tasks", "outbound_todo" to "Outbound tasks", "tap_to_handle" to "Tap to work", "no_todo" to "No tasks",
        "inbound" to "Inbound", "outbound" to "Outbound", "arrival" to "Arrival scan", "arrival_hint" to "Scan inbound order no. only",
        "receive" to "Receive cartons", "receive_hint" to "Scan outer-carton label or SKU", "qc" to "Count", "qc_hint" to "Scan SKU or barcode to count received qty",
        "putaway" to "Putaway", "putaway_hint" to "Scan SKU or barcode, then location", "pick" to "Pick", "pick_hint" to "Scan orders assigned to this workstation; carton scan optional",
        "review" to "Review", "review_hint" to "Scan each piece by SKU or barcode, then submit", "select_warehouse" to "Select a working warehouse first", "no_permission" to "No permission",
        "stocktake" to "Stocktake", "stocktake_hint" to "Scan plan, then count by location", "stocktake_todo" to "Stocktake tasks",
        "scan_stocktake" to "Scan plan / location / SKU",
        "login" to "Sign in", "logging_in" to "Signing in…", "server" to "Server", "username" to "Username", "password" to "Password",
        "pda_title" to "Warehouse PDA", "pda_subtitle" to "Arrival / receiving / putaway / picking", "account" to "Account", "warehouse_code" to "Warehouse code",
        "save" to "Save", "logout" to "Sign out", "back" to "Back", "server_hint" to "Warehouse roles only. Office accounts such as operations or sales should use the desktop app.",
        "scan_inbound" to "Scan inbound order no.", "scan_carton" to "Scan outer-carton label", "scan_sku" to "Scan SKU or barcode", "scan_sku_location" to "Scan SKU, barcode or location", "scan_outbound" to "Scan outbound order no.",
    ),
    "af" to mapOf(
        "settings" to "Instellings", "language" to "Taal", "greeting" to "Hallo, %s", "light_work" to "Pakhuisbedrywighede",
        "work_warehouse" to "Werksmagasyn", "no_warehouse" to "Geen pakhuis gekies nie", "resume" to "Gaan voort met onvoltooide werk", "my_todo" to "My take",
        "inbound_todo" to "Inkomende take", "outbound_todo" to "Uitgaande take", "tap_to_handle" to "Tik om te werk", "no_todo" to "Geen take nie",
        "inbound" to "Inkomend", "outbound" to "Uitgaand", "arrival" to "Aankomsskandering", "arrival_hint" to "Skandeer slegs die inkomende bestellingnommer",
        "receive" to "Ontvang kartonne", "receive_hint" to "Skandeer kartonetiket of SKU", "qc" to "Tel", "qc_hint" to "Skandeer SKU om hoeveelheid te tel",
        "putaway" to "Wegpak", "putaway_hint" to "Skandeer SKU of strepieskode, dan ligging", "pick" to "Pluk", "pick_hint" to "Skandeer slegs bestellings vir hierdie stasie; karton-skandering opsioneel",
        "review" to "Kontroleer", "review_hint" to "Skandeer elke stuk se SKU of strepieskode", "select_warehouse" to "Kies eers 'n werksmagasyn", "no_permission" to "Geen toestemming",
        "stocktake" to "Voorraadtelling", "stocktake_hint" to "Skandeer telling, dan tel per ligging", "stocktake_todo" to "Tellingstake",
        "scan_stocktake" to "Skandeer telling / ligging / SKU",
        "login" to "Meld aan", "logging_in" to "Meld aan…", "server" to "Bediener", "username" to "Gebruikersnaam", "password" to "Wagwoord",
        "pda_title" to "Pakhuis PDA", "pda_subtitle" to "Aankoms / ontvangs / wegpak / pluk", "account" to "Rekening", "warehouse_code" to "Pakhuis-kode",
        "save" to "Stoor", "logout" to "Meld af", "back" to "Terug", "server_hint" to "Slegs pakhuisrolle. Kantoorrekeninge soos bedryf of verkope moet die rekenaar-app gebruik.",
        "scan_inbound" to "Skandeer inkomende bestellingnommer", "scan_carton" to "Skandeer kartonetiket", "scan_sku" to "Skandeer SKU", "scan_sku_location" to "Skandeer SKU of ligging", "scan_outbound" to "Skandeer uitgaande bestellingnommer",
    ),
)
