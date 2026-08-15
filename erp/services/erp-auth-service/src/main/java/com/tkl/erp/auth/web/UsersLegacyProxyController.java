package com.tkl.erp.auth.web;

import com.tkl.erp.common.legacy.LegacyHttpProxy;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

@RestController
public class UsersLegacyProxyController {

    private final LegacyHttpProxy proxy;

    public UsersLegacyProxyController(LegacyHttpProxy proxy) {
        this.proxy = proxy;
    }

    @RequestMapping({"/users", "/users/**"})
    public ResponseEntity<byte[]> forward(HttpServletRequest request) throws IOException {
        return proxy.forward(request);
    }
}
