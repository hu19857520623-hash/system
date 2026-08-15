const ERP_MODE =
  new URLSearchParams(location.search).has('erp') || window.__ERP_MODE__ === true;
const API_BASE = ERP_MODE ? '/api/store-monitor/proxy' : '/api/proxy';
const STORAGE_KEY = 'takealot_api_key';
const SELLERS_KEY = 'takealot_sellers';
const ACTIVE_SELLER_KEY = 'takealot_active_seller_id';

let ERP_TOKEN = window.__ERP_TOKEN__ || '';
let ERP_SESSION = window.__ERP_SESSION__ || null;

function persistErpAuth(token, session) {
  ERP_TOKEN = token || '';
  ERP_SESSION = session || null;
}

function erpAuthHeaders(slot) {
  const headers = {};
  if (ERP_TOKEN) headers.Authorization = `Bearer ${ERP_TOKEN}`;
  if (slot != null) headers['X-Store-Slot'] = String(slot);
  return headers;
}

function resolveSlot(sellerOrKey) {
  if (typeof sellerOrKey === 'number') return sellerOrKey;
  if (sellerOrKey && sellerOrKey.slot != null) return sellerOrKey.slot;
  const active = TakealotAPI.getActiveSeller();
  return active?.slot ?? null;
}

const TakealotAPI = {
  isErpMode() {
    return ERP_MODE;
  },

  setErpSession(token, session) {
    persistErpAuth(token, session);
    if (session?.sellers?.length) {
      const first = session.sellers.find((s) => s.enabled) || session.sellers[0];
      if (first) this.setActiveSellerId(first.id);
    }
  },

  getActiveSellerId() {
    const enabled = this.getEnabledSellers();
    if (!enabled.length) return null;
    const saved = localStorage.getItem(ACTIVE_SELLER_KEY);
    if (saved && enabled.some((s) => s.id === saved)) return saved;
    return enabled[0].id;
  },

  setActiveSellerId(id) {
    if (id) localStorage.setItem(ACTIVE_SELLER_KEY, id);
  },

  getActiveSeller() {
    const id = this.getActiveSellerId();
    if (!id) return null;
    return this.getEnabledSellers().find((s) => s.id === id) || null;
  },

  getKey() {
    const active = this.getActiveSeller();
    if (active?.apiKey) return active.apiKey;
    return localStorage.getItem(STORAGE_KEY) || '';
  },

  setKey(key) {
    localStorage.setItem(STORAGE_KEY, key);
  },

  getSellers() {
    if (ERP_MODE && ERP_SESSION?.sellers) return ERP_SESSION.sellers;
    try {
      const raw = localStorage.getItem(SELLERS_KEY);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length) return list;
      }
    } catch {
      /* ignore */
    }
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy) {
      return [
        {
          id: 'legacy-default',
          name: '默认卖家',
          apiKey: legacy,
          enabled: true,
        },
      ];
    }
    return [];
  },

  saveSellers(sellers) {
    localStorage.setItem(SELLERS_KEY, JSON.stringify(sellers));
    const active = this.getActiveSeller();
    if (active?.apiKey) localStorage.setItem(STORAGE_KEY, active.apiKey);
    else if (sellers[0]?.apiKey) localStorage.setItem(STORAGE_KEY, sellers[0].apiKey);
    const enabled = sellers.filter((s) => s.enabled !== false && s.apiKey);
    if (enabled.length && !enabled.some((s) => s.id === this.getActiveSellerId())) {
      this.setActiveSellerId(enabled[0].id);
    }
  },

  getEnabledSellers() {
    if (ERP_MODE) {
      return this.getSellers().filter((s) => s.enabled !== false);
    }
    return this.getSellers().filter((s) => s.enabled !== false && s.apiKey);
  },

  async runNetworkDiag() {
    const url = ERP_MODE ? '/api/store-monitor/diag' : '/api/diag';
    const res = await fetch(url, { headers: erpAuthHeaders() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.message || `网络检测失败（HTTP ${res.status}）`);
    }
    return json.data ?? json;
  },

  async runBrowserBootstrap() {
    const url = ERP_MODE ? '/api/store-monitor/browser-bootstrap' : '/api/browser-bootstrap';
    const res = await fetch(url, { method: 'POST', headers: erpAuthHeaders() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) {
      throw new Error(json.message || `浏览器通道验证失败（HTTP ${res.status}）`);
    }
    return json.data ?? json;
  },

  async erpJson(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...erpAuthHeaders(),
        ...(options.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json.code != null && json.code !== 0)) {
      throw new Error(json.message || `HTTP ${res.status}`);
    }
    return json.data ?? json;
  },

  async listErpStores() {
    return this.erpJson('/api/store-monitor/stores');
  },

  async updateErpStore(slot, body) {
    return this.erpJson(`/api/store-monitor/stores/${slot}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  async refreshErpSession() {
    const data = await this.erpJson('/api/store-monitor/session');
    persistErpAuth(ERP_TOKEN, data);
    this.setErpSession(ERP_TOKEN, data);
    return data;
  },

  async request(method, path, { query = {}, body = null, auth = true, apiKey = null, slot = null } = {}) {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v === '' || v == null) return;
      if (typeof v === 'string' && v.includes(',') && k.endsWith('__in')) {
        v.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((item) => qs.append(k, item));
      } else {
        qs.append(k, v);
      }
    });

    const url = `${API_BASE}${path}${qs.toString() ? `?${qs}` : ''}`;
    const headers = { Accept: 'application/json', ...erpAuthHeaders() };
    if (ERP_MODE && auth) {
      const s = slot ?? resolveSlot(apiKey);
      if (s != null) headers['X-Store-Slot'] = String(s);
    } else {
      const key = apiKey || (auth ? this.getKey() : null);
      if (auth && key) headers['X-API-Key'] = key;
    }

    const opts = { method, headers };
    if (body && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const started = performance.now();
    const res = await fetch(url, opts);
    const elapsed = Math.round(performance.now() - started);
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      if (typeof data === 'object' && data?.error === 'cloudflare_blocked') {
        throw new Error(
          (data.message || 'Cloudflare 拦截') + (data.hint ? `（${data.hint}）` : '')
        );
      }
      const msg =
        typeof data === 'object' && data
          ? data.message || data.description || data.title
          : typeof text === 'string' && text.toLowerCase().includes('blocked')
            ? 'Cloudflare 拦截：请在系统设置运行「网络自检」'
            : text;
      throw new Error(msg || `HTTP ${res.status}`);
    }

    return { data, status: res.status, elapsed, via: res.headers.get('X-Proxy-Via') };
  },

  async requestWithKey(apiKeyOrSeller, method, path, options = {}) {
    const slot = ERP_MODE ? resolveSlot(apiKeyOrSeller) : null;
    return this.request(method, path, { ...options, apiKey: ERP_MODE ? null : apiKeyOrSeller, slot, auth: true });
  },

  getStatus() {
    return this.request('GET', '/status', { auth: false });
  },

  getSeller(expands, apiKeyOrSeller) {
    const query = {};
    if (expands) query.expands = expands;
    const slot = ERP_MODE ? resolveSlot(apiKeyOrSeller) : null;
    return this.request('GET', '/seller', { query, apiKey: ERP_MODE ? null : apiKeyOrSeller, slot });
  },

  getBalances(apiKeyOrSeller) {
    const slot = ERP_MODE ? resolveSlot(apiKeyOrSeller) : null;
    return this.request('GET', '/balances', { apiKey: ERP_MODE ? null : apiKeyOrSeller, slot });
  },

  listOffers(query = {}, apiKeyOrSeller) {
    const slot = ERP_MODE ? resolveSlot(apiKeyOrSeller) : null;
    return this.request('GET', '/offers', { query, apiKey: ERP_MODE ? null : apiKeyOrSeller, slot });
  },

  listSales(query = {}, apiKeyOrSeller) {
    const slot = ERP_MODE ? resolveSlot(apiKeyOrSeller) : null;
    return this.request('GET', '/sales', { query, apiKey: ERP_MODE ? null : apiKeyOrSeller, slot });
  },

  /** 分页拉取日期区间内全部销售记录（SAST 日期字符串 YYYY-MM-DD） */
  async fetchAllSales(apiKeyOrSeller, { gte, lte, onProgress } = {}) {
    const slot = ERP_MODE ? resolveSlot(apiKeyOrSeller) : null;
    const apiKey = ERP_MODE ? null : apiKeyOrSeller;
    const items = [];
    const seenTokens = new Set();
    let token;
    let page = 0;

    do {
      const query = {
        limit: 100,
        order_date__gte: gte,
        order_date__lte: lte,
      };
      if (token) query.continuation_token = token;

      const { data } = await this.listSales(query, apiKey || apiKeyOrSeller);
      const batch = data.items || [];
      items.push(...batch);
      token = data.continuation_token;
      page += 1;
      onProgress?.({ loaded: items.length, count: data.count, page, sellerDone: false });
      if (token && seenTokens.has(token)) {
        throw new Error('销售接口返回了重复分页标记，已停止继续请求');
      }
      if (token) seenTokens.add(token);
      if (page >= 1000 && token) {
        throw new Error('销售数据超过 1000 页，请缩小日期范围后重试');
      }
    } while (token);

    return items;
  },

  listTransactions(query = {}, apiKeyOrSeller) {
    const slot = ERP_MODE ? resolveSlot(apiKeyOrSeller) : null;
    return this.request('GET', '/transactions', { query, apiKey: ERP_MODE ? null : apiKeyOrSeller, slot });
  },

  listShipments(query = {}, apiKeyOrSeller) {
    const slot = ERP_MODE ? resolveSlot(apiKeyOrSeller) : null;
    return this.request('GET', '/shipments', { query: { expands: 'shipment_items', ...query }, apiKey: ERP_MODE ? null : apiKeyOrSeller, slot });
  },

  listReturns(query = {}, apiKeyOrSeller) {
    const slot = ERP_MODE ? resolveSlot(apiKeyOrSeller) : null;
    return this.request('GET', '/returns', { query, apiKey: ERP_MODE ? null : apiKeyOrSeller, slot });
  },
};

window.TakealotAPI = TakealotAPI;
