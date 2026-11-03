package com.takealot.pda.data

import com.google.gson.JsonElement
import com.google.gson.JsonParser

/** Keep gateway pages and framework errors out of warehouse operator feedback. */
fun erpFailureMessage(raw: String?, code: Int): String {
    val message = raw.orEmpty().trim()
    return when {
        code == 401 -> "登录已过期，请重新登录后继续未完成作业"
        code == 403 -> "当前账号没有操作权限，请联系主管确认"
        code == 429 -> "操作过于频繁，请稍后重试"
        code >= 500 -> "ERP 服务暂时不可用，请稍后重试；已提交操作请先核对待同步记录"
        message.contains('<') || message.contains('>') -> "服务器响应异常，请稍后重试或联系主管"
        message.any { it in '\u4e00'..'\u9fff' } -> message
        code == 404 -> "未找到对应单据或功能，请核对后重试"
        code == 409 -> "单据状态已变化，请刷新后核对再继续"
        code == 400 || code == 422 -> "提交内容未通过校验，请核对单号、数量及当前作业状态"
        else -> "请求失败，请稍后重试或联系主管（错误码 $code）"
    }
}

fun parseErpResponse(text: String, httpCode: Int): JsonElement {
    val root = runCatching { JsonParser.parseString(text).asJsonObject }.getOrNull()
    val code = root?.get("code")?.let { runCatching { it.asInt }.getOrNull() } ?: httpCode
    val message = root?.get("message")?.let { value ->
        when {
            value.isJsonArray -> value.asJsonArray.mapNotNull { runCatching { it.asString }.getOrNull() }.joinToString("；")
            value.isJsonPrimitive -> runCatching { value.asString }.getOrNull()
            else -> null
        }
    }
    if (httpCode !in 200..299 || code != 0 || root == null) {
        val failureCode = if (httpCode !in 200..299) httpCode else code
        throw ErpException(erpFailureMessage(message, failureCode), failureCode,
            retriable = failureCode in 500..599 || failureCode == 408 || failureCode == 429 || (httpCode in 200..299 && root == null))
    }
    return root.get("data") ?: com.google.gson.JsonNull.INSTANCE
}
