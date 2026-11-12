package com.takealot.pda.data

import org.junit.Assert.*
import org.junit.Test

class ErpResponseTest {
    private fun failure(body: String, status: Int): ErpException {
        try { parseErpResponse(body, status); error("Expected failure") }
        catch (e: ErpException) { return e }
    }

    @Test fun acceptsSuccessfulEnvelope() {
        assertEquals(12, parseErpResponse("""{"code":0,"data":{"qty":12}}""", 200).asJsonObject.get("qty").asInt)
    }

    @Test fun gatewayFailureRemainsRetryableAndDoesNotExposeHtml() {
        val e = failure("<html>502 Bad Gateway</html>", 502)
        assertEquals(502, e.code)
        assertTrue(e.retriable)
        assertTrue(e.message!!.contains("稍后重试"))
        assertFalse(e.message!!.contains("html"))
    }

    @Test fun transientJsonServerFailuresAreRetryable() {
        for (status in listOf(408, 429, 500, 503, 504)) {
            assertTrue(failure("""{"message":"Internal Server Error"}""", status).retriable)
        }
    }

    @Test fun unauthorizedIsRecognizedWithMalformedBodyAndApplicationEnvelope() {
        val malformed = failure("not json", 401)
        assertEquals(401, malformed.code)
        assertTrue(malformed.retriable)
        assertTrue(malformed.message!!.contains("重试原请求"))
        val login = failure("""{"code":401,"message":"Unauthorized"}""", 200)
        assertEquals(401, login.code)
        assertTrue(login.retriable)
        assertFalse(login.message!!.contains("Unauthorized"))
    }

    @Test fun permissionAndRateLimitKeepTheOriginalScanForRetry() {
        val denied = failure("Forbidden", 403)
        assertTrue(denied.retriable)
        assertTrue(denied.message!!.contains("不要重新扫描"))
        assertFalse(denied.message!!.contains("Forbidden"))
        val business = failure("""{"message":"当前岗位不能执行上架"}""", 403)
        assertEquals("当前岗位不能执行上架", business.message)
        assertTrue(business.retriable)
        val busy = failure("""{"message":"Too Many Requests"}""", 429)
        assertTrue(busy.retriable)
        assertTrue(busy.message!!.contains("重试原请求"))
    }

    @Test fun validationArrayIsReadableAndBusinessFailureIsNotRetryable() {
        val e = failure("""{"message":["数量必须为正整数","单据状态不允许"]}""", 400)
        assertEquals("数量必须为正整数；单据状态不允许", e.message)
        assertFalse(e.retriable)
        assertFalse(failure("""{"message":["qty must be positive"]}""", 400).message!!.contains("must"))
    }

    @Test fun invalidSuccessBodyRetainsUncertainMutationForReconciliation() {
        assertTrue(failure("<html>proxy error</html>", 200).retriable)
        assertTrue(failure("", 200).retriable)
    }

    @Test fun incompleteOrInvalidEnvelopesKeepTheOriginalRequest() {
        for (body in listOf("{}", """{"code":0}""", """{"code":0.5,"data":{}}""", """{"code":"0","data":{}}""")) {
            assertTrue(failure(body, 200).retriable)
        }
        assertTrue(parseErpResponse("""{"code":0,"data":null}""", 200).isJsonNull)
    }

    @Test fun httpFailureCannotBeHiddenBySuccessEnvelope() {
        val e = failure("""{"code":0,"data":{}}""", 503)
        assertEquals(503, e.code)
        assertTrue(e.retriable)
    }
}
