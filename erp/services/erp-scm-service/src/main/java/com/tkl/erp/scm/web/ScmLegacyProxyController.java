package com.tkl.erp.scm.web;

import com.tkl.erp.common.legacy.LegacyHttpProxy;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

@RestController
public class ScmLegacyProxyController {

    private final LegacyHttpProxy proxy;

    public ScmLegacyProxyController(LegacyHttpProxy proxy) {
        this.proxy = proxy;
    }

    @RequestMapping({
            "/products", "/products/**",
            "/product-dev", "/product-dev/**",
            "/suppliers", "/suppliers/**",
            "/purchase-orders", "/purchase-orders/**",
            "/inbound", "/inbound/**",
            "/outbound", "/outbound/**",
            "/inventory", "/inventory/**",
            "/warehouses", "/warehouses/**",
            "/warehouse-zones", "/warehouse-zones/**",
            "/locations", "/locations/**",
            "/logistics-receipts", "/logistics-receipts/**"
    })
    public ResponseEntity<byte[]> forward(HttpServletRequest request) throws IOException {
        return proxy.forward(request);
    }
}
