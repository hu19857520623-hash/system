package com.takealot.pda.data

import com.google.gson.JsonElement

fun validateStocktakeWork(plan: StocktakePlan, warehouseCode: String) {
    if (warehouseCode.isBlank()) throw ErpException("请先在首页选择作业仓库")
    if (plan.warehouseCode != warehouseCode) throw ErpException("该盘点单不属于当前作业仓库，请返回首页核对仓库")
    if (plan.statusKey != "counting") throw ErpException("当前盘点单不在盘点中，请返回任务列表刷新后继续")
}

internal data class StocktakeCountRequest(val lineId: Int, val qty: Int, val stage: String)

internal fun JsonElement.readStocktakeCountRequest(): StocktakeCountRequest {
    val failure = ErpException("原盘点请求缺少明细、实盘数量或阶段，请由主管核对", retriable = true)
    val body = takeIf { it.isJsonObject }?.asJsonObject ?: throw failure
    fun number(key: String) = body.get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }
        ?.asString?.toIntOrNull()
    val lineId = number("lineId")?.takeIf { it > 0 } ?: throw failure
    val qty = number("qty")?.takeIf { it >= 0 } ?: throw failure
    val stage = body.get("expectedStage")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }
        ?.asString?.takeIf { it == "pending" || it == "recount" } ?: throw failure
    return StocktakeCountRequest(lineId, qty, stage)
}

internal fun requireStocktakeCountReceipt(
    plan: StocktakePlan?, expectedId: Int, expectedNo: String?, request: StocktakeCountRequest,
    actorId: Int, expectedSku: String, expectedWarehouse: String? = null,
): StocktakePlan {
    val failure = ErpException("盘点回执与原单、明细、实盘数量或作业账号不一致，请到「待同步记录」核对原请求", retriable = true)
    if (plan == null || plan.id != expectedId || plan.no.isBlank() || plan.warehouseCode.isNullOrBlank() ||
        (!expectedNo.isNullOrBlank() && plan.no != expectedNo) ||
        (expectedWarehouse != null && plan.warehouseCode != expectedWarehouse) ||
        plan.statusKey !in setOf("counting", "pending_approval", "completed", "cancelled")
    ) throw failure
    val line = plan.lineList.singleOrNull { it.id == request.lineId } ?: throw failure
    if (!line.skuCode.equals(expectedSku, ignoreCase = true) || expectedSku.isBlank()) throw failure
    val (qty, counter) = if (request.stage == "pending") line.firstQty to line.firstCountedBy
        else line.secondQty to line.secondCountedBy
    if (line.statusKey !in setOf("recount", "matched", "variance") ||
        (request.stage == "recount" && line.statusKey == "recount") ||
        qty != request.qty || actorId <= 0 || counter != actorId
    ) throw failure
    return plan
}

internal fun StocktakePlan.countExitMessage(userId: Int): String? = when (statusKey) {
    "pending_approval" -> "盘点完成，等待审批"
    "completed" -> "本单已完成盘点"
    "cancelled" -> "本单已取消盘点"
    "counting" -> {
        val open = lineList.filter { it.isOpen }
        if (open.isNotEmpty() && open.all { it.statusKey == "recount" && it.firstCountedBy == userId }) {
            "本账号的盘点已完成，剩余明细请交给另一名作业员复盘"
        } else null
    }
    else -> null
}
