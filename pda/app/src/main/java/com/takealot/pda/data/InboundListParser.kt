package com.takealot.pda.data

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.reflect.TypeToken

/** ERP 列表也包含 OMS 只读预报；PDA 只能对拥有 ERP 数字 ID 的单据作业。 */
internal fun parseOperationalInboundPage(data: JsonElement, gson: Gson): PageResult<InboundOrder> {
    val page = data.asJsonObject.deepCopy()
    val operational = JsonArray()
    page.getAsJsonArray("items")?.forEach { row ->
        if (!row.isJsonObject) return@forEach
        val item = row.asJsonObject
        val id = item.get("id")?.takeIf { it.isJsonPrimitive }?.asString?.toIntOrNull()
        val readOnly = item.get("readOnly")?.takeIf { it.isJsonPrimitive }?.asString == "true"
        if (id != null && id > 0 && !readOnly) operational.add(item)
    }
    page.add("items", operational)
    return gson.fromJson(page, object : TypeToken<PageResult<InboundOrder>>() {}.type)
}
