package com.tkl.erp.common.api;

import java.time.Instant;

public record ServiceInfo(
        String service,
        String version,
        String status,
        Instant startedAt
) {
}
