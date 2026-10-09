package com.takealot.pda.scan

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

data class ScannerHealth(
    val receiverActive: Boolean = false,
    val lastScanAt: Long? = null,
    val lastCode: String = "",
    val sourceAction: String = "",
    val sourceField: String = "",
    val droppedCount: Int = 0,
)

object ScanBus {
    private val _codes = MutableSharedFlow<String>(extraBufferCapacity = 64)
    private val _receiverActive = MutableStateFlow(false)
    private val _health = MutableStateFlow(ScannerHealth())
    val codes = _codes.asSharedFlow()
    val receiverActive = _receiverActive.asStateFlow()
    val health = _health.asStateFlow()

    fun setReceiverActive(active: Boolean) {
        _receiverActive.value = active
        _health.value = _health.value.copy(receiverActive = active)
    }

    fun emit(raw: String, sourceAction: String = "", sourceField: String = "") {
        val code = raw.trim()
        if (code.isNotEmpty()) {
            val delivered = _codes.tryEmit(code)
            _health.value = ScannerHealth(
                receiverActive = _receiverActive.value,
                lastScanAt = System.currentTimeMillis(),
                lastCode = code,
                sourceAction = sourceAction,
                sourceField = sourceField,
                droppedCount = _health.value.droppedCount + if (delivered) 0 else 1,
            )
        }
    }
}
