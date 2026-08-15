package com.tkl.erp.auth.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "sys_user_permission")
public class SysUserPermission {

    @EmbeddedId
    private SysUserPermissionId id;

    public SysUserPermissionId getId() { return id; }
    public void setId(SysUserPermissionId id) { this.id = id; }
}
