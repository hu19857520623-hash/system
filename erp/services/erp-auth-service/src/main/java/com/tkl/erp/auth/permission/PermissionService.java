package com.tkl.erp.auth.permission;

import com.tkl.erp.auth.repository.SysRolePermissionRepository;
import com.tkl.erp.auth.repository.SysUserPermissionRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class PermissionService {

    private final SysUserPermissionRepository userPermissionRepository;
    private final SysRolePermissionRepository rolePermissionRepository;
    private final PermissionsCatalogService catalogService;

    public PermissionService(
            SysUserPermissionRepository userPermissionRepository,
            SysRolePermissionRepository rolePermissionRepository,
            PermissionsCatalogService catalogService
    ) {
        this.userPermissionRepository = userPermissionRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.catalogService = catalogService;
    }

    public List<String> getUserPermissions(Long userId, String roleCode) {
        List<String> codes;
        var custom = userPermissionRepository.findByIdUserId(userId);
        if (!custom.isEmpty()) {
            codes = custom.stream().map(p -> p.getId().getPermCode()).toList();
        } else {
            var rolePerms = rolePermissionRepository.findByIdRoleCode(roleCode);
            if (!rolePerms.isEmpty()) {
                codes = rolePerms.stream().map(p -> p.getId().getPermCode()).toList();
            } else {
                codes = PermissionConstants.defaultPermsForRoleCode(roleCode);
            }
        }
        return catalogService.normalizePermCodes(codes);
    }
}
