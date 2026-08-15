package com.tkl.erp.auth.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "erp.jwt")
public record JwtProperties(String secret, String expiresIn) {
}
