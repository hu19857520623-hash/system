package com.takealot.pda.data

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonParseException
import com.google.gson.reflect.TypeToken

internal fun invalidWorkList(label: String) = ErpException("${label}数据不完整，请重试", retriable = true)

internal fun JsonElement?.requireWorkRows(label: String): JsonArray {
    val rows = this?.takeIf { it.isJsonArray }?.asJsonArray ?: throw invalidWorkList(label)
    if (rows.any { !it.isJsonObject }) throw invalidWorkList(label)
    return rows
}

internal inline fun <reified T : Any> Gson.decodeWorkList(data: JsonElement, label: String): T {
    return try {
        fromJson<T>(data, object : TypeToken<T>() {}.type) ?: throw invalidWorkList(label)
    } catch (_: JsonParseException) {
        throw invalidWorkList(label)
    }
}

internal fun parseWarehouseList(data: JsonElement, gson: Gson): List<Warehouse> {
    val label = "仓库列表"
    val rows = if (data.isJsonObject) data.asJsonObject.get("items") else data
    return gson.decodeWorkList<List<Warehouse>>(rows.requireWorkRows(label), label).also {
        if (it.any { warehouse -> warehouse.code.isBlank() }) throw invalidWorkList(label)
    }
}

internal fun parseStocktakeList(data: JsonElement, gson: Gson): List<StocktakePlan> {
    val label = "盘点任务列表"
    return gson.decodeWorkList<List<StocktakePlan>>(data.requireWorkRows(label), label).also {
        if (it.any { plan -> plan.id <= 0 || plan.no.isBlank() }) throw invalidWorkList(label)
    }
}

internal fun parseOutboundPage(data: JsonElement, gson: Gson): PageResult<OutboundOrder> {
    val label = "出库作业列表"
    data.takeIf { it.isJsonObject }?.asJsonObject?.get("items").requireWorkRows(label)
    return gson.decodeWorkList<PageResult<OutboundOrder>>(data, label).also {
        if (it.items.orEmpty().any { order -> order.id <= 0 || order.no.isBlank() }) throw invalidWorkList(label)
    }
}
