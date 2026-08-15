package com.tkl.erp.auth.web.dto;

import jakarta.validation.constraints.Size;

public record UpdateProfileRequest(
        @Size(max = 64) String realName,
        @Size(max = 32) String phone,
        @Size(max = 128) String email
) {
}
