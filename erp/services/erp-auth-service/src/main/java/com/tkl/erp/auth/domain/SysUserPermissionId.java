package com.tkl.erp.auth.domain;

import jakarta.persistence.*;
import java.io.Serializable;
import java.util.Objects;

@Embeddable
public class SysUserPermissionId implements Serializable {

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "perm_code", length = 60)
    private String permCode;

    public SysUserPermissionId() {}

    public SysUserPermissionId(Long userId, String permCode) {
        this.userId = userId;
        this.permCode = permCode;
    }

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getPermCode() { return permCode; }
    public void setPermCode(String permCode) { this.permCode = permCode; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof SysUserPermissionId that)) return false;
        return Objects.equals(userId, that.userId) && Objects.equals(permCode, that.permCode);
    }

    @Override
    public int hashCode() {
        return Objects.hash(userId, permCode);
    }
}
