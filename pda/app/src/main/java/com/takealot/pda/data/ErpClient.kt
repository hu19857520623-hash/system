package com.takealot.pda.data

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonParser
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asContextElement
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import java.util.UUID
import com.takealot.pda.scan.ScanDiagnostics

class ErpClient(private val session: SessionStore, private val journal: PdaWorkJournal? = null) {
    private val gson = Gson()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(25, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .callTimeout(50, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    suspend fun login(username: String, password: String): AuthUser = withContext(Dispatchers.IO) {
        val scope = session.requestScope()
        val data = withContext(replayScope.asContextElement(scope)) {
            postJson("/auth/login", mapOf("username" to username, "password" to password), auth = false)
        }
        val token = data.asJsonObject.get("token")?.asString.orEmpty()
        val user = gson.fromJson(data.asJsonObject.get("user"), AuthUser::class.java)
            ?: throw ErpException("登录响应缺少用户信息")
        if (token.isBlank()) throw ErpException("登录响应缺少 token")
        if (!user.canUsePda()) throw ErpException("该职位不能登录仓储 PDA，请使用仓库账号")
        if (!session.saveLogin(scope, token, user)) throw ErpException("登录环境已变更，请重新登录")
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
            parseOperationalInboundPage(get(q), gson)
        }

    suspend fun inboundDetail(id: Int): InboundOrder = withContext(Dispatchers.IO) {
        gson.fromJson(get("/inbound/$id"), InboundOrder::class.java)
    }

    suspend fun arrivalScan(scanCode: String, warehouseCode: String): ArrivalScanResult = withContext(Dispatchers.IO) {
        val receipt = gson.fromJson(postJson("/inbound/arrival-scan", mapOf("scanCode" to scanCode, "warehouseCode" to warehouseCode)), ArrivalScanResult::class.java)
        if (receipt?.order?.let { it.id > 0 && it.no.isNotBlank() && it.warehouseCode == warehouseCode } != true) {
            throw ErpException("到仓回执缺少原单信息，请到「待同步记录」核对", retriable = true)
        }
        receipt
    }

    suspend fun bindCatalogInbound(scanCode: String, warehouseCode: String): InboundOrder = withContext(Dispatchers.IO) {
        val result = postJson("/inbound/catalog-bind", mapOf("scanCode" to scanCode, "warehouseCode" to warehouseCode))
        catalogBindingReceipt(result, scanCode, warehouseCode, gson)
    }

    internal fun catalogBindingReceipt(result: JsonElement, record: PdaScanRecord): InboundOrder {
        val warehouseCode = record.catalogBindingWarehouse
            ?: throw ErpException("原货盘绑定请求缺少仓库，请由主管核对原记录", retriable = true)
        return catalogBindingReceipt(result, record.scanCode, warehouseCode, gson)
    }

    suspend fun receiveBox(id: Int, scanCode: String, clientRequestId: String = UUID.randomUUID().toString()): ScanActionResult = withContext(Dispatchers.IO) {
        gson.fromJson(postJson("/inbound/$id/receive-box", mapOf("scanCode" to scanCode, "clientRequestId" to clientRequestId)).requireInboundSyncAcknowledged(), ScanActionResult::class.java)
    }

    suspend fun recordReceivedCartonCount(id: Int, receivedCartonCount: Int, differenceReason: String = "", clientRequestId: String = UUID.randomUUID().toString()): ScanActionResult = withContext(Dispatchers.IO) {
        gson.fromJson(
            postJson("/inbound/$id/received-carton-count", mapOf("receivedCartonCount" to receivedCartonCount, "differenceReason" to differenceReason.trim(), "clientRequestId" to clientRequestId)).requireInboundSyncAcknowledged(),
            ScanActionResult::class.java,
        )
    }

    suspend fun reportInboundException(id: Int, exceptionType: String, scanCode: String = "", remark: String = "", clientRequestId: String = UUID.randomUUID().toString()): ScanActionResult = withContext(Dispatchers.IO) {
        gson.fromJson(
            postJson("/inbound/$id/report-exception", mapOf(
                "exceptionType" to exceptionType,
                "scanCode" to scanCode.trim(),
                "remark" to remark.trim(),
                "clientRequestId" to clientRequestId,
            )).requireInboundSyncAcknowledged(),
            ScanActionResult::class.java,
        )
    }

    suspend fun scanQc(
        id: Int,
        scanCode: String,
        increment: Int = 1,
        clientRequestId: String? = null,
        lengthCm: Double? = null,
        widthCm: Double? = null,
        heightCm: Double? = null,
        weightKg: Double? = null,
    ): ScanActionResult = withContext(Dispatchers.IO) {
        val body = mutableMapOf<String, Any?>(
            "scanCode" to scanCode,
            "increment" to increment,
            "clientRequestId" to clientRequestId,
        )
        if (lengthCm != null && lengthCm > 0) body["lengthCm"] = lengthCm
        if (widthCm != null && widthCm > 0) body["widthCm"] = widthCm
        if (heightCm != null && heightCm > 0) body["heightCm"] = heightCm
        if (weightKg != null && weightKg > 0) body["weightKg"] = weightKg
        gson.fromJson(postJson("/inbound/$id/scan-qc", body).requireInboundSyncAcknowledged(), ScanActionResult::class.java)
    }

    suspend fun submitQc(id: Int, body: Map<String, Any?>, clientRequestId: String) = withContext(Dispatchers.IO) {
        postJson("/inbound/$id/qc", body + ("clientRequestId" to clientRequestId))
            .requireInboundSyncAcknowledged().requireQcSubmitReceipt(id, gson)
    }

    suspend fun reduceInbound(id: Int, mode: String, body: Map<String, Any?>): ScanActionResult = withContext(Dispatchers.IO) {
        require(mode in setOf("qc", "carton", "putaway"))
        gson.fromJson(postJson("/inbound/$id/reduce-$mode", body).requireInboundSyncAcknowledged(), ScanActionResult::class.java)
    }

    suspend fun measureDimensions(id: Int, body: Map<String, Any?>, clientRequestId: String) = withContext(Dispatchers.IO) {
        postJson("/inbound/$id/measure-dimensions", body + ("clientRequestId" to clientRequestId)).requireInboundSyncAcknowledged()
    }

    suspend fun putaway(id: Int, body: Map<String, Any?>, clientRequestId: String): InboundOrder = withContext(Dispatchers.IO) {
        val result = postJson("/inbound/$id/putaway", body + ("clientRequestId" to clientRequestId)).requireInboundSyncAcknowledged()
        putawayReceipt(result, id)
    }

    private fun putawayReceipt(result: JsonElement, orderId: Int?): InboundOrder {
        val order = runCatching { gson.fromJson(result, InboundOrder::class.java) }.getOrNull()
        return requirePutawayReceipt(order, orderId)
    }

    suspend fun resolveException(id: Int, body: Map<String, Any?>, clientRequestId: String) = withContext(Dispatchers.IO) {
        postJson("/inbound/$id/resolve-exception", body + ("clientRequestId" to clientRequestId)).requireInboundSyncAcknowledged()
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

    suspend fun pick(id: Int, items: List<Map<String, Any?>>, clientRequestId: String = UUID.randomUUID().toString()) = withContext(Dispatchers.IO) {
        postJson("/outbound/$id/pick", mapOf("pickSource" to "pda", "items" to items, "clientRequestId" to clientRequestId))
            .requireOutboundStageReceipt(id, OutboundReceiptStage.PICK)
    }

    suspend fun startReview(id: Int): OutboundOrder = withContext(Dispatchers.IO) {
        gson.fromJson(postJson("/outbound/$id/start-review", emptyMap<String, Any>()), OutboundOrder::class.java)
    }

    suspend fun pack(id: Int, cartons: List<Map<String, Double>> = emptyList(), clientRequestId: String = UUID.randomUUID().toString()) = withContext(Dispatchers.IO) {
        postJson(
            "/outbound/$id/pack",
            mapOf("reviewSource" to "pda", "cartons" to cartons, "clientRequestId" to clientRequestId),
        ).requireOutboundStageReceipt(id, OutboundReceiptStage.PACK)
    }

    suspend fun setOutboundProblem(id: Int, problemType: String, remark: String, clientRequestId: String = UUID.randomUUID().toString()): OutboundOrder = withContext(Dispatchers.IO) {
        gson.fromJson(
            postJson("/outbound/$id/problem", mapOf(
                "markType" to "problem",
                "problemType" to problemType,
                "problemRemark" to remark.trim(),
                "clientRequestId" to clientRequestId,
            )).requireOutboundProblemReceipt(id, problemType),
            OutboundOrder::class.java,
        )
    }

    suspend fun ship(
        id: Int,
        trackingNo: String = "",
        carrier: String = "",
        logisticsProduct: String = "",
        clientRequestId: String = UUID.randomUUID().toString(),
    ): OutboundOrder = withContext(Dispatchers.IO) {
        gson.fromJson(
            postJson(
                "/outbound/$id/ship",
                mapOf(
                    "trackingNo" to trackingNo.trim(),
                    "carrier" to carrier.trim(),
                    "logisticsProduct" to logisticsProduct.trim(),
                    "clientRequestId" to clientRequestId,
                ),
            ).requireShipSyncAcknowledged(id),
            OutboundOrder::class.java,
        )
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

    suspend fun stocktakeCount(id: Int, body: Map<String, Any?>, clientRequestId: String = UUID.randomUUID().toString()): StocktakePlan = withContext(Dispatchers.IO) {
        val result = postJson("/management-loop/stocktakes/$id/count", body + ("clientRequestId" to clientRequestId))
        stocktakeCountReceipt(result, id)
    }

    internal fun stocktakeCountReceipt(result: JsonElement, expectedId: Int): StocktakePlan {
        val plan = runCatching { gson.fromJson(result, StocktakePlan::class.java) }.getOrNull()
        return requireStocktakeCountReceipt(plan, expectedId)
    }

    private val replayScope = ThreadLocal<AuthRequestScope>()

    suspend fun <T> submitPrepared(recordId: String, action: suspend () -> T): T {
        val record = journal?.pendingRecord(recordId)
            ?: throw ErpException("未找到原作业请求，请返回单据核对后重试", retriable = true)
        return replayAsOriginalOwner(record, action)
    }

    suspend fun <T> replayAsOriginalOwner(record: PdaScanRecord, action: suspend () -> T): T {
        val scope = session.requestScope()
        if (record.ownerId != scope.userId || record.serverUrl != scope.baseUrl || scope.token.isBlank()) {
            throw ErpException("请使用原账号和原服务器核对待同步请求", retriable = true)
        }
        return withContext(replayScope.asContextElement(scope)) {
            val result = action()
            requireCurrentScope(scope)
            result
        }
    }

    suspend fun retryPending(record: PdaScanRecord) = withContext(Dispatchers.IO) {
        val endpoint = record.retryEndpoint.orEmpty()
        val body = record.retryBodyJson.orEmpty()
        if (endpoint.isBlank() || body.isBlank()) throw ErpException("待同步记录缺少请求内容")
        val result = postJson(endpoint, JsonParser.parseString(body))
        if (endpoint.startsWith("/outbound/")) {
            when (endpoint.substringAfterLast('/')) {
                "pick" -> result.requireOutboundStageReceipt(record.orderId, OutboundReceiptStage.PICK)
                "pack" -> result.requireOutboundStageReceipt(record.orderId, OutboundReceiptStage.PACK)
                "problem" -> result.requireOutboundProblemReceipt(record.orderId, record.mode.removePrefix("problem_"))
                "ship" -> result.requireShipSyncAcknowledged(record.orderId)
            }
        }
        if (endpoint.startsWith("/inbound/")) result.requireInboundSyncAcknowledged()
        if (endpoint.startsWith("/inbound/") && endpoint.endsWith("/putaway")) putawayReceipt(result, record.orderId)
        if (endpoint.startsWith("/inbound/") && endpoint.endsWith("/qc")) result.requireQcSubmitReceipt(record.orderId, gson)
        result
    }

    private fun get(path: String): JsonElement = execute(request(path).get().build(), requireAuth = true)

    private fun postJson(path: String, body: Any, auth: Boolean = true): JsonElement {
        val payload = gson.toJson(body).toRequestBody(jsonType)
        return execute(request(path, auth).post(payload).build(), requireAuth = auth)
    }

    private fun requireCurrentScope(scope: AuthRequestScope) {
        if (scope != session.requestScope()) {
            throw ErpException("登录或服务器已切换，原请求已保留，请使用原账号继续", retriable = true)
        }
    }

    private fun request(path: String, auth: Boolean = true): Request.Builder {
        val scope = replayScope.get()?.also(::requireCurrentScope) ?: session.requestScope()
        val baseUrl = scope.baseUrl
        val builder = Request.Builder().url("$baseUrl$path")
        val token = scope.token
        if (auth) builder.tag(AuthRequestScope::class.java, scope)
        if (auth) {
            if (token.isBlank() || SessionStore.isJwtExpired(token)) {
                session.invalidateAuth(scope)
                throw ErpException("登录已过期，请重新登录", 401)
            }
            builder.header("Authorization", "Bearer $token")
        }
        builder.header("Accept", "application/json")
        return builder
    }

    private fun execute(request: Request, requireAuth: Boolean): JsonElement {
        val journalStarted = System.nanoTime()
        if (request.method != "GET" && requireAuth) journal?.flushBeforeRequest()
        val scope = request.tag(AuthRequestScope::class.java) ?: replayScope.get()
        scope?.let(::requireCurrentScope)
        val journalMs = ScanDiagnostics.millis(System.nanoTime() - journalStarted)
        val requestStarted = System.nanoTime()
        try {
            return executeResponse(request, scope)
        } finally {
            ScanDiagnostics.recordRequest(request.url.encodedPath, journalMs, ScanDiagnostics.millis(System.nanoTime() - requestStarted))
        }
    }

    private fun executeResponse(request: Request, scope: AuthRequestScope?): JsonElement {
        val resp = try {
            http.newCall(request).execute()
        } catch (e: SocketTimeoutException) {
            throw ErpException("连接 ERP 超时，请稍后重试；已提交操作请先核对待同步记录", retriable = true)
        } catch (e: IOException) {
            throw ErpException("无法连接 ERP，请检查网络后重试；已提交操作请先核对待同步记录", retriable = true)
        }
        resp.use {
            try {
                val body = it.body?.string().orEmpty()
                scope?.let(::requireCurrentScope)
                return parseErpResponse(body, it.code)
            } catch (e: ErpException) {
                if (e.code == 401) {
                    request.tag(AuthRequestScope::class.java)?.let(session::invalidateAuth)
                }
                throw e
            } catch (_: IOException) {
                throw ErpException("读取 ERP 响应中断，请核对待同步记录后重试", retriable = true)
            }
        }
    }

    private fun friendly401(message: String): String {
        val text = message.trim()
        if (text.contains("过期") || text.contains("失效") || text.contains("重新登录") || text.contains("密码")) return text
        return "登录已过期，请重新登录"
    }

    private fun String.encodeUrl() = java.net.URLEncoder.encode(this, "UTF-8")
}

internal fun JsonElement.requireShipSyncAcknowledged(expectedOrderId: Int?): JsonElement {
    val response = takeIf { it.isJsonObject }?.asJsonObject
    val returnedId = response?.get("id")?.takeIf { it.isJsonPrimitive }?.asString?.toIntOrNull()
    val shippedAt = response?.get("shippedAt")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
    if (expectedOrderId == null || returnedId != expectedOrderId || shippedAt.isNullOrBlank()) {
        throw ErpException("发运回执缺少对应单号或发运时间，请在「待同步与异常记录」核对原请求", retriable = true)
    }
    val warning = response?.get("warning")
    val syncFlags = listOf("syncPending", "feePending").map { key ->
        response?.get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean
    }
    if (syncFlags.any { it != false } || (warning?.isJsonPrimitive == true && warning.asJsonPrimitive.isString && warning.asString.isNotBlank())) {
        throw ErpException("发运已保存，OMS 同步待确认。请在「待同步与异常记录」重试原请求，勿重复发运", retriable = true)
    }
    return this
}

private fun JsonElement.requireInboundSyncAcknowledged(): JsonElement {
    if (isJsonObject && listOf("syncPending", "feePending").any { key ->
            val value = asJsonObject.get(key)
            value?.isJsonPrimitive == true && value.asJsonPrimitive.isBoolean && value.asBoolean
        }) {
        throw ErpException("仓库作业已保存，同步待确认。请在「待同步记录」核对原请求", retriable = true)
    }
    return this
}

internal fun catalogBindingReceipt(result: JsonElement, scanCode: String, warehouseCode: String, gson: Gson): InboundOrder {
    val order = runCatching { gson.fromJson(result, InboundOrder::class.java) }.getOrNull()
    if (order == null || order.id <= 0 || !order.no.equals(scanCode.trim(), ignoreCase = true) ||
        order.warehouseCode != warehouseCode) {
        throw ErpException("货盘绑定回执与原单不匹配，请到「待同步记录」核对", retriable = true)
    }
    return order
}
