package com.tkl.erp.crm.web;

import com.tkl.erp.common.legacy.LegacyHttpProxy;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

@RestController
public class CrmLegacyProxyController {

    private final LegacyHttpProxy proxy;

    public CrmLegacyProxyController(LegacyHttpProxy proxy) {
        this.proxy = proxy;
    }

    @RequestMapping({
            "/leads", "/leads/**",
            "/customers", "/customers/**",
            "/billing", "/billing/**"
    })
    public ResponseEntity<byte[]> forward(HttpServletRequest request) throws IOException {
        return proxy.forward(request);
    }
}
