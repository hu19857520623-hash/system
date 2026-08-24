package com.takealot.pda.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class AppLanguage(val code: String, val label: String) {
    Chinese("zh", "中文"),
    English("en", "English"),
    Afrikaans("af", "Afrikaans"),
}

class LanguageStore(context: Context) {
    private val prefs = context.getSharedPreferences("pda_language", Context.MODE_PRIVATE)
    var language by mutableStateOf(
        AppLanguage.entries.firstOrNull { it.code == prefs.getString(KEY_LANGUAGE, AppLanguage.Chinese.code) } ?: AppLanguage.Chinese,
    )
        private set

    fun set(value: AppLanguage) {
        language = value
        prefs.edit().putString(KEY_LANGUAGE, value.code).apply()
    }

    companion object { private const val KEY_LANGUAGE = "language" }
}
