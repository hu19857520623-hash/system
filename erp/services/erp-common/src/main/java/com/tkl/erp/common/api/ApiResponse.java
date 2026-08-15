package com.tkl.erp.common.api;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Unified API envelope aligned with the legacy NestJS backend:
 * {@code { code, message, data }}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(int code, String message, T data) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(0, "ok", data);
    }

    public static <T> ApiResponse<T> ok() {
        return ok(null);
    }

    public static <T> ApiResponse<T> fail(int code, String message) {
        return new ApiResponse<>(code, message, null);
    }
}
