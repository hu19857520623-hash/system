package com.takealot.pda.data

/** 待同步列表只显示中文作业名称，不把内部模块和动作键直接给仓管看。 */
fun syncRecordLabel(module: String, mode: String): String {
    val moduleLabel = when (module) {
        "inbound" -> "入库"
        "outbound" -> "出库"
        "stocktake" -> "盘点"
        else -> "仓库作业"
    }
    val modeLabel = when {
        mode.startsWith("reduce_") -> "核减${reductionTarget(mode.removePrefix("reduce_"))}"
        mode.startsWith("problem_") -> "问题标记·${problemTarget(mode.removePrefix("problem_"))}"
        else -> when (mode) {
            "arrival" -> "电商入库"
            "receive" -> "确认箱数"
            "qc" -> "清点数量"
            "catalog" -> "货盘入库"
            "putaway" -> "上架"
            "pick" -> "拣货"
            "review" -> "复核"
            "ship" -> "发运"
            "count" -> "盘点扫描"
            "qc_submit" -> "提交清点"
            "measure" -> "测量"
            "resolve_exception" -> "异常放行"
            "catalog_carton_count" -> "货盘确认箱数"
            "carton_count_submit" -> "提交箱数"
            "unknown_barcode" -> "未知条码"
            "pick_submit" -> "提交拣货"
            "pack_submit" -> "提交打包"
            "ship_submit" -> "提交发运"
            "count_submit" -> "提交盘点"
            else -> "继续核对"
        }
    }
    return "$moduleLabel · $modeLabel"
}

fun syncContentMismatch(message: String): Boolean =
    message.contains("不要修改") || message.contains("勿修改") || message.contains("已用于其他内容") || message.contains("内容不同") || message.contains("内容已变化") || message.contains("结束本次")

fun syncRetryAlreadyDone(message: String): Boolean {
    if (syncContentMismatch(message)) return false
    return listOf("未重复", "已处理", "已完成", "已入账", "请按最新").any { message.contains(it) }
}

private fun reductionTarget(kind: String) = when (kind) {
    "carton" -> "箱数"
    "putaway" -> "上架"
    "qc" -> "实收"
    "count" -> "盘点"
    "pick" -> "拣货"
    "review" -> "复核"
    "ship" -> "发运"
    else -> "数量"
}

private fun problemTarget(kind: String) = when (kind) {
    "stock_short" -> "短拣"
    "barcode_issue" -> "未知条码"
    else -> "异常"
}
