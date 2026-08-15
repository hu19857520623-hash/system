package com.tkl.erp.auth.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "sys_role_permission")
public class SysRolePermission {

    @EmbeddedId
    private SysRolePermissionId id;

    public SysRolePermissionId getId() { return id; }
    public void setId(SysRolePermissionId id) { this.id = id; }
}
