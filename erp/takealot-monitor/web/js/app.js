(function () {
  const { endpoints, tags } = window.TAKEALOT_API;
  let currentEndpoint = null;
  let lastResult = null;
  let lastContinuationToken = null;

  const el = {
    nav: document.getElementById('nav'),
    apiKey: document.getElementById('apiKey'),
    saveKeyBtn: document.getElementById('saveKeyBtn'),
    sendBtn: document.getElementById('sendBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    saveResponseBtn: document.getElementById('saveResponseBtn'),
    saveDbBtn: document.getElementById('saveDbBtn'),
    exportBtn: document.getElementById('exportBtn'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    methodBadge: document.getElementById('methodBadge'),
    summaryText: document.getElementById('summaryText'),
    endpointDesc: document.getElementById('endpointDesc'),
    paramForm: document.getElementById('paramForm'),
    bodySection: document.getElementById('bodySection'),
    bodyInput: document.getElementById('bodyInput'),
    responseOutput: document.getElementById('responseOutput'),
    responseMeta: document.getElementById('responseMeta'),
    historyList: document.getElementById('historyList'),
  };

  function methodClass(m) {
    return `method-${m}`;
  }

  function renderNav() {
    el.nav.innerHTML = '';
    tags.forEach((tag) => {
      const group = document.createElement('div');
      group.className = 'nav-group';
      group.innerHTML = `<div class="nav-group-title">${tag.icon} ${tag.label}</div>`;

      endpoints
        .filter((e) => e.tag === tag.id)
        .forEach((ep) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'nav-item';
          btn.dataset.id = ep.id;
          btn.innerHTML = `<span class="method ${methodClass(ep.method)}">${ep.method}</span><span>${ep.summary}</span>`;
          btn.addEventListener('click', () => selectEndpoint(ep.id));
          group.appendChild(btn);
        });

      el.nav.appendChild(group);
    });
  }

  function renderParamField(p) {
    const row = document.createElement('div');
    row.className = 'param-row';
    row.dataset.name = p.name;
    row.dataset.in = p.in;

    const label = document.createElement('label');
    label.innerHTML = `${p.label || p.name}${p.required ? ' <span class="required">*</span>' : ''} <small>(${p.in})</small>`;

    let input;
    if (p.type === 'select') {
      input = document.createElement('select');
      p.options.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt || '— 不填 —';
        input.appendChild(o);
      });
    } else {
      input = document.createElement('input');
      input.type = p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text';
      if (p.placeholder) input.placeholder = p.placeholder;
    }
    input.name = p.name;
    input.id = `param-${p.name}`;

    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  function selectEndpoint(id) {
    currentEndpoint = endpoints.find((e) => e.id === id);
    if (!currentEndpoint) return;

    document.querySelectorAll('.nav-item').forEach((n) => {
      n.classList.toggle('active', n.dataset.id === id);
    });

    el.methodBadge.textContent = currentEndpoint.method;
    el.methodBadge.className = `method-badge ${methodClass(currentEndpoint.method)}`;
    el.summaryText.textContent = currentEndpoint.summary;
    el.endpointDesc.textContent = currentEndpoint.description || '';
    el.sendBtn.disabled = false;
    el.saveResponseBtn.disabled = true;
    el.saveDbBtn.disabled = true;
    el.nextPageBtn.classList.add('hidden');
    el.nextPageBtn.disabled = true;
    lastContinuationToken = null;
    el.responseOutput.textContent = '// 点击「发送请求」';
    el.responseMeta.innerHTML = '';

    el.paramForm.innerHTML = '';
    (currentEndpoint.params || []).forEach((p) => {
      el.paramForm.appendChild(renderParamField(p));
    });

    if (currentEndpoint.body) {
      el.bodySection.classList.remove('hidden');
      el.bodyInput.value = JSON.stringify(currentEndpoint.body.example || {}, null, 2);
    } else {
      el.bodySection.classList.add('hidden');
      el.bodyInput.value = '';
    }
  }

  function collectParams() {
    const pathParams = {};
    const queryParams = {};

    el.paramForm.querySelectorAll('.param-row').forEach((row) => {
      const name = row.dataset.name;
      const loc = row.dataset.in;
      const input = row.querySelector('input, select');
      let value = input.value.trim();
      if (!value) return;

      if (loc === 'path') pathParams[name] = value;
      else queryParams[name] = value;
    });

    return { pathParams, queryParams };
  }

  function collectBody() {
    if (!currentEndpoint.body) return null;
    const text = el.bodyInput.value.trim();
    if (!text) return null;
    return JSON.parse(text);
  }

  async function sendRequest() {
    if (!currentEndpoint) return;

    el.sendBtn.disabled = true;
    el.sendBtn.textContent = '请求中...';

    try {
      const { pathParams, queryParams } = collectParams();
      let body = null;
      if (currentEndpoint.body) {
        try {
          body = collectBody();
        } catch {
          alert('请求体 JSON 格式错误，请检查');
          return;
        }
      }

      const result = await ApiClient.request(currentEndpoint, { pathParams, queryParams, body });
      lastResult = { endpoint: currentEndpoint, pathParams, queryParams, body, result };

      const statusClass = result.ok ? 'ok' : 'err';
      el.responseMeta.innerHTML = `
        <span class="tag ${statusClass}">HTTP ${result.status}</span>
        <span class="tag">${result.elapsed}ms</span>
        <span class="tag">${result.url}</span>
      `;

      el.responseOutput.textContent =
        typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
      el.saveResponseBtn.disabled = false;
      el.saveDbBtn.disabled = false;

      const token =
        result.data &&
        typeof result.data === 'object' &&
        result.data.continuation_token;
      if (token) {
        lastContinuationToken = token;
        const hasTokenField = (currentEndpoint.params || []).some((p) => p.name === 'continuation_token');
        if (hasTokenField) {
          el.nextPageBtn.classList.remove('hidden');
          el.nextPageBtn.disabled = false;
        }
      } else {
        lastContinuationToken = null;
        el.nextPageBtn.classList.add('hidden');
        el.nextPageBtn.disabled = true;
      }
    } catch (err) {
      el.responseOutput.textContent = `请求失败: ${err.message}`;
      el.responseMeta.innerHTML = '<span class="tag err">网络错误</span>';
    } finally {
      el.sendBtn.disabled = false;
      el.sendBtn.textContent = '发送请求';
    }
  }

  function saveResponse() {
    if (!lastResult) return;
    ApiClient.saveHistory({
      endpointId: lastResult.endpoint.id,
      summary: lastResult.endpoint.summary,
      method: lastResult.endpoint.method,
      path: lastResult.endpoint.path,
      pathParams: lastResult.pathParams,
      queryParams: lastResult.queryParams,
      body: lastResult.body,
      status: lastResult.result.status,
      response: lastResult.result.data,
    });
    renderHistory();
    el.saveResponseBtn.textContent = '已保存 ✓';
    setTimeout(() => { el.saveResponseBtn.textContent = '保存到本地'; }, 1500);
  }

  async function saveToDatabaseQueue() {
    if (!lastResult) return;
    el.saveDbBtn.disabled = true;
    el.saveDbBtn.textContent = '写入中...';
    try {
      const payload = {
        module: lastResult.endpoint.tag,
        endpointId: lastResult.endpoint.id,
        summary: lastResult.endpoint.summary,
        method: lastResult.endpoint.method,
        path: lastResult.endpoint.path,
        request: {
          pathParams: lastResult.pathParams,
          queryParams: lastResult.queryParams,
          body: lastResult.body,
        },
        status: lastResult.result.status,
        response: lastResult.result.data,
        fetchedAt: new Date().toISOString(),
      };
      const saved = await ApiClient.saveToServer(payload);
      el.saveDbBtn.textContent = `已写入 ${saved.file}`;
      setTimeout(() => { el.saveDbBtn.textContent = '写入待入库'; }, 2000);
    } catch (err) {
      alert(err.message);
      el.saveDbBtn.textContent = '写入待入库';
    } finally {
      el.saveDbBtn.disabled = false;
    }
  }

  function loadNextPage() {
    if (!lastContinuationToken || !currentEndpoint) return;
    const tokenInput = document.getElementById('param-continuation_token');
    if (!tokenInput) return;

    el.paramForm.querySelectorAll('.param-row').forEach((row) => {
      const name = row.dataset.name;
      if (name === 'continuation_token') return;
      const input = row.querySelector('input, select');
      if (input) input.value = '';
    });

    tokenInput.value = lastContinuationToken;
    sendRequest();
  }

  function renderHistory() {
    const list = ApiClient.getHistory();
    if (!list.length) {
      el.historyList.innerHTML = '<p class="desc">暂无历史记录。发送请求后点击「保存到本地」。</p>';
      return;
    }

    el.historyList.innerHTML = list
      .slice(0, 30)
      .map(
        (h) => `
      <div class="history-item" data-id="${h.id}">
        <span><strong>${h.method}</strong> ${h.summary} — <span class="tag ${h.status < 400 ? 'ok' : 'err'}">${h.status}</span></span>
        <span class="time">${new Date(h.savedAt).toLocaleString('zh-CN')}</span>
      </div>`
      )
      .join('');

    el.historyList.querySelectorAll('.history-item').forEach((item) => {
      item.addEventListener('click', () => {
        const record = list.find((h) => h.id === Number(item.dataset.id));
        if (record) {
          el.responseOutput.textContent = JSON.stringify(record.response, null, 2);
          el.responseMeta.innerHTML = `<span class="tag">历史 #${record.id}</span><span class="tag">${record.status}</span>`;
        }
      });
    });
  }

  el.saveKeyBtn.addEventListener('click', () => {
    ApiClient.setApiKey(el.apiKey.value.trim());
    el.saveKeyBtn.textContent = '已保存 ✓';
    setTimeout(() => { el.saveKeyBtn.textContent = '保存'; }, 1500);
  });

  el.sendBtn.addEventListener('click', sendRequest);
  el.nextPageBtn.addEventListener('click', loadNextPage);
  el.saveResponseBtn.addEventListener('click', saveResponse);
  el.saveDbBtn.addEventListener('click', saveToDatabaseQueue);
  el.exportBtn.addEventListener('click', () => ApiClient.exportHistory());
  el.clearHistoryBtn.addEventListener('click', () => {
    if (confirm('确定清空所有本地历史记录？')) {
      ApiClient.clearHistory();
      renderHistory();
    }
  });

  el.apiKey.value = ApiClient.getApiKey();
  renderNav();
  renderHistory();
  selectEndpoint('status');
})();
