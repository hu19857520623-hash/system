package com.tkl.erp.integration.web;

import com.tkl.erp.common.legacy.LegacyHttpProxy;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

@RestController
public class IntegrationLegacyProxyController {

    private final LegacyHttpProxy proxy;

    public IntegrationLegacyProxyController(LegacyHttpProxy proxy) {
        this.proxy = proxy;
    }

    @RequestMapping({
            "/sync-logs", "/sync-logs/**",
            "/async-io", "/async-io/**",
            "/store-monitor", "/store-monitor/**",
            "/dashboard", "/dashboard/**",
            "/announcements", "/announcements/**"
    })
    public ResponseEntity<byte[]> forward(HttpServletRequest request) throws IOException {
        return proxy.forward(request);
    }
}
