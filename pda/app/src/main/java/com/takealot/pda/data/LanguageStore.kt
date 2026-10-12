package com.takealot.pda.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class AppLanguage(val code: String, val label: String) {
    Chinese("zh", "中文"),
    English("en", "English"),
}

class LanguageStore(context: Context) {
    private val prefs = context.getSharedPreferences("pda_language", Context.MODE_PRIVATE)
    private val savedCode = prefs.getString(KEY_LANGUAGE, AppLanguage.Chinese.code)
    private val initialLanguage = AppLanguage.entries.firstOrNull { it.code == savedCode } ?: AppLanguage.Chinese
    var language by mutableStateOf(initialLanguage)
        private set

    init {
        // 旧版如果选择过已移除的语言，升级后统一回退为中文并清理无效配置。
        if (savedCode != initialLanguage.code) {
            prefs.edit().putString(KEY_LANGUAGE, initialLanguage.code).apply()
        }
    }

    fun set(value: AppLanguage) {
        language = value
        prefs.edit().putString(KEY_LANGUAGE, value.code).apply()
    }

    companion object { private const val KEY_LANGUAGE = "language" }
}
