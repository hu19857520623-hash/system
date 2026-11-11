package com.takealot.pda.data

/** 打开出库单失败时保留已进入的作业，并给出中文恢复说明。 */
fun outboundOpenFailureMessage(hadCurrentOrder: Boolean, error: String?): String {
    val detail = error?.trim()?.takeIf { it.isNotEmpty() } ?: "打开单据失败"
    return if (hadCurrentOrder) "$detail。当前作业已保留，请稍后重试或返回列表"
    else "$detail。请返回列表后重试"
}
