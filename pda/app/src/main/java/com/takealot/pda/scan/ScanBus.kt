package com.takealot.pda.scan

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

object ScanBus {
    private val _codes = MutableSharedFlow<String>(extraBufferCapacity = 8)
    private val _receiverActive = MutableStateFlow(false)
    val codes = _codes.asSharedFlow()
    val receiverActive = _receiverActive.asStateFlow()

    fun setReceiverActive(active: Boolean) {
        _receiverActive.value = active
    }

    fun emit(raw: String) {
        val code = raw.trim()
        if (code.isNotEmpty()) _codes.tryEmit(code)
    }
}
