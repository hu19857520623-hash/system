package com.tkl.erp.finance.web;

import com.tkl.erp.common.legacy.LegacyHttpProxy;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

@RestController
public class FinanceLegacyProxyController {

    private final LegacyHttpProxy proxy;

    public FinanceLegacyProxyController(LegacyHttpProxy proxy) {
        this.proxy = proxy;
    }

    @RequestMapping({
            "/cost-ledger", "/cost-ledger/**",
            "/profit", "/profit/**",
            "/freight-bills", "/freight-bills/**",
            "/pricing", "/pricing/**"
    })
    public ResponseEntity<byte[]> forward(HttpServletRequest request) throws IOException {
        return proxy.forward(request);
    }
}
