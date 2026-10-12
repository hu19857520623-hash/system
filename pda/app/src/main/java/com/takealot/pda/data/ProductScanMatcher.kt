package com.takealot.pda.data

import com.google.gson.JsonParser

private val systemCustomerSku = Regex("^TKL[0-9]+-(.+)$", RegexOption.IGNORE_CASE)

/** Remove only a known customer prefix, never an arbitrary SKU segment. */
fun customerSkuForScan(sku: String, customerCode: String? = null): String {
    val value = sku.trim()
    val customer = customerCode.orEmpty().trim()
    if (customer.isNotEmpty()) return inboundDisplaySku(value, customer)
    return systemCustomerSku.matchEntire(value)?.groupValues?.get(1) ?: value
}

fun scanMatchesProduct(code: String, sku: String, vararg aliases: String?, customerCode: String? = null): Boolean {
    val token = code.trim()
    if (token.isEmpty()) return false
    if (sku.trim().equals(token, ignoreCase = true)) return true
    if (customerSkuForScan(sku, customerCode).equals(token, ignoreCase = true)) return true
    return aliases.asSequence()
        .flatMap { it.orEmpty().split(',', '|', ';', ' ') }
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .any { it.equals(token, ignoreCase = true) }
}

fun requireUniqueScanSku(skus: List<String>) {
    if (skus.map { it.trim().uppercase() }.distinct().size > 1) {
        throw ErpException("扫描码匹配到多个 SKU，未计数，请主管核对商品资料")
    }
}

fun InboundOrder.itemForScan(code: String): InboundItem? {
    val hits = itemList.filter { it.matchesScan(code, omsCustomerCode) }
    requireUniqueScanSku(hits.map { it.skuCode })
    return hits.firstOrNull()
}

/** Use the real SKU for the server request, while keeping the original scan in the journal. */
fun InboundOrder.resolveSkuScan(code: String): String {
    val value = code.trim()
    if (value.startsWith("{")) {
        val obj = runCatching { JsonParser.parseString(value).asJsonObject }.getOrNull()
        if (obj != null) {
            val key = listOf("sku", "SKU", "scanCode", "barcode").firstOrNull {
                obj.get(it)?.let { field -> field.isJsonPrimitive && field.asString.isNotBlank() } == true
            }
            if (key != null) {
                val item = itemForScan(obj.get(key).asString)
                if (item != null) {
                    obj.addProperty(key, item.skuCode)
                    return obj.toString()
                }
            }
            return value
        }
    }
    val fields = value.split('|', ';', ',').map { it.trim() }.filter { it.isNotEmpty() }
    if (fields.size >= 4 && fields.subList(1, 4).all { (it.toDoubleOrNull() ?: 0.0) > 0 }) {
        val item = itemForScan(fields.first()) ?: return value
        return (listOf(item.skuCode) + fields.drop(1)).joinToString("|")
    }
    return itemForScan(value)?.skuCode ?: value
}
