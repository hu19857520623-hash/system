package com.tkl.erp.auth.permission;

import com.tkl.erp.auth.security.AuthPrincipal;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Component
public class PermissionAccess {

    private final PermissionService permissionService;

    public PermissionAccess(PermissionService permissionService) {
        this.permissionService = permissionService;
    }

    public void requirePerm(AuthPrincipal principal, String permCode) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "未登录");
        }
        if ("admin".equals(principal.roleCode())) {
            return;
        }
        List<String> perms = permissionService.getUserPermissions(principal.userId(), principal.roleCode());
        if (!perms.contains(permCode)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "无权限: " + permCode);
        }
    }
}
