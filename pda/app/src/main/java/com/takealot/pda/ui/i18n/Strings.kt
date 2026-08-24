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
        "inbound" to "入库", "outbound" to "出库", "arrival" to "到仓扫描", "arrival_hint" to "扫入库单 / 跟踪号",
        "receive" to "扫箱收货", "receive_hint" to "扫外箱标或 SKU", "qc" to "清点", "qc_hint" to "扫 SKU 累加实收",
        "putaway" to "上架", "putaway_hint" to "扫 SKU 再扫库位", "pick" to "拣货", "pick_hint" to "扫出库单，按库位拣货",
        "review" to "复核", "review_hint" to "扫 SKU 核对后提交", "select_warehouse" to "请先选择作业仓", "no_permission" to "无权限",
        "login" to "登录", "logging_in" to "登录中…", "server" to "服务器", "username" to "用户名", "password" to "密码",
        "pda_title" to "仓库 PDA", "pda_subtitle" to "入库到仓 / 收货清点 / 上架 / 出库拣货", "account" to "账号", "warehouse_code" to "仓库编码",
        "save" to "保存", "logout" to "退出登录", "back" to "返回",
        "scan_inbound" to "扫入库单 / 跟踪号", "scan_carton" to "扫外箱标", "scan_sku" to "扫 SKU", "scan_sku_location" to "扫 SKU 或库位", "scan_outbound" to "扫出库单号",
    ),
    "en" to mapOf(
        "settings" to "Settings", "language" to "Language", "greeting" to "Hello, %s", "light_work" to "Warehouse operations",
        "work_warehouse" to "Working warehouse", "no_warehouse" to "No warehouse selected", "resume" to "Resume unfinished work", "my_todo" to "My tasks",
        "inbound_todo" to "Inbound tasks", "outbound_todo" to "Outbound tasks", "tap_to_handle" to "Tap to work", "no_todo" to "No tasks",
        "inbound" to "Inbound", "outbound" to "Outbound", "arrival" to "Arrival scan", "arrival_hint" to "Scan inbound order / tracking no.",
        "receive" to "Receive cartons", "receive_hint" to "Scan outer-carton label or SKU", "qc" to "Count", "qc_hint" to "Scan SKU to count received qty",
        "putaway" to "Putaway", "putaway_hint" to "Scan SKU, then location", "pick" to "Pick", "pick_hint" to "Scan outbound order and pick by location",
        "review" to "Review", "review_hint" to "Scan SKU to verify and submit", "select_warehouse" to "Select a working warehouse first", "no_permission" to "No permission",
        "login" to "Sign in", "logging_in" to "Signing in…", "server" to "Server", "username" to "Username", "password" to "Password",
        "pda_title" to "Warehouse PDA", "pda_subtitle" to "Arrival / receiving / putaway / picking", "account" to "Account", "warehouse_code" to "Warehouse code",
        "save" to "Save", "logout" to "Sign out", "back" to "Back",
        "scan_inbound" to "Scan inbound order / tracking no.", "scan_carton" to "Scan outer-carton label", "scan_sku" to "Scan SKU", "scan_sku_location" to "Scan SKU or location", "scan_outbound" to "Scan outbound order no.",
    ),
    "af" to mapOf(
        "settings" to "Instellings", "language" to "Taal", "greeting" to "Hallo, %s", "light_work" to "Pakhuisbedrywighede",
        "work_warehouse" to "Werksmagasyn", "no_warehouse" to "Geen pakhuis gekies nie", "resume" to "Gaan voort met onvoltooide werk", "my_todo" to "My take",
        "inbound_todo" to "Inkomende take", "outbound_todo" to "Uitgaande take", "tap_to_handle" to "Tik om te werk", "no_todo" to "Geen take nie",
        "inbound" to "Inkomend", "outbound" to "Uitgaand", "arrival" to "Aankomsskandering", "arrival_hint" to "Skandeer inkoop- of opsporingsnommer",
        "receive" to "Ontvang kartonne", "receive_hint" to "Skandeer kartonetiket of SKU", "qc" to "Tel", "qc_hint" to "Skandeer SKU om hoeveelheid te tel",
        "putaway" to "Wegpak", "putaway_hint" to "Skandeer SKU, dan ligging", "pick" to "Pluk", "pick_hint" to "Skandeer uitgaande bestelling en pluk per ligging",
        "review" to "Kontroleer", "review_hint" to "Skandeer SKU om te verifieer", "select_warehouse" to "Kies eers 'n werksmagasyn", "no_permission" to "Geen toestemming",
        "login" to "Meld aan", "logging_in" to "Meld aan…", "server" to "Bediener", "username" to "Gebruikersnaam", "password" to "Wagwoord",
        "pda_title" to "Pakhuis PDA", "pda_subtitle" to "Aankoms / ontvangs / wegpak / pluk", "account" to "Rekening", "warehouse_code" to "Pakhuis-kode",
        "save" to "Stoor", "logout" to "Meld af", "back" to "Terug",
        "scan_inbound" to "Skandeer inkomende bestelling / opsporingsnommer", "scan_carton" to "Skandeer kartonetiket", "scan_sku" to "Skandeer SKU", "scan_sku_location" to "Skandeer SKU of ligging", "scan_outbound" to "Skandeer uitgaande bestellingnommer",
    ),
)
