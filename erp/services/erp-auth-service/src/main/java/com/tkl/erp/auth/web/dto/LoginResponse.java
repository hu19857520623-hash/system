package com.tkl.erp.auth.web.dto;

public record LoginResponse(String token, AuthUserDto user) {
}
