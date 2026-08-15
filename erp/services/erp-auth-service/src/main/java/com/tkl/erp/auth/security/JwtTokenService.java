package com.tkl.erp.auth.security;

import com.tkl.erp.auth.config.JwtProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class JwtTokenService {

    private static final Pattern DURATION = Pattern.compile("^(\\d+)([dhms])$");

    private final SecretKey secretKey;
    private final Duration expiration;

    public JwtTokenService(JwtProperties properties) {
        String secret = properties.secret() != null && !properties.secret().isBlank()
                ? properties.secret()
                : "takealot-erp-secret";
        this.secretKey = buildSecretKey(secret);
        this.expiration = parseExpiration(properties.expiresIn());
    }

    /** Compatible with NestJS jsonwebtoken which accepts secrets shorter than 256 bits. */
    private static SecretKey buildSecretKey(String secret) {
        byte[] keyBytes = secret.getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length >= 32) {
            return Keys.hmacShaKeyFor(keyBytes);
        }
        return new SecretKeySpec(keyBytes, "HmacSHA256");
    }

    public String createToken(AuthPrincipal principal) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(String.valueOf(principal.userId()))
                .claim("username", principal.username())
                .claim("roleCode", principal.roleCode())
                .claim("realName", principal.realName())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(expiration)))
                .signWith(secretKey)
                .compact();
    }

    public AuthPrincipal parseToken(String token) {
        Claims claims = Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();

        return new AuthPrincipal(
                Long.parseLong(claims.getSubject()),
                claims.get("username", String.class),
                claims.get("roleCode", String.class),
                claims.get("realName", String.class)
        );
    }

    private Duration parseExpiration(String raw) {
        if (raw == null || raw.isBlank()) {
            return Duration.ofDays(7);
        }
        Matcher matcher = DURATION.matcher(raw.trim());
        if (!matcher.matches()) {
            return Duration.ofDays(7);
        }
        long amount = Long.parseLong(matcher.group(1));
        return switch (matcher.group(2)) {
            case "d" -> Duration.ofDays(amount);
            case "h" -> Duration.ofHours(amount);
            case "m" -> Duration.ofMinutes(amount);
            case "s" -> Duration.ofSeconds(amount);
            default -> Duration.ofDays(7);
        };
    }
}
