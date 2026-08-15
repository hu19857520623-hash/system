package com.tkl.erp.auth.web;

import com.tkl.erp.common.api.ApiResponse;
import com.tkl.erp.common.api.ServiceInfo;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping
public class ServiceMetaController {

    private final Instant startedAt = Instant.now();

    @Value("${spring.application.name}")
    private String serviceName;

    @GetMapping("/internal/meta")
    public ApiResponse<ServiceInfo> meta() {
        return ApiResponse.ok(new ServiceInfo(serviceName, "0.1.0-SNAPSHOT", "UP", startedAt));
    }

    @GetMapping("/auth/ping")
    public ApiResponse<Map<String, String>> ping() {
        return ApiResponse.ok(Map.of(
                "service", serviceName,
                "message", "auth-service skeleton is running"
        ));
    }
}
