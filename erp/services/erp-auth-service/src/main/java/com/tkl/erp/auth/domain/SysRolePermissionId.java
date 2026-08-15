package com.tkl.erp.auth.domain;

import jakarta.persistence.*;
import java.io.Serializable;
import java.util.Objects;

@Embeddable
public class SysRolePermissionId implements Serializable {

    @Column(name = "role_code", length = 30)
    private String roleCode;

    @Column(name = "perm_code", length = 60)
    private String permCode;

    public SysRolePermissionId() {}

    public SysRolePermissionId(String roleCode, String permCode) {
        this.roleCode = roleCode;
        this.permCode = permCode;
    }

    public String getRoleCode() { return roleCode; }
    public void setRoleCode(String roleCode) { this.roleCode = roleCode; }
    public String getPermCode() { return permCode; }
    public void setPermCode(String permCode) { this.permCode = permCode; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof SysRolePermissionId that)) return false;
        return Objects.equals(roleCode, that.roleCode) && Objects.equals(permCode, that.permCode);
    }

    @Override
    public int hashCode() {
        return Objects.hash(roleCode, permCode);
    }
}
