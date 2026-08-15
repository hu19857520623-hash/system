package com.tkl.erp.common.legacy;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

@AutoConfiguration
@ConditionalOnClass(LegacyHttpProxy.class)
@ConditionalOnProperty(prefix = "erp.legacy", name = "base-url")
@EnableConfigurationProperties(LegacyBackendProperties.class)
public class LegacyProxyAutoConfiguration {

    @Bean
    LegacyHttpProxy legacyHttpProxy(LegacyBackendProperties properties) {
        return new LegacyHttpProxy(properties.baseUrl());
    }
}
