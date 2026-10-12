package com.takealot.pda.data

/** Display only. Never use the shortened value in requests or stored product identifiers. */
fun inboundDisplaySku(value: String, customerCode: String?): String {
    val customer = customerCode.orEmpty().trim()
    if (customer.isEmpty()) return value
    val prefix = "$customer-"
    return if (value.startsWith(prefix, ignoreCase = true) && value.length > prefix.length) {
        value.substring(prefix.length)
    } else value
}

/** Strip a known customer prefix at a token boundary, not from document numbers or SKU suffixes. */
fun inboundDisplayMessage(value: String, customerCode: String?): String {
    val customer = customerCode.orEmpty().trim()
    if (customer.isEmpty()) return value
    val prefix = Regex(
        "(?<![\\p{L}\\p{N}_-])${Regex.escape(customer)}-(?=[\\p{L}\\p{N}_])",
        RegexOption.IGNORE_CASE,
    )
    return value.replace(prefix, "")
}
