const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const API_ORIGIN = 'https://marketplace-api.takealot.com';
const PROFILE_DIR = path.join(__dirname, '../data/chrome-profile');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.EDGE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

let browserPromise = null;
let visibleBootstrapPromise = null;

function findBrowserExecutable() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function isCloudflareHtml(body) {
  if (!body || typeof body !== 'string') return false;
  const lower = body.toLowerCase();
  return (
    lower.includes('you have been blocked') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('cloudflare ray id') ||
    lower.includes('attention required') ||
    (lower.includes('cloudflare') && lower.includes('<html'))
  );
}

function stealthPage(page) {
  return page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
  });
}

async function waitForApiReady(page, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await page.evaluate(() => document.body?.innerText || '');
    if (text.includes('"status"') && text.includes('ok')) return true;
    if (isCloudflareHtml(text)) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (text.trim().startsWith('{')) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

async function launchBrowser({ visible = false } = {}) {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new Error('未找到本机 Chrome 或 Edge，请安装 Google Chrome 后重试');
  }

  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${PROFILE_DIR}`,
  ];

  if (!visible) {
    args.push('--window-position=-32000,-32000', '--window-size=800,600');
  }

  return puppeteer.launch({
    executablePath,
    headless: visible ? false : true,
    defaultViewport: visible ? null : { width: 1280, height: 800 },
    args,
  });
}

async function getBrowser() {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (existing.isConnected()) return existing;
    } catch {
      browserPromise = null;
    }
  }

  browserPromise = launchBrowser({ visible: false });
  const browser = await browserPromise;
  browser.on('disconnected', () => {
    browserPromise = null;
  });
  return browser;
}

async function proxyViaBrowser(targetUrl, method, headers, body) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await stealthPage(page);

  try {
    await page.setUserAgent(
      headers['User-Agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    await page.goto(`${API_ORIGIN}/v1/status`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    const ready = await waitForApiReady(page, 45000);
    if (!ready) {
      const html = await page.content();
      if (isCloudflareHtml(html)) {
        const err = new Error(
          'Chrome 也被 Cloudflare 拦截。请在系统设置点击「浏览器验证」完成一次人工验证，或换手机热点/VPN 后重试'
        );
        err.code = 'cloudflare';
        throw err;
      }
    }

    const parsed = new URL(targetUrl);
    const apiPath = `${parsed.pathname}${parsed.search}`;
    const fetchHeaders = { Accept: 'application/json' };
    if (headers['X-API-Key']) fetchHeaders['X-API-Key'] = headers['X-API-Key'];
    if (body) fetchHeaders['Content-Type'] = 'application/json';

    const result = await page.evaluate(
      async ({ apiPath, method, fetchHeaders, body }) => {
        const opts = { method, headers: fetchHeaders };
        if (body) opts.body = body;
        const res = await fetch(apiPath, opts);
        return { status: res.status, body: await res.text() };
      },
      { apiPath, method, fetchHeaders, body }
    );

    if (isCloudflareHtml(result.body)) {
      const err = new Error('Chrome 请求被 Cloudflare 拦截，请运行「浏览器验证」');
      err.code = 'cloudflare';
      throw err;
    }

    return {
      status: result.status,
      body: result.body,
      headers: { 'content-type': 'application/json' },
      via: 'chrome',
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function closeSharedBrowser() {
  const current = browserPromise;
  browserPromise = null;
  if (!current) return;
  try {
    const browser = await current;
    if (browser.isConnected()) await browser.close();
  } catch {
    /* The shared browser was already unavailable. */
  }
}

/** 弹出可见 Chrome，让用户手动通过 Cloudflare 验证，Cookie 写入本地 profile */
async function runVisibleBootstrap() {
  if (visibleBootstrapPromise) return visibleBootstrapPromise;

  visibleBootstrapPromise = (async () => {
    let browser;
    try {
      // The headless diagnostic browser uses the same persistent profile.
      // Close it before opening a visible instance to avoid profile-lock failures.
      await closeSharedBrowser();
      browser = await launchBrowser({ visible: true });
      const page = await browser.newPage();
      await stealthPage(page);
      await page.goto(`${API_ORIGIN}/v1/status`, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });

      const ok = await waitForApiReady(page, 120000);
      const text = await page.evaluate(() => document.body?.innerText || '');

      return {
        ok,
        message: ok
          ? '验证成功，已保存 Cookie，可关闭弹出的浏览器窗口'
          : '未检测到 API 正常响应，请确认页面显示 {"status":"ok"} 后重试',
        preview: text.slice(0, 200),
      };
    } finally {
      if (browser) await browser.close().catch(() => {});
      visibleBootstrapPromise = null;
      browserPromise = null;
    }
  })();

  return visibleBootstrapPromise;
}

async function testBrowserAccess() {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    return { ok: false, via: 'chrome', message: '未找到 Chrome/Edge（请安装 Google Chrome）' };
  }

  try {
    const result = await proxyViaBrowser(`${API_ORIGIN}/v1/status`, 'GET', {}, null);
    const ok = result.status === 200 && result.body.includes('"ok"');
    return {
      ok,
      via: 'chrome',
      status: result.status,
      message: ok
        ? 'Chrome 浏览器通道正常（与地址栏访问相同引擎）'
        : `HTTP ${result.status}`,
      browser: path.basename(path.dirname(executablePath)),
    };
  } catch (err) {
    return { ok: false, via: 'chrome', message: err.message };
  }
}

process.on('SIGINT', async () => {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      await b.close();
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
});

module.exports = {
  findBrowserExecutable,
  proxyViaBrowser,
  testBrowserAccess,
  runVisibleBootstrap,
  isCloudflareHtml,
};
