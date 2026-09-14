package com.takealot.pda.scan

data class ScanGuess(
    val typeKey: String,
    val titleKey: String,
    val useKey: String,
    val checkKey: String = typeKey,
)

data class ScanChecklistItem(
    val checkKey: String,
    val titleKey: String,
    val sample: String,
)

object ScanCodeClassifier {
    val checklist = listOf(
        ScanChecklistItem("inbound_no", "scan_type_inbound", "RVAFU0430-260910-0002"),
        ScanChecklistItem("outbound_no", "scan_type_outbound", "DOAFU0167-260910-0005"),
        ScanChecklistItem("carton", "scan_type_carton", "RVAFU0430-260910-0002-1"),
        ScanChecklistItem("location", "scan_type_location", "H-12-2-1"),
        ScanChecklistItem("sku", "scan_type_sku", "AFU0430-719110"),
        ScanChecklistItem("barcode", "scan_type_barcode", "9902316738435"),
        ScanChecklistItem("stocktake", "scan_type_stocktake", "PD-20260903-0012"),
        ScanChecklistItem("measure", "scan_type_measure", "SKU-A|10|20|30"),
    )

    fun classify(raw: String): ScanGuess {
        val code = raw.trim()
        if (code.isEmpty()) return ScanGuess("unknown", "scan_type_unknown", "scan_use_unknown")
        if (code.startsWith("{")) {
            return ScanGuess("measure_json", "scan_type_measure", "scan_use_qc", "measure")
        }
        val pipe = code.split('|', ';', ',')
        if (pipe.size >= 4 && pipe[1].toDoubleOrNull() != null && pipe[2].toDoubleOrNull() != null && pipe[3].toDoubleOrNull() != null) {
            return ScanGuess("measure_pipe", "scan_type_measure", "scan_use_qc", "measure")
        }
        val upper = code.uppercase()
        if (isLocation(upper)) {
            return ScanGuess("location", "scan_type_location", "scan_use_location")
        }
        if (Regex("""^DO[A-Z0-9]+-\d{6}-\d{4}$""").matches(upper) || upper.startsWith("OB-") || upper.startsWith("OUT-") || upper.startsWith("OUT_")) {
            return ScanGuess("outbound_no", "scan_type_outbound", "scan_use_pick")
        }
        if (Regex("""^RV[A-Z0-9]+-\d{6}-\d{4}-\d+$""").matches(upper) || Regex("""^IN[-_].+-C\d{3,}$""").matches(upper)) {
            return ScanGuess("carton", "scan_type_carton", "scan_use_receive")
        }
        if (
            Regex("""^RV[A-Z0-9]+-\d{6}-\d{4}$""").matches(upper) ||
            Regex("""^IPI[A-Z0-9]+\d{6}\d{4}$""").matches(upper) ||
            upper.startsWith("IN-") ||
            upper.startsWith("IN_")
        ) {
            return ScanGuess("inbound_no", "scan_type_inbound", "scan_use_arrival")
        }
        if (Regex("""^PD-\d{8}-""").containsMatchIn(upper)) {
            return ScanGuess("stocktake", "scan_type_stocktake", "scan_use_stocktake")
        }
        if (upper.startsWith("BOX-") || upper.startsWith("BOX_") || Regex("""-C\d{3,}$""").containsMatchIn(upper)) {
            return ScanGuess("carton", "scan_type_carton", "scan_use_receive")
        }
        if (Regex("""^\d{8,14}$""").matches(code)) {
            return ScanGuess("barcode", "scan_type_barcode", "scan_use_sku")
        }
        if (Regex("""^[A-Z][A-Z0-9]{1,12}-[A-Z0-9][A-Z0-9_-]{0,24}$""", RegexOption.IGNORE_CASE).matches(code)) {
            return ScanGuess("sku", "scan_type_sku", "scan_use_sku")
        }
        return ScanGuess("unknown", "scan_type_unknown", "scan_use_unknown")
    }

    private fun isLocation(upper: String): Boolean {
        val parts = upper.split('-').filter { it.isNotBlank() }
        if (parts.size < 3) return false
        val lastTwoNumeric = parts.takeLast(2).all { it.all(Char::isDigit) }
        val aisleLike = parts[0].length <= 6 && parts.drop(1).all { it.length <= 8 }
        return lastTwoNumeric && aisleLike
    }
}
