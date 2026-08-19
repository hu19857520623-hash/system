package com.takealot.pda.data

import android.content.Context

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("pda_session", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = prefs.getString(KEY_BASE, DEFAULT_BASE) ?: DEFAULT_BASE
        set(value) { prefs.edit().putString(KEY_BASE, value.trim().trimEnd('/')).apply() }
    var token: String
        get() = prefs.getString(KEY_TOKEN, "") ?: ""
        set(value) { prefs.edit().putString(KEY_TOKEN, value).apply() }
    var userId: Int
        get() = prefs.getInt(KEY_USER_ID, 0)
        set(value) { prefs.edit().putInt(KEY_USER_ID, value).apply() }
    var username: String
        get() = prefs.getString(KEY_USERNAME, "") ?: ""
        set(value) { prefs.edit().putString(KEY_USERNAME, value).apply() }
    var realName: String
        get() = prefs.getString(KEY_REAL_NAME, "") ?: ""
        set(value) { prefs.edit().putString(KEY_REAL_NAME, value).apply() }
    var permissionsCsv: String
        get() = prefs.getString(KEY_PERMS, "") ?: ""
        set(value) { prefs.edit().putString(KEY_PERMS, value).apply() }
    var warehouseCode: String
        get() = prefs.getString(KEY_WH, "") ?: ""
        set(value) { prefs.edit().putString(KEY_WH, value).apply() }
    var warehouseName: String
        get() = prefs.getString(KEY_WH_NAME, "") ?: ""
        set(value) { prefs.edit().putString(KEY_WH_NAME, value).apply() }

    val isLoggedIn: Boolean get() = token.isNotBlank()
    fun hasPerm(id: String) = permissionsCsv.split(',').any { it.trim() == id }

    fun saveLogin(token: String, user: AuthUser) {
        this.token = token
        userId = user.id
        username = user.username.orEmpty()
        realName = user.name
        permissionsCsv = user.permSet.joinToString(",")
    }

    fun logout() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_USER_ID).remove(KEY_USERNAME)
            .remove(KEY_REAL_NAME).remove(KEY_PERMS).apply()
    }

    companion object {
        const val DEFAULT_BASE = "http://10.0.2.2:3000/api"
        private const val KEY_BASE = "base_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_USERNAME = "username"
        private const val KEY_REAL_NAME = "real_name"
        private const val KEY_PERMS = "perms"
        private const val KEY_WH = "warehouse_code"
        private const val KEY_WH_NAME = "warehouse_name"
    }
}
