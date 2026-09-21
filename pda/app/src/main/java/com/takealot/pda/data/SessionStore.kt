package com.takealot.pda.data

import android.content.Context
import android.util.Base64
import com.google.gson.JsonParser
import com.takealot.pda.BuildConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("pda_session", Context.MODE_PRIVATE)
    private val authTickState = MutableStateFlow(0)
    val authTick: StateFlow<Int> = authTickState

    init {
        migrateLanUrlToProduction()
    }

    var baseUrl: String
        get() = resolveBaseUrl(prefs.getString(KEY_BASE, DEFAULT_BASE) ?: DEFAULT_BASE)
        set(value) { prefs.edit().putString(KEY_BASE, resolveBaseUrl(value)).apply() }
    var token: String
        get() = prefs.getString(KEY_TOKEN, "") ?: ""
        set(value) { prefs.edit().putString(KEY_TOKEN, value.trim().removePrefix("Bearer ").trim()).apply() }
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
    var userWorkstation: String
        get() = prefs.getString(KEY_USER_STATION, "") ?: ""
        set(value) { prefs.edit().putString(KEY_USER_STATION, value).apply() }
    var deviceWorkstation: String
        get() = prefs.getString(KEY_DEVICE_STATION, "") ?: ""
        set(value) { prefs.edit().putString(KEY_DEVICE_STATION, value.trim()).apply() }
    var pickScanMode: String
        get() = prefs.getString(KEY_PICK_SCAN, "carton") ?: "carton"
        set(value) { prefs.edit().putString(KEY_PICK_SCAN, if (value == "piece") "piece" else "carton").apply() }

    val workstation: String get() = userWorkstation.ifBlank { deviceWorkstation }
    val isLoggedIn: Boolean get() = token.isNotBlank() && !isJwtExpired(token)
    fun hasPerm(id: String) = permissionsCsv.split(',').any { it.trim() == id }

    fun saveLogin(token: String, user: AuthUser) {
        this.token = token
        userId = user.id
        username = user.username.orEmpty()
        realName = user.name
        userWorkstation = user.workstation.orEmpty().trim()
        permissionsCsv = user.permSet.joinToString(",")
        bumpAuth()
    }

    fun logout() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_USER_ID)
            .remove(KEY_REAL_NAME).remove(KEY_PERMS).remove(KEY_USER_STATION).apply()
        bumpAuth()
    }

    /** 登录过期时清 token，保留用户名方便重新登录。 */
    fun invalidateAuth() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_PERMS).apply()
        bumpAuth()
    }

    private fun bumpAuth() {
        authTickState.value = authTickState.value + 1
    }

    /** 海外仓无法访问局域网开发机，启动时把旧地址改成正式环境。 */
    private fun migrateLanUrlToProduction() {
        val stored = prefs.getString(KEY_BASE, null) ?: return
        if (looksLikeLanDev(stored)) {
            prefs.edit().putString(KEY_BASE, PRODUCTION_API_BASE).apply()
        }
    }

    companion object {
        const val PRODUCTION_API_BASE = "https://www.erp.sztekeluo.com/api"
        val DEFAULT_BASE: String = BuildConfig.ERP_API_BASE_URL

        fun looksLikeLanDev(url: String): Boolean {
            val lower = url.lowercase()
            return lower.contains("192.168.") ||
                lower.contains("10.0.2.2") ||
                lower.contains("localhost") ||
                lower.contains("127.0.0.1")
        }

        fun resolveBaseUrl(raw: String): String {
            var value = raw.trim().trimEnd('/')
            if (value.isEmpty() || looksLikeLanDev(value)) return PRODUCTION_API_BASE
            if (!value.startsWith("http://", ignoreCase = true) && !value.startsWith("https://", ignoreCase = true)) {
                value = "https://$value"
            }
            if (value.contains("erp.sztekeluo.com", ignoreCase = true) && value.startsWith("http://", ignoreCase = true)) {
                value = "https://" + value.substring(7)
            }
            return value
        }

        fun isJwtExpired(jwt: String): Boolean {
            val parts = jwt.split('.')
            if (parts.size < 2) return false
            return try {
                var payload = parts[1]
                val pad = (4 - payload.length % 4) % 4
                if (pad > 0) payload += "=".repeat(pad)
                val json = String(Base64.decode(payload, Base64.URL_SAFE), Charsets.UTF_8)
                val exp = JsonParser.parseString(json).asJsonObject.get("exp")?.asLong ?: return false
                exp * 1000L <= System.currentTimeMillis()
            } catch (_: Exception) {
                false
            }
        }

        private const val KEY_BASE = "base_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_USERNAME = "username"
        private const val KEY_REAL_NAME = "real_name"
        private const val KEY_PERMS = "perms"
        private const val KEY_WH = "warehouse_code"
        private const val KEY_WH_NAME = "warehouse_name"
        private const val KEY_USER_STATION = "user_workstation"
        private const val KEY_DEVICE_STATION = "device_workstation"
        private const val KEY_PICK_SCAN = "pick_scan_mode"
    }
}
