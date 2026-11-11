package com.takealot.pda.data

internal class ResumeWorkScope(
    private val ownerId: Int, private val serverUrl: String, private val warehouseCode: String,
) {
    val valid get() = ownerId > 0 && warehouseCode.isNotBlank()

    private fun owns(work: PdaResumeWork) = ownerId > 0 && work.ownerId == ownerId && work.serverUrl == serverUrl
    private fun inWarehouse(work: PdaResumeWork) = valid && owns(work) && work.warehouseCode == warehouseCode

    fun scoped(works: List<PdaResumeWork>, module: String) =
        works.filter { inWarehouse(it) && it.module == module }.maxByOrNull { it.updatedAt }

    fun active(works: List<PdaResumeWork>, module: String? = null, mode: String? = null): PdaResumeWork? {
        if (!valid) return null
        val matches = works.filter { owns(it) && (module == null || it.module == module) }
        val current = matches.filter(::inWarehouse).maxByOrNull { it.updatedAt }
        if (current != null) return current.takeIf { mode == null || it.mode == mode }
        return matches.filter { it.warehouseCode.isNullOrBlank() && (mode == null || it.mode == mode) }
            .maxByOrNull { it.updatedAt }
    }

    /** Match the same records that the destination screens can actually reopen. */
    fun forHome(works: List<PdaResumeWork>, hasPermission: (String) -> Boolean): ResumeHomeWork {
        val candidates = listOf("inbound", "outbound", "stocktake").mapNotNull { active(works, it) }
        val allowed = candidates.filter { it.canResume(hasPermission) }
        return ResumeHomeWork(
            work = allowed.maxWithOrNull(compareBy<PdaResumeWork> { it.warehouseCode == warehouseCode }.thenBy { it.updatedAt }),
            hasRestrictedWork = allowed.size < candidates.size,
        )
    }

    fun hasOtherWarehouse(works: List<PdaResumeWork>) =
        valid && works.any { owns(it) && !it.warehouseCode.isNullOrBlank() && it.warehouseCode != warehouseCode }

    fun activate(works: List<PdaResumeWork>, work: PdaResumeWork): List<PdaResumeWork> =
        works.filterNot {
            owns(it) && it.module == work.module &&
                (inWarehouse(it) || (it.warehouseCode.isNullOrBlank() && it.orderId == work.orderId))
        } + work.copy(ownerId = ownerId, serverUrl = serverUrl, warehouseCode = warehouseCode)

    fun resolveLegacy(
        works: List<PdaResumeWork>, work: PdaResumeWork, detailId: Int, detailNo: String, detailWarehouse: String?,
    ): List<PdaResumeWork> {
        if (!owns(work) || !work.warehouseCode.isNullOrBlank() || detailId != work.orderId ||
            detailNo != work.orderNo || detailWarehouse.isNullOrBlank()) return works
        return works.map { if (it == work) it.copy(warehouseCode = detailWarehouse) else it }
    }

    fun clear(works: List<PdaResumeWork>, module: String, orderId: Int, mode: String? = null): List<PdaResumeWork> =
        works.filterNot {
            owns(it) && it.module == module && it.orderId == orderId && (mode == null || it.mode == mode)
        }
}


internal data class ResumeHomeWork(val work: PdaResumeWork?, val hasRestrictedWork: Boolean)

private fun PdaResumeWork.canResume(hasPermission: (String) -> Boolean): Boolean =
    when (module to mode) {
        "inbound" to "catalog" -> hasPermission("inbound.arrival_scan") && hasPermission("inbound.qc")
        "inbound" to "arrival" -> hasPermission("inbound.arrival_scan")
        "inbound" to "receive" -> hasPermission("inbound.receive") || hasPermission("inbound.qc")
        "inbound" to "qc" -> hasPermission("inbound.qc")
        "inbound" to "putaway" -> hasPermission("inbound.putaway")
        "outbound" to "pick" -> hasPermission("outbound.pick")
        "outbound" to "review" -> hasPermission("outbound.pack")
        "outbound" to "ship" -> hasPermission("outbound.ship")
        "stocktake" to "count" -> hasPermission("stocktake.count")
        else -> false
    }
