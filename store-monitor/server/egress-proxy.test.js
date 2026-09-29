const test = require('node:test');
const assert = require('node:assert/strict');
const { proxyConfig, proxySummary, curlConfigLine } = require('./egress-proxy');

test('returns null when no Takealot egress proxy is configured', () => {
  assert.equal(proxyConfig({}), null);
  assert.deepEqual(proxySummary(null), {
    configured: false,
    protocol: null,
    authenticated: false,
  });
});

test('parses an authenticated HTTP proxy without retaining credentials in server URL', () => {
  const config = proxyConfig({
    TAKEALOT_EGRESS_PROXY_URL: 'http://user%40example.com:p%40ss@proxy.example.com:3128',
  });
  assert.equal(config.serverUrl, 'http://proxy.example.com:3128');
  assert.deepEqual(config.auth, { username: 'user@example.com', password: 'p@ss' });
  assert.deepEqual(proxySummary(config), {
    configured: true,
    protocol: 'http',
    authenticated: true,
  });
  assert.equal(curlConfigLine(config), 'proxy-user = "user@example.com:p@ss"\n');
});

test('rejects unsupported, incomplete, and authenticated SOCKS proxy settings', () => {
  assert.throws(() => proxyConfig({ TAKEALOT_EGRESS_PROXY_URL: 'ftp://proxy.example.com:21' }), /不支持协议/);
  assert.throws(() => proxyConfig({ TAKEALOT_EGRESS_PROXY_URL: 'http://proxy.example.com' }), /主机和端口/);
  assert.throws(() => proxyConfig({ TAKEALOT_EGRESS_PROXY_URL: 'http://user@proxy.example.com:3128' }), /同时提供/);
  assert.throws(() => proxyConfig({ TAKEALOT_EGRESS_PROXY_URL: 'socks5://user:pass@proxy.example.com:1080' }), /SOCKS5/);
});
