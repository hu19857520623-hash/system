package com.takealot.pda.scan

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build

class ScanBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        val extras = intent?.extras ?: return
        val keys = arrayOf(
            "barcode_string", "barcode", "scannerdata", "data", "value",
            "SCAN_BARCODE1", "scan_data", "decode_data", "SCAN_BARCODE",
            "com.symbol.datawedge.data_string",
        )
        for (key in keys) {
            val v = extras.getString(key)
            if (!v.isNullOrBlank()) {
                ScanBus.emit(v)
                return
            }
        }
    }

    companion object {
        fun intentFilter(): IntentFilter {
            val filter = IntentFilter()
            listOf(
                "android.intent.action.SCANRESULT",
                "com.android.server.scannerservice.broadcast",
                "android.intent.ACTION_DECODE_DATA",
                "nlscan.action.SCANNER_RESULT",
                "com.honeywell.decode.intent.action.EDIT_DATA",
                "com.symbol.datawedge.api.RESULT_ACTION",
                "scanner.action.BARCODE",
                "com.urovo.sdk.scanner.action.BARCODE",
            ).forEach { filter.addAction(it) }
            return filter
        }

        fun register(context: Context, receiver: ScanBroadcastReceiver) {
            if (Build.VERSION.SDK_INT >= 33) {
                context.registerReceiver(receiver, intentFilter(), Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                context.registerReceiver(receiver, intentFilter())
            }
        }
    }
}
