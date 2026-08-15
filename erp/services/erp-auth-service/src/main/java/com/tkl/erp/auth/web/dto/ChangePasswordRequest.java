package com.tkl.erp.auth.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ChangePasswordRequest(
        @NotBlank String oldPassword,
        @NotBlank @Size(min = 6, message = "新密码至少 6 位") String newPassword
) {
}
