package com.takealot.pda.ui.outbound

import com.takealot.pda.PdaApp
import com.takealot.pda.data.outboundStatusLabel
import kotlinx.coroutines.CancellationException

internal suspend fun continueAfterOutbound(
    orderId: Int,
    completedMode: String,
    confirmed: String,
): String {
    val app = PdaApp.instance
    val api = app.api
    val session = app.session
    val journal = app.workJournal
    val order = try {
        api.outboundDetail(orderId)
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        return "$confirmed。暂未读到单据最新状态，请返回首页重新打开原作业核对。"
    }
    val warehouse = order.warehouseCode
    if (order.id != orderId || order.no.isBlank() || warehouse.isNullOrBlank()) {
        return "$confirmed。暂无法核对原单及所属仓库，请返回首页重新打开原作业。"
    }
    if (warehouse != session.warehouseCode) {
        return "$confirmed。请返回首页切换到 $warehouse，再核对单据最新进度。"
    }
    val nextMode = if (order.isProblem) null else when (order.statusKey) {
        "picked", "reviewing" -> if (completedMode == "pick") "review" else null
        "packed" -> if (completedMode != "ship") "ship" else null
        else -> null
    }
    if (nextMode != null) {
        val stage = if (nextMode == "review") "复核" else "发运"
        val permission = if (nextMode == "review") "outbound.pack" else "outbound.ship"
        if (session.hasPerm(permission)) {
            val saved = journal.advanceOutboundStage(orderId, order.no, completedMode, nextMode)
            return if (saved) "$confirmed。请返回首页打开「继续未完成作业」，进入$stage。"
            else "$confirmed。请从首页进入「$stage」并选择原单。"
        }
        journal.completeOutboundStage(orderId, completedMode)
        return "$confirmed。请交接给有${stage}权限的人员继续。"
    }
    if (order.isProblem || order.statusKey == "pending_relabel" ||
        order.statusKey in setOf("shipped", "delivered", "partial_delivered", "delivery_failed", "completed", "cancelled")) {
        journal.completeOutboundStage(orderId, completedMode)
    }
    return when {
        order.isProblem -> "$confirmed。单据存在异常，请联系主管核对后继续。"
        order.statusKey == "pending_relabel" -> "$confirmed。单据待换标，请完成换标后再发运。"
        else -> "$confirmed。单据当前为「${outboundStatusLabel(order.statusKey)}」，请返回首页核对。"
    }
}

