package com.tkl.erp.auth.permission;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Loads permissions-catalog.json (generated from shared/permissions.catalog.ts).
 */
@Service
public class PermissionsCatalogService {

    private final ObjectMapper objectMapper;

    private Map<String, Object> rawCatalog = Map.of();
    private Set<String> allPermCodes = Set.of();
    private Set<String> deprecatedCodes = Set.of();
    private Map<String, Object> aliases = Map.of();

    public PermissionsCatalogService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    void load() throws IOException {
        try (InputStream in = getClass().getResourceAsStream("/permissions-catalog.json")) {
            if (in == null) {
                throw new IllegalStateException("permissions-catalog.json not found on classpath");
            }
            rawCatalog = objectMapper.readValue(in, new TypeReference<>() {});
        }

        allPermCodes = new HashSet<>(readStringList("allPermCodes"));
        deprecatedCodes = new HashSet<>(readStringList("deprecated"));

        Map<String, Object> aliasMap = new LinkedHashMap<>();
        Object aliasObj = rawCatalog.get("aliases");
        if (aliasObj instanceof Map<?, ?> aliasRaw) {
            aliasRaw.forEach((k, v) -> {
                if (k != null) {
                    aliasMap.put(String.valueOf(k), v);
                }
            });
        }
        aliases = Map.copyOf(aliasMap);
    }

    public Map<String, Object> publicCatalog() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("groups", rawCatalog.get("groups"));
        out.put("roleDefinitions", rawCatalog.get("roleDefinitions"));
        out.put("roleCodeTemplate", rawCatalog.get("roleCodeTemplate"));
        out.put("roleTemplates", rawCatalog.get("roleTemplates"));
        out.put("deprecated", rawCatalog.get("deprecated"));
        out.put("aliases", rawCatalog.get("aliases"));
        return out;
    }

    public List<String> normalizePermCodes(List<String> codes) {
        Set<String> out = new LinkedHashSet<>();
        for (String raw : codes) {
            if (raw == null || raw.isBlank()) {
                continue;
            }
            if (deprecatedCodes.contains(raw)) {
                continue;
            }
            String resolved = raw;
            if (aliases.containsKey(raw)) {
                Object aliased = aliases.get(raw);
                if (aliased == null) {
                    continue;
                }
                resolved = String.valueOf(aliased);
            }
            if (allPermCodes.contains(resolved)) {
                out.add(resolved);
            }
        }
        return new ArrayList<>(out);
    }

    @SuppressWarnings("unchecked")
    private List<String> readStringList(String key) {
        Object value = rawCatalog.get(key);
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (Object item : list) {
            if (item != null) {
                out.add(String.valueOf(item));
            }
        }
        return out;
    }
}
