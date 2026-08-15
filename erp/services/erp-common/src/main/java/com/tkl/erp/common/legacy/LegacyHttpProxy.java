package com.tkl.erp.common.legacy;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.net.URI;
import java.util.Enumeration;
import java.util.Locale;
import java.util.Set;

/**
 * Forwards requests to the legacy NestJS backend at {@code /api/**}.
 */
public class LegacyHttpProxy {

    private static final Set<String> SKIP_REQUEST_HEADERS = Set.of(
            "host", "connection", "content-length", "transfer-encoding"
    );

    private final RestClient restClient;
    private final String legacyBaseUrl;

    public LegacyHttpProxy(String legacyBaseUrl) {
        this.legacyBaseUrl = legacyBaseUrl.endsWith("/")
                ? legacyBaseUrl.substring(0, legacyBaseUrl.length() - 1)
                : legacyBaseUrl;
        this.restClient = RestClient.create();
    }

    public ResponseEntity<byte[]> forward(HttpServletRequest request) throws IOException {
        String path = request.getRequestURI();
        String query = request.getQueryString();
        String target = legacyBaseUrl + "/api" + path + (query != null ? "?" + query : "");

        HttpMethod method = HttpMethod.valueOf(request.getMethod().toUpperCase(Locale.ROOT));
        byte[] body = hasRequestBody(method) ? request.getInputStream().readAllBytes() : null;

        RestClient.RequestBodySpec spec = restClient.method(method)
                .uri(URI.create(target))
                .headers(headers -> copyRequestHeaders(request, headers));

        if (body != null && body.length > 0) {
            spec.body(body);
        }

        return spec.exchange((req, res) -> ResponseEntity
                .status(res.getStatusCode())
                .headers(filterResponseHeaders(res.getHeaders()))
                .body(res.getBody().readAllBytes()));
    }

    private static HttpHeaders filterResponseHeaders(HttpHeaders source) {
        HttpHeaders headers = new HttpHeaders();
        source.forEach((name, values) -> {
            if (!"transfer-encoding".equalsIgnoreCase(name)) {
                headers.addAll(name, values);
            }
        });
        return headers;
    }

    private static boolean hasRequestBody(HttpMethod method) {
        return method == HttpMethod.POST
                || method == HttpMethod.PUT
                || method == HttpMethod.PATCH
                || method == HttpMethod.DELETE;
    }

    private static void copyRequestHeaders(HttpServletRequest request, HttpHeaders headers) {
        Enumeration<String> names = request.getHeaderNames();
        while (names.hasMoreElements()) {
            String name = names.nextElement();
            if (SKIP_REQUEST_HEADERS.contains(name.toLowerCase(Locale.ROOT))) {
                continue;
            }
            Enumeration<String> values = request.getHeaders(name);
            while (values.hasMoreElements()) {
                headers.add(name, values.nextElement());
            }
        }
    }
}
