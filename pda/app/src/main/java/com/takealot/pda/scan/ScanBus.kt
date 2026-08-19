package com.takealot.pda.scan

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

object ScanBus {
    private val _codes = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val codes = _codes.asSharedFlow()
    fun emit(raw: String) {
        val code = raw.trim()
        if (code.isNotEmpty()) _codes.tryEmit(code)
    }
}
