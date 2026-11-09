package com.takealot.pda.data

import android.content.Context
import com.google.gson.Gson
import com.google.gson.JsonParser
import com.google.gson.reflect.TypeToken
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Keeps the current handheld task and recent scan attempts on-device.
 * A scan is written before the request is sent, so a connection drop never
 * silently erases what the operator just did. Pending records are retained
 * for reconciliation rather than being replayed automatically.
 */
data class PdaResumeWork(
    val module: String,
    val mode: String,
    val orderId: Int,
    val orderNo: String,
    val updatedAt: Long = System.currentTimeMillis(),
    val ownerId: Int? = null,
    val serverUrl: String? = null,
)

internal fun PdaResumeWork.requireMatchingDetail(detailId: Int, detailWarehouse: String?, workWarehouse: String) {
    if (detailId != orderId || detailWarehouse.isNullOrBlank()) {
        throw ErpException("无法核对原单或所属仓库，请返回首页重试，未完成作业已保留")
    }
    if (detailWarehouse != workWarehouse) {
        throw ErpException("本单属于 $detailWarehouse，请返回首页切换作业仓库后继续")
    }
}

data class PdaScanRecord(
    val id: String = UUID.randomUUID().toString(),
    val module: String,
    val mode: String,
    val scanCode: String,
    val orderId: Int? = null,
    val orderNo: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val state: String = "pending",
    val message: String? = null,
    val retryAction: String? = null,
    val retryQuantity: Int? = null,
    val retryExtra: String? = null,
    val retryEndpoint: String? = null,
    val retryBodyJson: String? = null,
    val ownerId: Int? = null,
    val serverUrl: String? = null,
)

internal val PdaScanRecord.catalogBindingWarehouse: String?
    get() = runCatching {
        JsonParser.parseString(retryBodyJson.orEmpty()).asJsonObject.get("warehouseCode").asString
    }.getOrNull()?.takeIf { it.isNotBlank() }

data class PdaPickProgressLine(
    val id: Int,
    val scannedQty: Int,
    val locationCode: String,
    val taskKey: String? = null,
)

data class PdaPickProgress(
    val orderId: Int,
    val mode: String,
    val lines: List<PdaPickProgressLine>,
    val selectedSku: String? = null,
    val updatedAt: Long = System.currentTimeMillis(),
    val ownerId: Int? = null,
    val serverUrl: String? = null,
)

class PdaWorkJournal(context: Context, private val session: SessionStore) {
    private val prefs = context.getSharedPreferences("pda_work_journal", Context.MODE_PRIVATE)
    private val gson = Gson()
    private val recordsType = object : TypeToken<List<PdaScanRecord>>() {}.type
    private val resumeType = object : TypeToken<List<PdaResumeWork>>() {}.type
    private val pickProgressType = object : TypeToken<List<PdaPickProgress>>() {}.type
    private val _scanRecords = MutableStateFlow(loadRecords())
    val scanRecords = _scanRecords.asStateFlow()
    private var resumeCache: List<PdaResumeWork> = gson.fromJson<List<PdaResumeWork>>(prefs.getString(KEY_RESUMES, null), resumeType).orEmpty()
    private var pickCache: List<PdaPickProgress> = gson.fromJson<List<PdaPickProgress>>(prefs.getString(KEY_PICK_PROGRESS, null), pickProgressType).orEmpty()
    private val writer = JournalPreferenceWriter(
        serialize = { gson.toJson(it) },
        persist = { key, value -> prefs.edit().putString(key, value).commit() },
    )

    fun flushBeforeRequest() = writer.flushBlocking()

    @Synchronized
    fun beginScan(module: String, mode: String, scanCode: String, orderId: Int? = null, orderNo: String? = null): String {
        val scope = session.requestScope()
        val record = PdaScanRecord(
            module = module, mode = mode, scanCode = scanCode, orderId = orderId, orderNo = orderNo,
            ownerId = scope.userId.takeIf { it > 0 }, serverUrl = scope.baseUrl,
        )
        saveRecords(_scanRecords.value + record)
        return record.id
    }

    @Synchronized
    fun acknowledge(id: String, message: String? = null) = update(id, "acknowledged", message)

    @Synchronized
    fun retainForRetry(id: String, message: String? = null) = update(id, "pending", message)

    @Synchronized
    fun fail(id: String, message: String? = null) = update(id, "failed", message)

    @Synchronized
    fun prepareRetry(id: String, action: String, quantity: Int? = null, extra: String? = null) {
        saveRecords(_scanRecords.value.map {
            if (it.id == id) it.copy(retryAction = action, retryQuantity = quantity, retryExtra = extra) else it
        })
    }

    @Synchronized
    fun preparePostRetry(id: String, endpoint: String, body: Map<String, Any?>) {
        val payload = body + ("clientRequestId" to id)
        saveRecords(_scanRecords.value.map {
            if (it.id == id) it.copy(
                retryAction = "post",
                retryEndpoint = endpoint,
                retryBodyJson = gson.toJson(payload),
            ) else it
        })
    }

    fun isRetriable(error: Throwable): Boolean =
        error is IOException || error is CancellationException || (error is ErpException && error.retriable)

    @Synchronized
    fun activate(work: PdaResumeWork) {
        val owner = session.userId.takeIf { it > 0 } ?: return
        val server = session.baseUrl
        val next = resumes().filterNot { it.module == work.module && it.ownerId == owner && it.serverUrl == server } +
            work.copy(ownerId = owner, serverUrl = server)
        resumeCache = next
        writer.enqueue(KEY_RESUMES, next)
    }

    @Synchronized
    fun activateIfNoOtherWork(work: PdaResumeWork) {
        if (resumes().any { it.module == work.module && owns(it.ownerId, it.serverUrl) }) return
        activate(work)
    }

    @Synchronized
    fun active(module: String, mode: String): PdaResumeWork? = resumes().lastOrNull { it.module == module && it.mode == mode && owns(it.ownerId, it.serverUrl) }

    @Synchronized
    fun latestActive(): PdaResumeWork? = resumes().filter { owns(it.ownerId, it.serverUrl) }.maxByOrNull { it.updatedAt }

    @Synchronized
    fun hasUnassignedResume(): Boolean = resumes().any { it.ownerId == null || it.serverUrl == null }

    @Synchronized
    fun clearActive(module: String) {
        resumeCache = resumes().filterNot { it.module == module && owns(it.ownerId, it.serverUrl) }
        writer.enqueue(KEY_RESUMES, resumeCache)
    }

    /** Retire only the stage confirmed by this receipt, even if another job was opened later. */
    @Synchronized
    fun completeOutboundStage(orderId: Int, mode: String) {
        if (active("outbound", mode)?.orderId == orderId) clearActive("outbound")
        clearPickProgress(orderId, mode)
    }

    @Synchronized
    fun savePickProgress(progress: PdaPickProgress) {
        val owner = session.userId.takeIf { it > 0 } ?: return
        val server = session.baseUrl
        val next = pickProgress().filterNot {
            it.orderId == progress.orderId && it.mode == progress.mode && it.ownerId == owner && it.serverUrl == server
        } + progress.copy(ownerId = owner, serverUrl = server)
        pickCache = next
        writer.enqueue(KEY_PICK_PROGRESS, next)
    }

    @Synchronized
    fun pickProgress(orderId: Int, mode: String): PdaPickProgress? = pickProgress().lastOrNull { it.orderId == orderId && it.mode == mode && owns(it.ownerId, it.serverUrl) }

    @Synchronized
    fun clearPickProgress(orderId: Int? = null, mode: String? = null) {
        val next = pickProgress().filterNot { progress ->
            owns(progress.ownerId, progress.serverUrl) && (orderId == null || progress.orderId == orderId) && (mode == null || progress.mode == mode)
        }
        pickCache = next
        writer.enqueue(KEY_PICK_PROGRESS, next)
    }

    private fun update(id: String, state: String, message: String?) {
        saveRecords(_scanRecords.value.map { if (it.id == id) it.copy(state = state, message = message) else it })
    }

    private fun owns(ownerId: Int?, serverUrl: String?): Boolean =
        ownerId != null && ownerId == session.userId && serverUrl == session.baseUrl

    internal fun pendingRecord(id: String): PdaScanRecord? = _scanRecords.value.firstOrNull { it.id == id && it.state == "pending" }

    fun canReplay(record: PdaScanRecord): Boolean = owns(record.ownerId, record.serverUrl)

    fun canSeeRecord(record: PdaScanRecord): Boolean = record.ownerId == null || canReplay(record)

    fun pendingRecords(): List<PdaScanRecord> = _scanRecords.value.filter { it.state == "pending" && canSeeRecord(it) }

    @Synchronized
    fun dismiss(id: String): Boolean {
        val record = _scanRecords.value.firstOrNull { it.id == id } ?: return false
        if (!canSeeRecord(record)) return false
        if (record.state != "failed" && !(record.state == "pending" && record.retryAction == null)) return false
        update(id, "dismissed", "已人工确认")
        return true
    }

    private fun loadRecords(): List<PdaScanRecord> = gson.fromJson<List<PdaScanRecord>>(prefs.getString(KEY_RECORDS, null), recordsType).orEmpty()
    private fun resumes(): List<PdaResumeWork> = resumeCache
    private fun pickProgress(): List<PdaPickProgress> = pickCache
    private fun saveRecords(value: List<PdaScanRecord>) {
        val pending = value.filter { it.state == "pending" }
        val completed = value.filter { it.state != "pending" }.takeLast(MAX_RECORDS)
        val next = (pending + completed).sortedBy { it.createdAt }
        _scanRecords.value = next
        writer.enqueue(KEY_RECORDS, next)
    }

    companion object {
        private const val KEY_RECORDS = "records"
        private const val KEY_RESUMES = "resumes"
        private const val KEY_PICK_PROGRESS = "pick_progress"
        private const val MAX_RECORDS = 120
    }
}
