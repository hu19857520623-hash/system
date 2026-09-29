const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:']);

function proxyConfig(env = process.env) {
  const raw = String(env.TAKEALOT_EGRESS_PROXY_URL || '').trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('TAKEALOT_EGRESS_PROXY_URL 格式无效，应为 http(s)://host:port 或 socks5://host:port');
  }
  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`TAKEALOT_EGRESS_PROXY_URL 不支持协议 ${parsed.protocol}`);
  }
  if (!parsed.hostname || !parsed.port) {
    throw new Error('TAKEALOT_EGRESS_PROXY_URL 必须包含主机和端口');
  }

  const username = decodeURIComponent(parsed.username || '');
  const password = decodeURIComponent(parsed.password || '');
  if ((username && !password) || (!username && password)) {
    throw new Error('出口代理认证必须同时提供用户名和密码');
  }
  if ((username || password) && parsed.protocol.startsWith('socks5')) {
    throw new Error('Chromium 不支持 SOCKS5 用户名密码认证，请改用 HTTP(S) 代理');
  }

  parsed.username = '';
  parsed.password = '';
  const serverUrl = parsed.toString().replace(/\/$/, '');

  return {
    serverUrl,
    protocol: parsed.protocol.slice(0, -1),
    auth: username ? { username, password } : null,
  };
}

function proxySummary(config) {
  return {
    configured: Boolean(config),
    protocol: config?.protocol || null,
    authenticated: Boolean(config?.auth),
  };
}

function curlConfigLine(config) {
  if (!config?.auth) return '';
  const value = `${config.auth.username}:${config.auth.password}`
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, '');
  return `proxy-user = "${value}"\n`;
}

module.exports = { proxyConfig, proxySummary, curlConfigLine };
