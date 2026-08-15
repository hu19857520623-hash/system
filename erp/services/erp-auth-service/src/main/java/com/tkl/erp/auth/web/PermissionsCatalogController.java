package com.tkl.erp.auth.web;

import com.tkl.erp.auth.permission.PermissionAccess;
import com.tkl.erp.auth.permission.PermissionsCatalogService;
import com.tkl.erp.auth.security.AuthPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/permissions")
public class PermissionsCatalogController {

    private final PermissionsCatalogService catalogService;
    private final PermissionAccess permissionAccess;

    public PermissionsCatalogController(
            PermissionsCatalogService catalogService,
            PermissionAccess permissionAccess
    ) {
        this.catalogService = catalogService;
        this.permissionAccess = permissionAccess;
    }

    @GetMapping("/catalog")
    public Map<String, Object> catalog(@AuthenticationPrincipal AuthPrincipal principal) {
        permissionAccess.requirePerm(principal, "permissions.view");
        return catalogService.publicCatalog();
    }
}
