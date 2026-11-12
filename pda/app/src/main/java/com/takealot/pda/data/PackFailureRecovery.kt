package com.takealot.pda.data

fun outboundProgressChanged(message: String): Boolean {
    if (listOf("不要修改", "勿修改", "内容不同", "已用于其他内容", "结束本次").any { message.contains(it) }) return false
    return message.contains("请重新读取") || message.contains("已变更") || message.contains("状态已变化")
}

fun outboundFinishedNotice(action: String, orderNo: String, message: String, statusKey: String): String? {
    if (listOf("不要修改", "勿修改", "内容不同", "已用于其他内容", "结束本次").any { message.contains(it) }) return null
    val done = when (action) {
        "pick" -> statusKey in setOf("picked", "reviewing", "pending_relabel", "packed", "shipped", "delivered", "partial_delivered")
        "pack" -> statusKey in setOf("pending_relabel", "packed", "shipped", "delivered", "partial_delivered")
        "ship" -> statusKey in setOf("shipped", "delivered", "partial_delivered")
        else -> false
    }
    val recognizable = message.contains("勿修改后重试") || message.contains("状态已变化") || message.contains("当前状态不可") || message.contains("请核对原")
    if (!done || !recognizable) return null
    return when (action) {
        "pick" -> "$orderNo 拣货已完成，请返回列表继续"
        "ship" -> "$orderNo 已发运，请返回列表继续下一单"
        else -> "$orderNo 复核已完成，请返回列表继续下一单"
    }
}

fun packFailureAlreadyFinished(message: String, statusKey: String) =
    outboundFinishedNotice("pack", "单", message, statusKey) != null
