package com.tkl.erp.auth.repository;

import com.tkl.erp.auth.domain.SysRole;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SysRoleRepository extends JpaRepository<SysRole, Integer> {
    Optional<SysRole> findByRoleCode(String roleCode);
}
