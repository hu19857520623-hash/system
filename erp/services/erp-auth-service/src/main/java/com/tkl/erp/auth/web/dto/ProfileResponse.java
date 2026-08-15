package com.tkl.erp.auth.web.dto;

import java.time.Instant;
import java.util.List;

public record ProfileResponse(
        Long id,
        String username,
        String realName,
        String phone,
        String email,
        String avatarUrl,
        String roleCode,
        String roleName,
        Instant lastLoginAt,
        List<String> permissions
) {
}
