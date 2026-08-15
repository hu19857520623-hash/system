#!/usr/bin/env node
/**
 * Generate services/erp-auth-service/.../PermissionConstants.java
 * from shared/permissions.catalog.ts (compiled to permissions.catalog.js).
 *
 * Usage (from repo root):
 *   cd backend && npm run sync:java-permissions
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const catalog = require('./permissions.catalog.js')

const OUT = path.join(
  __dirname,
  '../services/erp-auth-service/src/main/java/com/tkl/erp/auth/permission/PermissionConstants.java',
)
const JSON_OUT = path.join(
  __dirname,
  '../services/erp-auth-service/src/main/resources/permissions-catalog.json',
)

function javaString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function linesForList(items) {
  const perLine = 4
  const chunks = []
  for (let i = 0; i < items.length; i += perLine) {
    chunks.push(items.slice(i, i + perLine).map(javaString).join(', '))
  }
  return chunks.map((c) => `                    ${c}`).join(',\n')
}

const roleCodeEntries = Object.entries(catalog.ROLE_CODE_TEMPLATE)
  .map(([code, name]) => `            Map.entry(${javaString(code)}, ${javaString(name)})`)
  .join(',\n')

const rolePermEntries = Object.entries(catalog.ROLE_PERM_TEMPLATES)
  .map(([roleName, perms]) => {
    return `            Map.entry(${javaString(roleName)}, List.of(\n${linesForList(perms)}\n            ))`
  })
  .join(',\n')

const content = `package com.tkl.erp.auth.permission;

import java.util.List;
import java.util.Map;

/**
 * AUTO-GENERATED from shared/permissions.catalog.ts — do not edit by hand.
 * Regenerate: cd backend && npm run sync:java-permissions
 */
public final class PermissionConstants {

    private PermissionConstants() {}

    public static final Map<String, String> ROLE_CODE_TEMPLATE = Map.ofEntries(
${roleCodeEntries}
    );

    private static final Map<String, List<String>> ROLE_PERM_TEMPLATES = Map.ofEntries(
${rolePermEntries}
    );

    public static List<String> defaultPermsForRoleCode(String roleCode) {
        String key = ROLE_CODE_TEMPLATE.get(roleCode);
        if (key == null) {
            return List.of();
        }
        return ROLE_PERM_TEMPLATES.getOrDefault(key, List.of());
    }
}
`

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, content, 'utf8')
console.log(`Wrote ${OUT}`)

const catalogJson = {
  groups: catalog.PERM_GROUPS,
  roleDefinitions: catalog.ROLE_DEFINITIONS,
  roleCodeTemplate: catalog.ROLE_CODE_TEMPLATE,
  roleTemplates: catalog.ROLE_PERM_TEMPLATES,
  deprecated: catalog.DEPRECATED_PERM_CODES,
  aliases: catalog.PERM_ALIASES,
  allPermCodes: catalog.ALL_PERM_CODES,
}

fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true })
fs.writeFileSync(JSON_OUT, `${JSON.stringify(catalogJson, null, 2)}\n`, 'utf8')
console.log(`Wrote ${JSON_OUT}`)
