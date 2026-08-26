package com.takealot.pda.data

import android.content.Context
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.IOException
import java.util.UUID

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
)

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
)

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
)

class PdaWorkJournal(context: Context) {
    private val prefs = context.getSharedPreferences("pda_work_journal", Context.MODE_PRIVATE)
    private val gson = Gson()
    private val recordsType = object : TypeToken<List<PdaScanRecord>>() {}.type
    private val resumeType = object : TypeToken<List<PdaResumeWork>>() {}.type
    private val pickProgressType = object : TypeToken<List<PdaPickProgress>>() {}.type

    @Synchronized
    fun beginScan(module: String, mode: String, scanCode: String, orderId: Int? = null, orderNo: String? = null): String {
        val record = PdaScanRecord(module = module, mode = mode, scanCode = scanCode, orderId = orderId, orderNo = orderNo)
        saveRecords((records() + record).takeLast(MAX_RECORDS))
        return record.id
    }

    @Synchronized
    fun acknowledge(id: String, message: String? = null) = update(id, "acknowledged", message)

    @Synchronized
    fun retainForRetry(id: String, message: String? = null) = update(id, "pending", message)

    @Synchronized
    fun fail(id: String, message: String? = null) = update(id, "failed", message)

    fun isRetriable(error: Throwable): Boolean = error is IOException

    @Synchronized
    fun activate(work: PdaResumeWork) {
        val next = resumes().filterNot { it.module == work.module } + work
        prefs.edit().putString(KEY_RESUMES, gson.toJson(next)).apply()
    }

    @Synchronized
    fun active(module: String, mode: String): PdaResumeWork? = resumes().lastOrNull { it.module == module && it.mode == mode }

    @Synchronized
    fun latestActive(): PdaResumeWork? = resumes().maxByOrNull { it.updatedAt }

    @Synchronized
    fun clearActive(module: String) {
        prefs.edit().putString(KEY_RESUMES, gson.toJson(resumes().filterNot { it.module == module })).apply()
    }

    @Synchronized
    fun savePickProgress(progress: PdaPickProgress) {
        val next = pickProgress().filterNot { it.orderId == progress.orderId && it.mode == progress.mode } + progress
        prefs.edit().putString(KEY_PICK_PROGRESS, gson.toJson(next)).apply()
    }

    @Synchronized
    fun pickProgress(orderId: Int, mode: String): PdaPickProgress? = pickProgress().lastOrNull { it.orderId == orderId && it.mode == mode }

    @Synchronized
    fun clearPickProgress(orderId: Int? = null, mode: String? = null) {
        val next = pickProgress().filterNot { progress ->
            (orderId == null || progress.orderId == orderId) && (mode == null || progress.mode == mode)
        }
        prefs.edit().putString(KEY_PICK_PROGRESS, gson.toJson(next)).apply()
    }

    private fun update(id: String, state: String, message: String?) {
        saveRecords(records().map { if (it.id == id) it.copy(state = state, message = message) else it })
    }

    private fun records(): List<PdaScanRecord> = gson.fromJson<List<PdaScanRecord>>(prefs.getString(KEY_RECORDS, null), recordsType).orEmpty()
    private fun resumes(): List<PdaResumeWork> = gson.fromJson<List<PdaResumeWork>>(prefs.getString(KEY_RESUMES, null), resumeType).orEmpty()
    private fun pickProgress(): List<PdaPickProgress> = gson.fromJson<List<PdaPickProgress>>(prefs.getString(KEY_PICK_PROGRESS, null), pickProgressType).orEmpty()
    private fun saveRecords(value: List<PdaScanRecord>) {
        prefs.edit().putString(KEY_RECORDS, gson.toJson(value.takeLast(MAX_RECORDS))).apply()
    }

    companion object {
        private const val KEY_RECORDS = "records"
        private const val KEY_RESUMES = "resumes"
        private const val KEY_PICK_PROGRESS = "pick_progress"
        private const val MAX_RECORDS = 120
    }
}
