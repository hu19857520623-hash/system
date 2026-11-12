package com.takealot.pda.data

/**
 * A commit that may already have reached the server must be retried with its
 * original record. Starting another one can post a second request id.
 */
fun pendingCommitMessage(
    records: List<PdaScanRecord>,
    module: String,
    mode: String,
    orderId: Int? = null,
    scanCode: String? = null,
): String? {
    val blocked = records.lastOrNull { record ->
        val sameTarget = record.module == module && record.mode == mode &&
            if (orderId != null) record.orderId == orderId
            else scanCode != null && record.scanCode.equals(scanCode, ignoreCase = true)
        sameTarget && (record.state == "pending" || record.state == "failed" && syncContentMismatch(record.message.orEmpty()))
    } ?: return null
    val label = syncRecordLabel(module, mode)
    if (blocked.state == "failed") {
        return "这条${label}的内容不同。请到待同步页面核对记录并结束本次，不要再次提交。"
    }
    return if (blocked.retryAction != null) {
        "这条${label}的结果尚未确认。请到待同步页面使用「安全重试」，不要再次提交。"
    } else {
        "这条${label}尚未完成。请到待同步页面核对；不能自动重试时，先确认没有入账，再关闭该记录后重新提交。"
    }
}

fun pendingSwitchMessage(records: List<PdaScanRecord>, module: String, orderId: Int): String? {
    val blocked = records.any { record ->
        record.module == module && record.orderId == orderId &&
            (record.state == "pending" || record.state == "failed" && syncContentMismatch(record.message.orEmpty()))
    }
    if (!blocked) return null
    return "本单有请求结果待确认。请先到待同步页面处理，再换单。未完成作业仍保留。"
}
