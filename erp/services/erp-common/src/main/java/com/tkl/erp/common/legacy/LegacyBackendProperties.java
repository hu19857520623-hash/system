package com.tkl.erp.common.legacy;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "erp.legacy")
public record LegacyBackendProperties(String baseUrl) {
}
