package com.tkl.erp.auth.repository;

import com.tkl.erp.auth.domain.SysRolePermission;
import com.tkl.erp.auth.domain.SysRolePermissionId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysRolePermissionRepository extends JpaRepository<SysRolePermission, SysRolePermissionId> {
    List<SysRolePermission> findByIdRoleCode(String roleCode);
}
