package com.takealot.pda.data

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonParser
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class ErpClient(private val session: SessionStore) {
    private val gson = Gson()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun login(username: String, password: String): AuthUser = withContext(Dispatchers.IO) {
        val data = postJson("/auth/login", mapOf("username" to username, "password" to password), auth = false)
        val token = data.asJsonObject.get("token")?.asString.orEmpty()
        val user = gson.fromJson(data.asJsonObject.get("user"), AuthUser::class.java)
            ?: throw ErpException("登录响应缺少用户信息")
        if (token.isBlank()) throw ErpException("登录响应缺少 token")
        if (!user.canUsePda()) throw ErpException("该职位不能登录仓储 PDA，请使用仓库账号")
        session.saveLogin(token, user)
        user
    }

    suspend fun warehouses(type: String = "overseas"): List<Warehouse> = withContext(Dispatchers.IO) {
        val data = get("/warehouses?type=$type")
        if (data.isJsonArray) gson.fromJson(data, object : TypeToken<List<Warehouse>>() {}.type)
        else {
            val items = data.asJsonObject.get("items")
            if (items != null && items.isJsonArray) gson.fromJson(items, object : TypeToken<List<Warehouse>>() {}.type)
            else emptyList()
        }
    }

    suspend fun inboundList(keyword: String? = null, status: String? = null, pageSize: Int = 20): PageResult<InboundOrder> =
        withContext(Dispatchers.IO) {
            val q = buildString {
                append("/inbound?page=1&pageSize=$pageSize")
                if (!keyword.isNullOrBlank()) append("&keyword=${keyword.encodeUrl()}")
                if (!status.isNullOrBlank()) append("&status=$status")
            }
            gson.fromJson(get(q), object : TypeToken<PageResult<InboundOrder>>() {}.type)
        }

    suspend fun inboundDetail(id: Int): InboundOrder = withContext(Dispatchers.IO) {
        gson.fromJson(get("/inbound/$id"), InboundOrder::class.java)
    }

    suspend fun arrivalScan(scanCode: String, warehouseCode: String): ArrivalScanResult = withContext(Dispatchers.IO) {
        gson.fromJson(postJson("/inbound/arrival-scan", mapOf("scanCode" to scanCode, "warehouseCode" to warehouseCode)), ArrivalScanResult::class.java)
    }

    suspend fun receiveBox(id: Int, scanCode: String): ScanActionResult = withContext(Dispatchers.IO) {
        gson.fromJson(postJson("/inbound/$id/receive-box", mapOf("scanCode" to scanCode)), ScanActionResult::class.java)
    }

    suspend fun recordReceivedCartonCount(id: Int, receivedCartonCount: Int): ScanActionResult = withContext(Dispatchers.IO) {
        gson.fromJson(
            postJson("/inbound/$id/received-carton-count", mapOf("receivedCartonCount" to receivedCartonCount)),
            ScanActionResult::class.java,
        )
    }

    suspend fun scanQc(id: Int, scanCode: String, increment: Int = 1, clientRequestId: String? = null): ScanActionResult = withContext(Dispatchers.IO) {
        gson.fromJson(
            postJson("/inbound/$id/scan-qc", mapOf("scanCode" to scanCode, "increment" to increment, "clientRequestId" to clientRequestId)),
            ScanActionResult::class.java,
        )
    }

    suspend fun submitQc(id: Int, items: List<Map<String, Any?>>, acceptDiff: Boolean): Unit = withContext(Dispatchers.IO) {
        postJson("/inbound/$id/qc", mapOf("items" to items, "acceptDiff" to acceptDiff))
        Unit
    }

    suspend fun measureDimensions(id: Int, inboundItemId: Int, lengthCm: Double, widthCm: Double, heightCm: Double) =
        withContext(Dispatchers.IO) {
            postJson("/inbound/$id/measure-dimensions", mapOf("items" to listOf(mapOf(
                "inboundItemId" to inboundItemId, "lengthCm" to lengthCm, "widthCm" to widthCm, "heightCm" to heightCm,
            ))))
        }

    suspend fun putaway(id: Int, inboundItemId: Int, locationCode: String, qty: Int) = withContext(Dispatchers.IO) {
        postJson("/inbound/$id/putaway", mapOf("items" to listOf(mapOf(
            "inboundItemId" to inboundItemId,
            "lines" to listOf(mapOf("locationCode" to locationCode, "qty" to qty)),
        ))))
    }

    suspend fun resolveException(id: Int, reason: String) = withContext(Dispatchers.IO) {
        postJson("/inbound/$id/resolve-exception", mapOf("reason" to reason.trim()))
    }

    suspend fun outboundList(
        keyword: String? = null, status: String? = null, pickerId: Int? = null,
        warehouseCode: String? = null, pageSize: Int = 50,
    ): PageResult<OutboundOrder> = withContext(Dispatchers.IO) {
        val q = buildString {
            append("/outbound?page=1&pageSize=$pageSize")
            if (!keyword.isNullOrBlank()) append("&keyword=${keyword.encodeUrl()}")
            if (!status.isNullOrBlank()) append("&status=$status")
            if (pickerId != null && pickerId > 0) append("&pickerId=$pickerId")
            if (!warehouseCode.isNullOrBlank()) append("&warehouseCode=$warehouseCode")
        }
        gson.fromJson(get(q), object : TypeToken<PageResult<OutboundOrder>>() {}.type)
    }

    suspend fun outboundDetail(id: Int): OutboundOrder = withContext(Dispatchers.IO) {
        gson.fromJson(get("/outbound/$id"), OutboundOrder::class.java)
    }

    suspend fun pickSuggestions(id: Int): PickSuggestions = withContext(Dispatchers.IO) {
        gson.fromJson(get("/outbound/$id/pick-suggestions"), PickSuggestions::class.java)
    }

    suspend fun pick(id: Int, items: List<Map<String, Any?>>) = withContext(Dispatchers.IO) {
        postJson("/outbound/$id/pick", mapOf("pickSource" to "pda", "items" to items))
    }

    suspend fun startReview(id: Int): OutboundOrder = withContext(Dispatchers.IO) {
        gson.fromJson(postJson("/outbound/$id/start-review", emptyMap<String, Any>()), OutboundOrder::class.java)
    }

    suspend fun pack(id: Int) = withContext(Dispatchers.IO) {
        postJson("/outbound/$id/pack", mapOf("reviewSource" to "pda"))
    }

    suspend fun stocktakes(warehouseCode: String? = null, status: String? = null, stocktakeNo: String? = null): List<StocktakePlan> =
        withContext(Dispatchers.IO) {
            val q = buildString {
                append("/management-loop/stocktakes?")
                if (!warehouseCode.isNullOrBlank()) append("warehouseCode=$warehouseCode&")
                if (!status.isNullOrBlank()) append("status=$status&")
                if (!stocktakeNo.isNullOrBlank()) append("stocktakeNo=${stocktakeNo.encodeUrl()}&")
            }.trimEnd('&', '?')
            val data = get(q)
            if (data.isJsonArray) gson.fromJson(data, object : TypeToken<List<StocktakePlan>>() {}.type)
            else emptyList()
        }

    suspend fun stocktake(id: Int): StocktakePlan = withContext(Dispatchers.IO) {
        gson.fromJson(get("/management-loop/stocktakes/$id"), StocktakePlan::class.java)
    }

    suspend fun stocktakeCount(id: Int, lineId: Int, qty: Int): StocktakePlan = withContext(Dispatchers.IO) {
        gson.fromJson(postJson("/management-loop/stocktakes/$id/count", mapOf("lineId" to lineId, "qty" to qty)), StocktakePlan::class.java)
    }

    private fun get(path: String): JsonElement = execute(request(path).get().build())

    private fun postJson(path: String, body: Any, auth: Boolean = true): JsonElement {
        val payload = gson.toJson(body).toRequestBody(jsonType)
        return execute(request(path, auth).post(payload).build())
    }

    private fun request(path: String, auth: Boolean = true): Request.Builder {
        val builder = Request.Builder().url("${session.baseUrl.trim().trimEnd('/')}$path")
        if (auth && session.token.isNotBlank()) builder.header("Authorization", "Bearer ${session.token}")
        builder.header("Accept", "application/json")
        return builder
    }

    private fun execute(request: Request): JsonElement {
        http.newCall(request).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            val root = try {
                JsonParser.parseString(text).asJsonObject
            } catch (_: Exception) {
                throw ErpException(if (text.isBlank()) "服务器无响应 (${resp.code})" else text.take(160))
            }
            val code = root.get("code")?.asInt ?: resp.code
            val message = root.get("message")?.asString ?: resp.message
            if (!resp.isSuccessful || code != 0) throw ErpException(message.ifBlank { "请求失败 (${resp.code})" }, code)
            return root.get("data") ?: gson.toJsonTree(null)
        }
    }

    private fun String.encodeUrl() = java.net.URLEncoder.encode(this, "UTF-8")
}
