package com.takealot.pda.data

/** Only a scanned physical location authorizes picking; the highlighted row does not. */
fun List<LocalPickLine>.pickTaskAtLocation(location: String?, code: String): LocalPickLine? {
    val verifiedLocation = location?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    requireUniqueScanSku(filter { it.matchesScan(code) }.map { it.sku })
    return firstOrNull {
        !it.done && !it.taskKey.endsWith("@SHORT") &&
            it.locationCode.trim().equals(verifiedLocation, ignoreCase = true) && it.matchesScan(code)
    }
}
