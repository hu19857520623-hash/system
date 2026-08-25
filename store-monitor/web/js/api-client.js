const STORAGE_KEY = 'takealot_api_key';
const HISTORY_KEY = 'takealot_api_history';

const ApiClient = {
  getApiKey() {
    return localStorage.getItem(STORAGE_KEY) || '';
  },

  setApiKey(key) {
    localStorage.setItem(STORAGE_KEY, key);
  },

  buildUrl(path, pathParams, queryParams) {
    let url = path;
    Object.entries(pathParams).forEach(([k, v]) => {
      url = url.replace(`{${k}}`, encodeURIComponent(v));
    });

    const qs = new URLSearchParams();
    Object.entries(queryParams).forEach(([k, v]) => {
      if (v === '' || v === null || v === undefined) return;
      if (k.endsWith('__in') && typeof v === 'string' && v.includes(',')) {
        v.split(',').map((s) => s.trim()).filter(Boolean).forEach((item) => qs.append(k, item));
      } else {
        qs.append(k, v);
      }
    });

    const query = qs.toString();
    return `${window.TAKEALOT_API.baseUrl}${url}${query ? `?${query}` : ''}`;
  },

  formatDateTime(value) {
    if (!value) return value;
    if (value.includes('T') && !value.includes('+') && !value.endsWith('Z')) {
      return `${value}:00+02:00`;
    }
    return value;
  },

  async request(endpoint, { pathParams = {}, queryParams = {}, body = null }) {
    const formattedQuery = { ...queryParams };
    ['created_at__gte', 'created_at__lte'].forEach((k) => {
      if (formattedQuery[k]) formattedQuery[k] = this.formatDateTime(formattedQuery[k]);
    });

    const url = this.buildUrl(endpoint.path, pathParams, formattedQuery);
    const headers = { Accept: 'application/json' };
    const apiKey = this.getApiKey();
    if (endpoint.auth && apiKey) headers['X-API-Key'] = apiKey;

    const options = { method: endpoint.method, headers };
    if (body && ['POST', 'PATCH', 'PUT'].includes(endpoint.method)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const started = performance.now();
    const res = await fetch(url, options);
    const elapsed = Math.round(performance.now() - started);
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return {
      ok: res.ok,
      status: res.status,
      elapsed,
      url: url.replace(window.TAKEALOT_API.baseUrl, ''),
      data,
    };
  },

  saveHistory(record) {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    list.unshift({
      ...record,
      savedAt: new Date().toISOString(),
      id: Date.now(),
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 200)));
    return list;
  },

  getHistory() {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  },

  clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
  },

  exportHistory() {
    const data = this.getHistory();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `takealot-api-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  },

  async saveToServer(record) {
    const res = await fetch('/api/local/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `保存失败 HTTP ${res.status}`);
    }
    return res.json();
  },
};

window.ApiClient = ApiClient;
