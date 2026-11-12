package com.takealot.pda.data

fun inboundProgressChanged(message: String): Boolean {
    if (listOf("不要修改", "勿修改", "内容不同", "已用于其他内容", "结束本次", "不能更改内容").any { message.contains(it) }) return false
    return message.contains("请重新读取") || message.contains("已变更") || message.contains("状态已变化")
}

fun inboundStepFinished(action: String, orderNo: String, message: String, statusKey: String, receivedCartonCount: Int? = null): String? {
    if (listOf("不要修改", "勿修改", "内容不同", "已用于其他内容", "结束本次").any { message.contains(it) }) return null
    val recognizable = listOf(
        "请核对原操作",
        "当前状态",
        "已完结",
        "原仓库操作已处理",
        "原上架操作已处理",
        "原处理已完成",
    ).any { message.contains(it) }
    if (!recognizable) return null
    return when (action) {
        "qc" -> if (statusKey in setOf("pending_putaway", "completed", "confirmed")) "$orderNo 清点已提交，请按最新单据继续上架" else null
        "putaway" -> if (statusKey in setOf("completed", "confirmed")) "$orderNo 上架已完成，请返回列表继续下一单" else null
        "resolve" -> if (statusKey in setOf("receiving", "pending_putaway", "completed", "confirmed")) "$orderNo 异常已处理，请按最新单据继续" else null
        "carton" -> if ((receivedCartonCount ?: 0) > 0 && statusKey in setOf("arrived", "receiving", "pending_putaway", "completed", "confirmed")) "$orderNo 实收箱数已登记，请按最新单据继续" else null
        else -> null
    }
}

fun receiveScanAlreadyRecorded(message: String): Boolean {
    if (message.contains("已用于其他内容") || message.contains("不要修改") || message.contains("勿修改") || message.contains("结束本次")) return false
    return message.contains("原仓库操作已处理") || message.contains("本次未重复执行") || message.contains("请按最新单据核对")
}

fun arrivalFailureShouldLookup(message: String) =
    listOf("已到仓", "已经到仓", "重复扫描", "当前状态", "已用于其他内容", "请勿重复").any { message.contains(it) }

fun arrivalAlreadyProgressed(message: String, statusKey: String): String? {
    if (listOf("不要修改", "勿修改", "内容不同", "已用于其他内容", "结束本次").any { message.contains(it) }) return null
    if (!arrivalFailureShouldLookup(message)) return null
    return when (statusKey) {
        "arrived", "receiving" -> "该单已到仓，请继续确认箱数"
        "pending_putaway", "completed", "confirmed" -> "该单已完成到仓，请返回列表按当前状态继续"
        else -> null
    }
}

enum class MeasureRecovery { Saved, Reload }

fun measureRecovery(message: String, hasMeasuredDims: Boolean): MeasureRecovery? {
    val mismatch = listOf("不要修改", "勿修改", "内容不同", "已用于其他内容", "结束本次").any { message.contains(it) }
    if (mismatch) return null
    val saved = listOf("原仓库操作已处理", "原处理已完成", "请按最新单据").any { message.contains(it) }
    if (saved && hasMeasuredDims) return MeasureRecovery.Saved
    if (listOf("请重新读取", "已变更").any { message.contains(it) }) return MeasureRecovery.Reload
    return null
}
