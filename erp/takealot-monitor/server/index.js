const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const os = require('os');
const {
  proxyViaBrowser,
  testBrowserAccess,
  runVisibleBootstrap,
  findBrowserExecutable,
  isCloudflareHtml,
} = require('./browser-proxy');

const app = express();
const PORT = process.env.PORT || 3456;
const TAKEALOT_BASE = 'https://marketplace-api.takealot.com/v1';
const DATA_DIR = path.join(__dirname, '../data/snapshots');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../web')));

app.post('/api/local/store', (req, res) => {
  try {
    const payload = req.body || {};
    const module = (payload.module || 'unknown').replace(/[^\w-]/g, '_');
    const endpointId = (payload.endpointId || 'record').replace(/[^\w-]/g, '_');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${module}__${endpointId}__${ts}.json`;
    const filepath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8');
    res.json({ ok: true, file: filename, path: filepath });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get('/api/local/list', (_req, res) => {
  try {
    const files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({
        file: f,
        size: fs.statSync(path.join(DATA_DIR, f)).size,
        mtime: fs.statSync(path.join(DATA_DIR, f)).mtime,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ count: files.length, files });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

const BROWSER_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  Origin: 'https://sellers.takealot.com',
  Referer: 'https://sellers.takealot.com/',
  'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function isCloudflareBlock(body, contentType) {
  if (isCloudflareHtml(body)) return true;
  if (!body || typeof body !== 'string') return false;
  const lower = body.toLowerCase();
  return (
    lower.includes('you have been blocked') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('cloudflare ray id') ||
    (String(contentType || '').includes('text/html') && lower.includes('cloudflare'))
  );
}

function cloudflareJson(via) {
  return {
    error: 'cloudflare_blocked',
    title: 'Cloudflare 安全拦截',
    message:
      `所有脚本通道（${via || 'curl/node'}）均被 Cloudflare 拦截。` +
      ' v1.0.2 已优先使用本机 Chrome 转发；若仍失败，请换家庭宽带/手机热点，或使用南非/欧美 VPN 后重启 启动.bat。',
    hint: '在系统设置点击「网络自检」查看各通道结果。',
  };
}

function proxyViaCurl(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const args = [
      '-sS',
      '-L',
      '--max-time',
      '90',
      '-X',
      method,
      '-w',
      '\n__HTTP_CODE__%{http_code}',
    ];

    Object.entries(headers).forEach(([k, v]) => {
      if (v != null && v !== '') args.push('-H', `${k}: ${v}`);
    });

    if (body) {
      args.push('-H', 'Content-Type: application/json');
      args.push('--data-binary', body);
    }

    args.push(url);

    const proc = spawn(curlBin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => reject(err));

    proc.on('close', (code) => {
      const marker = stdout.lastIndexOf('\n__HTTP_CODE__');
      const status = marker >= 0 ? parseInt(stdout.slice(marker + 14).trim(), 10) : 0;
      const responseBody = marker >= 0 ? stdout.slice(0, marker) : stdout;

      if (!status && code !== 0) {
        return reject(new Error(stderr.trim() || `curl 退出码 ${code}`));
      }

      resolve({
        status: status || 502,
        body: responseBody,
        headers: { 'content-type': 'application/json' },
        via: 'curl',
      });
    });
  });
}

function proxyViaNodeHttps(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const options = { method, headers };
    const request = https.request(url, options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          via: 'node-https',
        });
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function testCurlAccess() {
  try {
    const result = await proxyViaCurl(`${TAKEALOT_BASE}/status`, 'GET', BROWSER_HEADERS, null);
    const ok = result.status === 200 && result.body.includes('"ok"') && !isCloudflareBlock(result.body);
    return {
      ok,
      via: 'curl',
      status: result.status,
      message: ok ? 'curl 通道正常' : isCloudflareBlock(result.body) ? 'curl 被 Cloudflare 拦截' : `HTTP ${result.status}`,
    };
  } catch (err) {
    return { ok: false, via: 'curl', message: err.message };
  }
}

async function testNodeAccess() {
  try {
    const result = await proxyViaNodeHttps(`${TAKEALOT_BASE}/status`, 'GET', BROWSER_HEADERS, null);
    const ok = result.status === 200 && result.body.includes('"ok"') && !isCloudflareBlock(result.body);
    return {
      ok,
      via: 'node-https',
      status: result.status,
      message: ok ? 'node https 通道正常' : isCloudflareBlock(result.body) ? 'node 被 Cloudflare 拦截' : `HTTP ${result.status}`,
    };
  } catch (err) {
    return { ok: false, via: 'node-https', message: err.message };
  }
}

async function forwardToTakealot(targetUrl, method, headers, body) {
  const errors = [];

  if (findBrowserExecutable()) {
    try {
      const chromeResult = await proxyViaBrowser(targetUrl, method, headers, body);
      if (!isCloudflareBlock(chromeResult.body, chromeResult.headers['content-type'])) {
        return chromeResult;
      }
      errors.push('chrome: Cloudflare 拦截');
    } catch (err) {
      errors.push(`chrome: ${err.message}`);
      console.warn('[proxy] chrome 失败:', err.message);
    }
  } else {
    errors.push('chrome: 未安装 Chrome/Edge');
  }

  try {
    const curlResult = await proxyViaCurl(targetUrl, method, headers, body);
    if (!isCloudflareBlock(curlResult.body, curlResult.headers['content-type'])) {
      return curlResult;
    }
    errors.push('curl: Cloudflare 拦截');
  } catch (err) {
    errors.push(`curl: ${err.message}`);
    console.warn('[proxy] curl 失败:', err.message);
  }

  const nodeResult = await proxyViaNodeHttps(targetUrl, method, headers, body);
  if (!isCloudflareBlock(nodeResult.body, nodeResult.headers['content-type'])) {
    return nodeResult;
  }

  errors.push('node: Cloudflare 拦截');
  const fail = new Error(errors.join(' | '));
  fail.via = 'all-failed';
  fail.lastBody = nodeResult.body;
  throw fail;
}

app.post('/api/browser-bootstrap', async (_req, res) => {
  try {
    const result = await runVisibleBootstrap();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get('/api/diag', async (_req, res) => {
  const [chrome, curl, node] = await Promise.all([
    testBrowserAccess(),
    testCurlAccess(),
    testNodeAccess(),
  ]);

  res.json({
    version: '1.1.0',
    platform: os.platform(),
    browserInstalled: Boolean(findBrowserExecutable()),
    channels: { chrome, curl, node },
    recommendation: chrome.ok
      ? '使用本地代理（Chrome 通道可用）'
      : curl.ok
        ? '使用本地代理（curl 通道可用）'
        : '当前网络/IP 可能被 Cloudflare 全面拦截，请换网络或 VPN',
  });
});

app.use('/api/proxy', async (req, res) => {
  const apiPath = req.url || '/';
  const targetUrl = `${TAKEALOT_BASE}${apiPath}`;

  const apiKey = req.headers['x-api-key'] || '';
  const headers = { ...BROWSER_HEADERS };
  if (apiKey) headers['X-API-Key'] = apiKey;

  try {
    const body =
      req.method !== 'GET' && req.method !== 'HEAD' && req.body
        ? JSON.stringify(req.body)
        : null;

    const result = await forwardToTakealot(targetUrl, req.method, headers, body);

    res.status(result.status);
    res.set('Content-Type', result.headers['content-type'] || 'application/json');
    res.set('X-Proxy-Via', result.via || 'unknown');
    res.send(result.body);
  } catch (err) {
    if (err.via === 'all-failed' || isCloudflareBlock(err.lastBody)) {
      return res.status(403).json(cloudflareJson('chrome/curl/node'));
    }
    res.status(502).json({
      error: 'proxy_failed',
      message: err.message,
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

app.listen(PORT, () => {
  const browser = findBrowserExecutable();
  console.log(`Takealot 卖家数据中心: http://localhost:${PORT}`);
  console.log(
    `代理模式: 优先 Chrome (${browser ? path.basename(path.dirname(browser)) : '未找到'}) → curl → node https`
  );
  if (!browser) {
    console.warn('提示: 未检测到 Chrome/Edge，请安装 Google Chrome 以获得最佳兼容性');
  }
});
