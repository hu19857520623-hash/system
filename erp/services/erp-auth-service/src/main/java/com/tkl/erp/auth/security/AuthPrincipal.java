package com.tkl.erp.auth.security;

public record AuthPrincipal(
        Long userId,
        String username,
        String roleCode,
        String realName
) {
}
