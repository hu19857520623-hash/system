package com.tkl.erp.auth.web.dto;

import java.util.List;

public record AuthUserDto(
        Long id,
        String username,
        String realName,
        String roleCode,
        String avatarUrl,
        List<String> permissions
) {
}
