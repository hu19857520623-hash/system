package com.tkl.erp.auth.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "sys_role")
public class SysRole {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @Column(name = "role_code", nullable = false, unique = true, length = 30)
    private String roleCode;

    @Column(name = "role_name", nullable = false, length = 50)
    private String roleName;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Instant createdAt;

    public Integer getId() { return id; }
    public String getRoleCode() { return roleCode; }
    public String getRoleName() { return roleName; }
    public String getDescription() { return description; }
    public Instant getCreatedAt() { return createdAt; }
}
