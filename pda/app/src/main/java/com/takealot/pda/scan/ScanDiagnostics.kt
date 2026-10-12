package com.takealot.pda.scan

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class QueuedScan(val code: String, val receivedAtNanos: Long = System.nanoTime())
data class ScanTiming(val module: String, val mode: String, val queueMs: Long, val processingMs: Long, val atMillis: Long = System.currentTimeMillis())
data class RequestTiming(val path: String, val journalMs: Long, val requestMs: Long, val atMillis: Long = System.currentTimeMillis())

object ScanDiagnostics {
    private val _scans = MutableStateFlow<List<ScanTiming>>(emptyList())
    private val _requests = MutableStateFlow<List<RequestTiming>>(emptyList())
    val scans = _scans.asStateFlow()
    val requests = _requests.asStateFlow()

    @Synchronized fun recordScan(scan: QueuedScan, started: Long, module: String, mode: String) {
        _scans.value = (_scans.value + ScanTiming(module, mode, millis(started - scan.receivedAtNanos), millis(System.nanoTime() - started))).takeLast(60)
    }
    @Synchronized fun recordRequest(path: String, journalMs: Long, requestMs: Long) {
        _requests.value = (_requests.value + RequestTiming(path, journalMs, requestMs)).takeLast(60)
    }
    fun millis(nanos: Long) = (nanos / 1_000_000).coerceAtLeast(0)
}
