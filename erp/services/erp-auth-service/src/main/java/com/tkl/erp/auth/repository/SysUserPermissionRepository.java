package com.tkl.erp.auth.repository;

import com.tkl.erp.auth.domain.SysUserPermission;
import com.tkl.erp.auth.domain.SysUserPermissionId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysUserPermissionRepository extends JpaRepository<SysUserPermission, SysUserPermissionId> {
    List<SysUserPermission> findByIdUserId(Long userId);
}
