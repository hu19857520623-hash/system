(function () {
  const VIEWS = {
    overview: { title: '数据概览', loader: loadOverview },
    rankMonth: { title: '月销售排名', loader: loadRankMonth },
    rankYesterday: { title: '昨日销售排名', loader: loadRankYesterday },
    offers: { title: '商品报价', loader: loadOffers },
    sales: { title: '销售订单', loader: loadSales },
    transactions: { title: '交易流水', loader: loadTransactions },
    shipments: { title: '发货管理', loader: loadShipments },
    returns: { title: '退货管理', loader: loadReturns },
    seller: { title: '卖家信息', loader: loadSeller },
    settings: { title: '系统设置', loader: loadSettings },
  };

  const state = {
    view: 'overview',
    tokens: {},
    filters: {},
    rankCache: {},
    expandedSeller: null,
  };

  const SELLER_SCOPED_VIEWS = new Set([
    'overview',
    'offers',
    'sales',
    'transactions',
    'shipments',
    'returns',
    'seller',
  ]);

  const $ = (sel) => document.querySelector(sel);
  const main = $('#mainContent');
  const pageTitle = $('#pageTitle');
  const apiPill = $('#apiStatusPill');
  const sellerSwitcherWrap = $('#sellerSwitcherWrap');
  const sellerSwitcher = $('#sellerSwitcher');

  function activeSellerLabel() {
    const s = TakealotAPI.getActiveSeller();
    if (!s) return '卖家';
    return s.displayName || s.name || `卖家 ${s.sellerId || ''}`;
  }

  function getTokenStore(view) {
    const sid = TakealotAPI.getActiveSellerId() || '_';
    const k = `${sid}:${view}`;
    if (!state.tokens[k]) state.tokens[k] = { stack: [], next: null };
    return state.tokens[k];
  }

  function updateSellerSwitcher() {
    const sellers = TakealotAPI.getEnabledSellers();
    const show = SELLER_SCOPED_VIEWS.has(state.view) && sellers.length > 0;
    sellerSwitcherWrap.hidden = !show;
    if (!show) return;

    const activeId = TakealotAPI.getActiveSellerId();
    sellerSwitcher.innerHTML = '';
    sellers.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.displayName || s.name || '未命名卖家'}${s.sellerId ? ` · ID ${s.sellerId}` : ''}`;
      if (s.id === activeId) opt.selected = true;
      sellerSwitcher.appendChild(opt);
    });
  }

  function toast(msg, isError) {
    const wrap = $('#toastWrap');
    const el = document.createElement('div');
    el.className = `toast${isError ? ' error' : ''}`;
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function fmtMoney(v) {
    if (v == null || v === '') return '—';
    return `R ${Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;
  }

  function fmtDate(v) {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleString('zh-CN', { hour12: false });
    } catch {
      return v;
    }
  }

  function statusBadge(status) {
    if (!status) return '<span class="badge badge-neutral">—</span>';
    const s = String(status).toLowerCase();
    if (s.includes('buyable') || s.includes('shipped') || s.includes('completed') || s.includes('success'))
      return `<span class="badge badge-success">${status}</span>`;
    if (s.includes('disabled') || s.includes('cancel') || s.includes('fail'))
      return `<span class="badge badge-danger">${status}</span>`;
    if (s.includes('prepar') || s.includes('pending') || s.includes('draft'))
      return `<span class="badge badge-warning">${status}</span>`;
    return `<span class="badge badge-info">${status}</span>`;
  }

  function loading(html) {
    main.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>${html || '加载数据中...'}</p></div>`;
  }

  function errorPanel(msg) {
    main.innerHTML = `<div class="panel"><div class="error-state"><p>${msg}</p><button class="btn btn-primary btn-sm" onclick="location.reload()">重试</button></div></div>`;
  }

  function needSellers() {
    if (TakealotAPI.getEnabledSellers().length) return false;
    main.innerHTML = `
      <div class="panel">
        <div class="empty-state">
          <p>请先在「系统设置 → 纳管卖家」中添加至少一个 API Key</p>
          <button class="btn btn-primary" data-goto="settings">去设置</button>
        </div>
      </div>`;
    main.querySelector('[data-goto]')?.addEventListener('click', () => switchView('settings'));
    return true;
  }

  function needKey() {
    if (TakealotAPI.isErpMode?.()) {
      if (TakealotAPI.getActiveSeller()) return false;
      main.innerHTML = `
        <div class="panel">
          <div class="empty-state">
            <p>暂无可用店铺。请使用页面顶部「配置店铺 API」绑定 Takealot API Key，或由主管分配陪跑店铺。</p>
          </div>
        </div>`;
      return true;
    }
    if (TakealotAPI.getActiveSeller()) return false;
    main.innerHTML = `
      <div class="panel">
        <div class="empty-state">
          <p>请先在「系统设置 → 纳管卖家」中添加并选择卖家</p>
          <button class="btn btn-primary" data-goto="settings">去设置</button>
        </div>
      </div>`;
    main.querySelector('[data-goto]')?.addEventListener('click', () => switchView('settings'));
    return true;
  }

  function tablePanel(title, headers, rows, pagerHtml) {
    const head = headers.map((h) => `<th>${h}</th>`).join('');
    const body = rows.length
      ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${headers.length}"><div class="empty-state">暂无数据</div></td></tr>`;

    return `
      <div class="panel">
        <div class="panel-head"><h2>${title}</h2></div>
        <div class="panel-body">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr>${head}</tr></thead>
              <tbody>${body}</tbody>
            </table>
          </div>
          ${pagerHtml || ''}
        </div>
      </div>`;
  }

  function pagerHtml(view, token, count, itemsLen) {
    const store = getTokenStore(view);
    const hasNext = !!token;
    const hasPrev = store.stack.length > 0;
    return `
      <div class="pager">
        <span>本页 ${itemsLen} 条${count != null ? ` · 共 ${count} 条` : ''}</span>
        <div>
          <button class="btn btn-ghost btn-sm" data-page="prev" ${!hasPrev ? 'disabled' : ''}>上一页</button>
          <button class="btn btn-primary btn-sm" data-page="next" ${!hasNext ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
  }

  async function checkApiStatus() {
    if (TakealotAPI.isErpMode?.() && !ERP_TOKEN) return;
    try {
      if (TakealotAPI.isErpMode?.()) {
        await TakealotAPI.runNetworkDiag();
      } else {
        await TakealotAPI.getStatus();
      }
      apiPill.className = 'api-pill online';
      apiPill.innerHTML = '<span class="dot"></span><span>API 在线</span>';
    } catch {
      apiPill.className = 'api-pill offline';
      apiPill.innerHTML = '<span class="dot"></span><span>API 离线</span>';
    }
  }

  function onErpAuth(token, session) {
    TakealotAPI.setErpSession(token, session);
    updateSellerSwitcher();
    checkApiStatus();
    const startView = TakealotAPI.isErpMode?.() ? 'overview' : (TakealotAPI.getEnabledSellers().length ? 'overview' : 'settings');
    switchView(startView);
  }

  function waitForErpAuth() {
    loading('正在连接 ERP…');
    if (ERP_TOKEN && ERP_SESSION) {
      onErpAuth(ERP_TOKEN, ERP_SESSION);
      return;
    }
    try {
      window.parent?.postMessage({ type: 'erp-monitor-ready' }, window.location.origin);
    } catch { /* parent may be unavailable in standalone mode */ }
  }

  function pctShare(part, total) {
    if (!total) return '0%';
    return `${((part / total) * 100).toFixed(1)}%`;
  }

  function progressPanel(detail) {
    return `
      <div class="panel progress-panel">
        <div class="panel-body" style="padding:24px;">
          <div class="loading-state" style="padding:20px;">
            <div class="spinner"></div>
            <p id="rankProgressText">${detail || '正在汇总多卖家销售数据…'}</p>
            <p class="hint" style="margin-top:8px;">数据按南非时间 (SAST) 统计，卖家较多时请耐心等待</p>
          </div>
        </div>
      </div>`;
  }

  function renderRankSummary(report) {
    const okCount = report.ranked.filter((r) => !r.error).length;
    return `
      <div class="stats-grid">
        <div class="stat-card accent">
          <div class="label">总销售额 (GMV)</div>
          <div class="value">${fmtMoney(report.totalGmv)}</div>
          <div class="sub">${report.label} · SAST</div>
        </div>
        <div class="stat-card">
          <div class="label">纳管卖家</div>
          <div class="value">${report.sellerCount}</div>
          <div class="sub">成功 ${okCount} 个</div>
        </div>
        <div class="stat-card">
          <div class="label">订单数</div>
          <div class="value">${report.totalOrders}</div>
          <div class="sub">已排除取消/退款</div>
        </div>
        <div class="stat-card">
          <div class="label">销售件数</div>
          <div class="value">${report.totalUnits}</div>
          <div class="sub">有效销售行合计</div>
        </div>
      </div>`;
  }

  function renderRankTable(ranked, totalGmv, { clickable = false } = {}) {
    const maxGmv = ranked[0]?.agg?.gmv || 1;
    const rows = ranked.map((r) => {
      const agg = r.agg || {};
      const share = pctShare(agg.gmv || 0, totalGmv);
      const barW = Math.max(4, Math.round(((agg.gmv || 0) / maxGmv) * 100));
      const nameCell = r.error
        ? `<strong>${r.name}</strong><br><span class="badge badge-danger">${r.error}</span>`
        : `<strong>${r.displayName || r.name}</strong><br><span class="sub-text">${r.name}</span>`;
      const rowAttr = clickable && !r.error ? ` class="rank-row-clickable" data-seller-id="${r.sellerId}"` : '';
      return `<tr${rowAttr}>
        <td class="rank-cell">${SellerAnalytics.rankMedal(r.rank)}</td>
        <td>${nameCell}</td>
        <td><span class="mono">${r.sellerId || '—'}</span></td>
        <td>${agg.orderCount ?? '—'}</td>
        <td>${agg.units ?? '—'}</td>
        <td><strong>${fmtMoney(agg.gmv)}</strong></td>
        <td>${fmtMoney(agg.fees)}</td>
        <td>${fmtMoney(agg.net)}</td>
        <td>
          <div class="share-cell">
            <span>${share}</span>
            <div class="share-bar"><div class="share-fill" style="width:${barW}%"></div></div>
          </div>
        </td>
      </tr>`;
    });

    return `
      <div class="panel">
        <div class="panel-head"><h2>卖家销售额排名</h2></div>
        <div class="table-wrap">
          <table class="data-table rank-table">
            <thead><tr>
              <th>排名</th><th>卖家</th><th>卖家 ID</th><th>订单</th><th>件数</th>
              <th>GMV</th><th>费用</th><th>净额</th><th>占比</th>
            </tr></thead>
            <tbody>${rows.join('') || '<tr><td colspan="9"><div class="empty-state">暂无数据</div></td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderSalesDetailTable(items, { filterSellerId = null } = {}) {
    const filtered = filterSellerId
      ? items.filter((s) => String(s._sellerId) === String(filterSellerId))
      : items;

    const rows = filtered.map((s) => [
      s._sellerName || '—',
      `<span class="mono">${s.order_id}</span>`,
      `<span class="mono">${s.order_item_id}</span>`,
      s.sku || '—',
      statusBadge(s.sale_status),
      s.quantity ?? '—',
      fmtMoney(s.selling_price),
      fmtMoney(SellerAnalytics.lineRevenue(s)),
      fmtMoney(s.total_fees),
      s.sales_region || '—',
      fmtDate(s.order_date),
    ]);

    return tablePanel(
      filterSellerId ? `订单明细（卖家 ${filterSellerId}）` : '全部订单明细',
      ['卖家', '订单 ID', '条目 ID', 'SKU', '状态', '数量', '单价', '行 GMV', '费用', '区域', '下单时间'],
      rows,
      `<p class="detail-foot">共 ${filtered.length} 条销售记录</p>`
    );
  }

  async function loadRankMonth(force) {
    if (needSellers()) return;
    const f = state.filters.rankMonth || {};
    const monthInput = f.month || '';
    const range = monthInput
      ? (() => {
          const [y, m] = monthInput.split('-');
          const today = SellerAnalytics.formatSastYmd();
          const [ty, tm] = today.split('-');
          const lastDay = new Date(Number(y), Number(m), 0).getDate();
          const lte = y === ty && m === tm ? today : `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
          return { gte: `${y}-${m}-01`, lte, label: `${y}年${Number(m)}月` };
        })()
      : SellerAnalytics.getCurrentMonthRange();

    const cacheKey = `month:${range.gte}:${range.lte}`;
    if (!force && state.rankCache[cacheKey]) {
      const report = state.rankCache[cacheKey];
      main.innerHTML = buildMonthRankHtml(report, monthInput);
      bindMonthRankEvents(report, monthInput);
      return;
    }

    main.innerHTML = progressPanel('正在拉取各卖家本月销售数据…');

    try {
      const report = await SellerAnalytics.fetchRankingForRange({
        ...range,
        onProgress: (p) => {
          const el = document.getElementById('rankProgressText');
          if (el) el.textContent = p.detail || '处理中…';
        },
      });
      state.rankCache[cacheKey] = report;
      main.innerHTML = buildMonthRankHtml(report, monthInput);
      bindMonthRankEvents(report, monthInput);
    } catch (err) {
      errorPanel(err.message);
    }
  }

  function buildMonthRankHtml(report, monthInput) {
    const top = report.ranked[0];
    return `
      <form class="filter-bar" id="monthFilterForm" style="margin-bottom:0;border-radius:var(--radius) var(--radius) 0 0;border:1px solid var(--border);border-bottom:none;background:var(--surface);">
        <label style="font-size:0.85rem;font-weight:600;">统计月份 (SAST)</label>
        <input name="month" type="month" value="${monthInput || `${report.gte.slice(0, 7)}`}" />
        <button type="submit" class="btn btn-primary btn-sm">查询</button>
        <button type="button" class="btn btn-ghost btn-sm" id="refreshMonthBtn">重新拉取</button>
      </form>
      ${renderRankSummary(report)}
      ${top && !top.error ? `<div class="highlight-banner">🏆 本月销冠：<strong>${top.displayName || top.name}</strong> · GMV ${fmtMoney(top.agg.gmv)} · 占比 ${pctShare(top.agg.gmv, report.totalGmv)}</div>` : ''}
      ${renderRankTable(report.ranked, report.totalGmv)}
      <p class="hint" style="padding:0 4px;">GMV = 售价 × 数量；已排除取消/退款状态订单。时区：南非标准时间 (SAST)。</p>`;
  }

  function bindMonthRankEvents(report, monthInput) {
    document.getElementById('monthFilterForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      state.filters.rankMonth = Object.fromEntries(fd.entries());
      loadRankMonth(true);
    });
    document.getElementById('refreshMonthBtn')?.addEventListener('click', () => loadRankMonth(true));
  }

  async function loadRankYesterday(force) {
    if (needSellers()) return;
    const range = SellerAnalytics.getYesterdayRange();
    const cacheKey = `yesterday:${range.gte}`;

    if (!force && state.rankCache[cacheKey]) {
      const report = state.rankCache[cacheKey];
      main.innerHTML = buildYesterdayRankHtml(report);
      bindYesterdayRankEvents(report);
      return;
    }

    main.innerHTML = progressPanel(`正在拉取昨日 (${range.label}) 各卖家销售数据…`);

    try {
      const report = await SellerAnalytics.fetchRankingForRange({
        ...range,
        onProgress: (p) => {
          const el = document.getElementById('rankProgressText');
          if (el) el.textContent = p.detail || '处理中…';
        },
      });
      state.rankCache[cacheKey] = report;
      main.innerHTML = buildYesterdayRankHtml(report);
      bindYesterdayRankEvents(report);
    } catch (err) {
      errorPanel(err.message);
    }
  }

  function buildYesterdayRankHtml(report) {
    const top = report.ranked[0];
    const filterId = state.expandedSeller;
    return `
      <div class="filter-bar" style="margin-bottom:16px;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface);">
        <span style="font-size:0.9rem;font-weight:600;">统计日期：${report.label}（SAST 昨日）</span>
        <button type="button" class="btn btn-ghost btn-sm" id="refreshYesterdayBtn">重新拉取</button>
        ${filterId ? '<button type="button" class="btn btn-ghost btn-sm" id="clearSellerFilter">显示全部明细</button>' : ''}
      </div>
      ${renderRankSummary(report)}
      ${top && !top.error ? `<div class="highlight-banner">🥇 昨日销冠：<strong>${top.displayName || top.name}</strong> · GMV ${fmtMoney(top.agg.gmv)} · ${report.totalOrders} 单</div>` : ''}
      ${renderRankTable(report.ranked, report.totalGmv, { clickable: true })}
      <p class="hint" style="padding:0 4px 12px;">点击排名行可筛选该卖家的订单明细</p>
      ${renderSalesDetailTable(report.allItems, { filterSellerId: filterId })}`;
  }

  function bindYesterdayRankEvents(report) {
    document.getElementById('refreshYesterdayBtn')?.addEventListener('click', () => loadRankYesterday(true));
    document.getElementById('clearSellerFilter')?.addEventListener('click', () => {
      state.expandedSeller = null;
      main.innerHTML = buildYesterdayRankHtml(report);
      bindYesterdayRankEvents(report);
    });
    main.querySelectorAll('.rank-row-clickable').forEach((row) => {
      row.addEventListener('click', () => {
        state.expandedSeller = row.dataset.sellerId;
        main.innerHTML = buildYesterdayRankHtml(report);
        bindYesterdayRankEvents(report);
        toast(`已筛选卖家 ${row.dataset.sellerId} 的订单`);
      });
    });
  }

  async function loadOverview() {
    if (needKey()) return;
    loading(`正在汇总 ${activeSellerLabel()} 数据...`);

    try {
      const results = await Promise.allSettled([
        TakealotAPI.getSeller('warehouses'),
        TakealotAPI.getBalances(),
        TakealotAPI.listOffers({ limit: 100, include_count: true }),
        TakealotAPI.listSales({ limit: 20 }),
      ]);
      const labels = ['卖家资料', '账户余额', '报价', '销售订单'];
      const failed = results
        .map((result, index) => result.status === 'rejected' ? labels[index] : null)
        .filter(Boolean);
      if (failed.length === results.length) {
        throw new Error('店铺接口全部请求失败，请检查 API Key 与网络诊断');
      }
      const valueOr = (index, fallback) =>
        results[index].status === 'fulfilled' ? results[index].value : fallback;
      const seller = valueOr(0, { data: {} });
      const balances = valueOr(1, { data: { balances: {} } });
      const offers = valueOr(2, { data: { items: [], count: 0 } });
      const sales = valueOr(3, { data: { items: [] } });

      const b = balances.data.balances || {};
      const offerItems = offers.data.items || [];
      const buyable = offerItems.filter((o) => o.status === 'buyable').length;
      const salesItems = sales.data.items || [];

      main.innerHTML = `
        ${failed.length ? `<div class="api-warning"><strong>部分数据暂不可用</strong><span>${failed.join('、')}接口请求失败，其他数据仍正常显示。</span></div>` : ''}
        <div class="stats-grid">
          <div class="stat-card accent">
            <div class="label">可提现余额</div>
            <div class="value">${fmtMoney(b.available)}</div>
            <div class="sub">当前余额 ${fmtMoney(b.current)}</div>
          </div>
          <div class="stat-card">
            <div class="label">报价总数</div>
            <div class="value">${offers.data.count ?? offerItems.length}</div>
            <div class="sub">可购买 ${buyable} 个</div>
          </div>
          <div class="stat-card">
            <div class="label">卖家名称</div>
            <div class="value" style="font-size:1.1rem">${seller.data.display_name || '—'}</div>
            <div class="sub">ID ${seller.data.seller_id || '—'}</div>
          </div>
          <div class="stat-card">
            <div class="label">最近销售</div>
            <div class="value">${salesItems.length}</div>
            <div class="sub">本页拉取条数</div>
          </div>
        </div>
        ${tablePanel(
          '最近销售订单',
          ['订单 ID', 'SKU', '状态', '售价', '数量', '下单时间'],
          salesItems.slice(0, 8).map((s) => [
            `<span class="mono">${s.order_id}</span>`,
            s.sku || '—',
            statusBadge(s.sale_status),
            fmtMoney(s.selling_price),
            s.quantity ?? '—',
            fmtDate(s.order_date),
          ]),
          ''
        )}
        ${tablePanel(
          '报价快照（前 8 条）',
          ['Offer ID', 'SKU', '标题', '售价', '状态', '库存'],
          offerItems.slice(0, 8).map((o) => [
            `<span class="mono">${o.offer_id}</span>`,
            o.sku || '—',
            (o.title || '—').slice(0, 40),
            fmtMoney(o.selling_price),
            statusBadge(o.status),
            o.seller_warehouse_stock?.[0]?.quantity_available ?? '—',
          ]),
          ''
        )}`;
    } catch (err) {
      errorPanel(err.message);
    }
  }

  async function loadOffers(pageToken) {
    if (needKey()) return;
    const f = state.filters.offers || {};
    loading(`加载 ${activeSellerLabel()} 商品报价...`);

    try {
      const query = { limit: f.limit || 50, include_count: true };
      if (f.status) query.status = f.status;
      if (f.sku) query.sku = f.sku;
      if (pageToken) query.continuation_token = pageToken;

      const { data } = await TakealotAPI.listOffers(query);
      const items = data.items || [];

      const tok = getTokenStore('offers');
      if (pageToken) tok.stack.push(pageToken);
      else tok.stack = [];
      tok.next = data.continuation_token;

      main.innerHTML = `
        <div class="panel">
          <div class="panel-head"><h2>商品报价列表</h2></div>
          <form class="filter-bar" id="filterForm">
            <select name="status">
              <option value="">全部状态</option>
              <option value="buyable" ${f.status === 'buyable' ? 'selected' : ''}>可购买</option>
              <option value="not_buyable" ${f.status === 'not_buyable' ? 'selected' : ''}>不可购买</option>
              <option value="disabled_by_seller" ${f.status === 'disabled_by_seller' ? 'selected' : ''}>卖家停用</option>
            </select>
            <input name="sku" placeholder="按 SKU 搜索" value="${f.sku || ''}" />
            <input name="limit" type="number" placeholder="每页数量" value="${f.limit || 50}" min="1" max="1000" />
            <button type="submit" class="btn btn-primary btn-sm">查询</button>
          </form>
          <div class="panel-body">
            ${tablePanel(
              '',
              ['Offer ID', 'SKU', '商品标题', '售价', 'RRP', '状态', '备货天数'],
              items.map((o) => [
                `<span class="mono">${o.offer_id}</span>`,
                o.sku || '—',
                (o.title || '—').slice(0, 50),
                fmtMoney(o.selling_price),
                fmtMoney(o.rrp),
                statusBadge(o.status),
                o.minimum_leadtime_days ?? '—',
              ]),
              pagerHtml('offers', data.continuation_token, data.count, items.length)
            ).replace('<div class="panel-head"><h2></h2></div>', '')}
          </div>
        </div>`;

      bindFilter('offers', '#filterForm');
      bindPager('offers', () => loadOffers(getTokenStore('offers').next), () => {
        const t = getTokenStore('offers');
        t.stack.pop();
        loadOffers(t.stack[t.stack.length - 1]);
      });
    } catch (err) {
      errorPanel(err.message);
    }
  }

  async function loadSales(pageToken) {
    if (needKey()) return;
    const f = state.filters.sales || {};
    loading(`加载 ${activeSellerLabel()} 销售订单...`);

    try {
      const query = { limit: f.limit || 30 };
      if (f.order_date__gte) query.order_date__gte = f.order_date__gte;
      if (f.order_date__lte) query.order_date__lte = f.order_date__lte;
      if (pageToken) query.continuation_token = pageToken;

      const { data } = await TakealotAPI.listSales(query);
      const items = data.items || [];

      const tok = getTokenStore('sales');
      if (pageToken) tok.stack.push(pageToken);
      else tok.stack = [];
      tok.next = data.continuation_token;

      main.innerHTML = `
        <div class="panel">
          <div class="panel-head"><h2>销售订单</h2></div>
          <form class="filter-bar" id="filterForm">
            <input name="order_date__gte" type="date" value="${f.order_date__gte || ''}" />
            <input name="order_date__lte" type="date" value="${f.order_date__lte || ''}" />
            <input name="limit" type="number" placeholder="每页" value="${f.limit || 30}" />
            <button type="submit" class="btn btn-primary btn-sm">查询</button>
          </form>
          <div class="panel-body">
            ${tablePanel(
              '',
              ['订单 ID', '条目 ID', 'SKU', '状态', '售价', '费用', '区域', '下单时间'],
              items.map((s) => [
                `<span class="mono">${s.order_id}</span>`,
                `<span class="mono">${s.order_item_id}</span>`,
                s.sku || '—',
                statusBadge(s.sale_status),
                fmtMoney(s.selling_price),
                fmtMoney(s.total_fees),
                s.sales_region || '—',
                fmtDate(s.order_date),
              ]),
              pagerHtml('sales', data.continuation_token, data.count, items.length)
            ).replace('<div class="panel-head"><h2></h2></div>', '')}
          </div>
        </div>`;

      bindFilter('sales', '#filterForm');
      bindPager('sales', () => loadSales(getTokenStore('sales').next), () => {
        const t = getTokenStore('sales');
        t.stack.pop();
        loadSales(t.stack[t.stack.length - 1]);
      });
    } catch (err) {
      errorPanel(err.message);
    }
  }

  async function loadTransactions(pageToken) {
    if (needKey()) return;
    loading(`加载 ${activeSellerLabel()} 交易流水...`);

    try {
      const query = { limit: 30 };
      if (pageToken) query.continuation_token = pageToken;

      const { data } = await TakealotAPI.listTransactions(query);
      const items = data.items || [];

      const tok = getTokenStore('transactions');
      if (pageToken) tok.stack.push(pageToken);
      else tok.stack = [];
      tok.next = data.continuation_token;

      main.innerHTML = tablePanel(
        '交易流水',
        ['交易 ID', '类型', '金额(含税)', '创建时间'],
        items.map((t) => [
          `<span class="mono">${t.transaction_id}</span>`,
          `<span class="mono">${(t.transaction_type || '').replace(/-/g, ' ')}</span>`,
          fmtMoney(t.amount_incl_vat),
          fmtDate(t.created_at),
        ]),
        pagerHtml('transactions', data.continuation_token, data.count, items.length)
      );

      bindPager('transactions', () => loadTransactions(getTokenStore('transactions').next), () => {
        const t = getTokenStore('transactions');
        t.stack.pop();
        loadTransactions(t.stack[t.stack.length - 1]);
      });
    } catch (err) {
      errorPanel(err.message);
    }
  }

  async function loadShipments(pageToken) {
    if (needKey()) return;
    loading(`加载 ${activeSellerLabel()} 发货单...`);

    try {
      const query = { limit: 30 };
      if (pageToken) query.continuation_token = pageToken;

      const { data } = await TakealotAPI.listShipments(query);
      const items = data.items || [];

      const tok = getTokenStore('shipments');
      if (pageToken) tok.stack.push(pageToken);
      else tok.stack = [];
      tok.next = data.continuation_token;

      main.innerHTML = tablePanel(
        '发货 / 采购单（只读）',
        ['发货 ID', '参考号', '类型', '目的区域', '已发货', '截止日期', 'PO 号'],
        items.map((s) => [
          `<span class="mono">${s.shipment_id}</span>`,
          (s.reference || '—').slice(0, 28),
          s.shipment_type || '—',
          s.destination_region || '—',
          s.shipped ? '<span class="badge badge-success">是</span>' : '<span class="badge badge-warning">否</span>',
          s.due_date || '—',
          s.purchase_order_number ?? '—',
        ]),
        pagerHtml('shipments', data.continuation_token, data.count, items.length)
      );

      bindPager('shipments', () => loadShipments(getTokenStore('shipments').next), () => {
        const t = getTokenStore('shipments');
        t.stack.pop();
        loadShipments(t.stack[t.stack.length - 1]);
      });
    } catch (err) {
      errorPanel(err.message);
    }
  }

  async function loadReturns(pageToken) {
    if (needKey()) return;
    loading(`加载 ${activeSellerLabel()} 退货记录...`);

    try {
      const query = { limit: 25 };
      if (pageToken) query.continuation_token = pageToken;

      const { data } = await TakealotAPI.listReturns(query);
      const items = data.items || [];

      const tok = getTokenStore('returns');
      if (pageToken) tok.stack.push(pageToken);
      else tok.stack = [];
      tok.next = data.continuation_token;

      main.innerHTML = tablePanel(
        '退货记录',
        ['退货 ID', '订单 ID', 'SKU', '数量', '原因', '区域', '退货日期'],
        items.map((r) => [
          `<span class="mono">${r.seller_return_id}</span>`,
          `<span class="mono">${r.order_id}</span>`,
          r.sku || '—',
          r.quantity ?? '—',
          (r.return_reason || '—').replace(/_/g, ' '),
          r.return_region || '—',
          r.return_date || '—',
        ]),
        pagerHtml('returns', data.continuation_token, data.count, items.length)
      );

      bindPager('returns', () => loadReturns(getTokenStore('returns').next), () => {
        const t = getTokenStore('returns');
        t.stack.pop();
        loadReturns(t.stack[t.stack.length - 1]);
      });
    } catch (err) {
      errorPanel(err.message);
    }
  }

  async function loadSeller() {
    if (needKey()) return;
    loading(`加载 ${activeSellerLabel()} 卖家信息...`);

    try {
      const { data } = await TakealotAPI.getSeller('warehouses,vacations,leadtime_details,countries');
      const wh = (data.warehouses || [])
        .map((w) => `<tr><td>${w.name}</td><td>${w.city}</td><td>${w.region}</td><td>${w.postal_code}</td></tr>`)
        .join('');

      main.innerHTML = `
        <div class="stats-grid">
          <div class="stat-card accent">
            <div class="label">展示名称</div>
            <div class="value" style="font-size:1.2rem">${data.display_name || '—'}</div>
          </div>
          <div class="stat-card">
            <div class="label">卖家 ID</div>
            <div class="value">${data.seller_id || '—'}</div>
          </div>
          <div class="stat-card">
            <div class="label">休假状态</div>
            <div class="value" style="font-size:1.1rem">${data.on_vacation ? '休假中' : '正常营业'}</div>
          </div>
          <div class="stat-card">
            <div class="label">VAT 注册</div>
            <div class="value" style="font-size:1.1rem">${data.is_vat_registered ? '已注册' : '未注册'}</div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>账户详情</h2></div>
          <div class="detail-grid">
            <div class="detail-item"><div class="k">法定名称</div><div class="v">${data.legal_name || '—'}</div></div>
            <div class="detail-item"><div class="k">UUID</div><div class="v">${data.uuid || '—'}</div></div>
            <div class="detail-item"><div class="k">注册完成</div><div class="v">${data.registration_complete ? '是' : '否'}</div></div>
            <div class="detail-item"><div class="k">结算启用</div><div class="v">${data.disbursement_enabled ? '是' : '否'}</div></div>
            <div class="detail-item"><div class="k">入驻日期</div><div class="v">${data.date_added || '—'}</div></div>
            <div class="detail-item"><div class="k">国家</div><div class="v">${(data.countries || []).join(', ') || '—'}</div></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>仓库列表</h2></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>名称</th><th>城市</th><th>区域</th><th>邮编</th></tr></thead>
              <tbody>${wh || '<tr><td colspan="4"><div class="empty-state">无仓库数据</div></td></tr>'}</tbody>
            </table>
          </div>
        </div>`;
    } catch (err) {
      errorPanel(err.message);
    }
  }

  async function loadErpSettings() {
    main.innerHTML = '<div class="empty-state">加载…</div>';
    let sess = window.__ERP_SESSION__ || {};
    try {
      sess = (await TakealotAPI.refreshErpSession().catch(() => sess)) || sess;
      window.__ERP_SESSION__ = sess;
      updateSellerSwitcher();
    } catch (err) {
      errorPanel(err.message);
      return;
    }

    const canManage = !!sess.canManage;

    main.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>网络与连接</h2></div>
        <div class="settings-form" style="max-width:none;">
          <p class="hint">
            店铺 API Key 与陪跑分配请在 ERP 页面顶部操作（「配置店铺」「分配陪跑」）。<br />
            ${sess.viewAll ? '当前为<strong>主管视图</strong>，可查看全部陪跑店铺。' : sess.coachGroup ? `当前身份：<strong>${sess.coachGroup}</strong>，仅可见分配给您的店铺。` : ''}
          </p>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <button type="button" class="btn btn-primary" id="diagBtn">网络自检</button>
            ${canManage ? '<button type="button" class="btn btn-ghost" id="bootstrapBtn">浏览器验证</button>' : ''}
          </div>
          <div id="diagResult" class="hint" style="margin-top:16px;display:none;"></div>
        </div>
      </div>`;
  }

  function loadSettings() {
    if (TakealotAPI.isErpMode && TakealotAPI.isErpMode()) {
      loadErpSettings();
      return;
    }
    const sellers = TakealotAPI.getSellers();
    const sellerRows = sellers.length
      ? sellers
          .map(
            (s, i) => `
        <tr data-id="${s.id}">
          <td><input type="text" class="seller-name-input" value="${s.name || ''}" placeholder="备注名" /></td>
          <td><span class="mono">${s.sellerId || '—'}</span></td>
          <td><input type="password" class="seller-key-input" value="${s.apiKey || ''}" placeholder="API Key" /></td>
          <td>
            <label class="toggle-label">
              <input type="checkbox" class="seller-enabled" ${s.enabled !== false ? 'checked' : ''} />
              启用
            </label>
          </td>
          <td>
            <button type="button" class="btn btn-ghost btn-sm seller-test-btn">测试</button>
            <button type="button" class="btn btn-ghost btn-sm seller-del-btn">删除</button>
          </td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="5"><div class="empty-state">暂无纳管卖家，请在下方添加</div></td></tr>';

    main.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>纳管卖家（多 API Key）</h2></div>
        <div class="settings-form" style="max-width:none;">
          <p class="hint">
            在此添加所有需要监控的卖家 API Key，用于<strong>月销售排名</strong>和<strong>昨日销售详情</strong>汇总。<br />
            密钥仅保存在本机浏览器，不会上传第三方。
          </p>
          <div class="table-wrap seller-mgmt-table">
            <table class="data-table">
              <thead><tr><th>备注名</th><th>卖家 ID</th><th>API Key</th><th>状态</th><th>操作</th></tr></thead>
              <tbody id="sellerTableBody">${sellerRows}</tbody>
            </table>
          </div>
          <div class="add-seller-row">
            <input type="text" id="newSellerName" placeholder="备注名，如：店铺A" />
            <input type="password" id="newSellerKey" placeholder="粘贴 API Key" />
            <button type="button" class="btn btn-primary btn-sm" id="addSellerBtn">添加卖家</button>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;">
            <button type="button" class="btn btn-primary" id="saveSellersBtn">保存全部卖家</button>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>网络与连接</h2></div>
        <div class="settings-form">
          <p class="hint">
            v1.0.2+ 请求经本机 Chrome/Edge 转发。若浏览器能打开
            <a href="https://marketplace-api.takealot.com/v1/status" target="_blank">/status</a>
            但应用报错，请运行网络自检或浏览器验证。
          </p>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <button type="button" class="btn" id="diagBtn">网络自检</button>
            <button type="button" class="btn" id="bootstrapBtn">浏览器验证</button>
          </div>
          <div id="diagResult" class="hint" style="margin-top:16px;display:none;"></div>
        </div>
      </div>`;

    function collectSellersFromTable() {
      const rows = main.querySelectorAll('#sellerTableBody tr[data-id]');
      const list = [];
      rows.forEach((row) => {
        const id = row.dataset.id;
        const orig = sellers.find((s) => s.id === id) || { id };
        list.push({
          id: orig.id || id,
          name: row.querySelector('.seller-name-input')?.value.trim() || '卖家',
          apiKey: row.querySelector('.seller-key-input')?.value.trim() || '',
          sellerId: orig.sellerId,
          displayName: orig.displayName,
          enabled: row.querySelector('.seller-enabled')?.checked !== false,
        });
      });
      return list;
    }

    $('#addSellerBtn').addEventListener('click', () => {
      const name = $('#newSellerName').value.trim();
      const apiKey = $('#newSellerKey').value.trim();
      if (!apiKey) {
        toast('请填写 API Key', true);
        return;
      }
      const list = collectSellersFromTable();
      list.push({ id: `seller-${Date.now()}`, name: name || `卖家${list.length + 1}`, apiKey, enabled: true });
      TakealotAPI.saveSellers(list);
      $('#newSellerName').value = '';
      $('#newSellerKey').value = '';
      toast('已添加，正在刷新…');
      updateSellerSwitcher();
      loadSettings();
    });

    $('#saveSellersBtn').addEventListener('click', async () => {
      const list = collectSellersFromTable().filter((s) => s.apiKey);
      if (!list.length) {
        toast('请至少保留一个有效 API Key', true);
        return;
      }
      TakealotAPI.saveSellers(list);
      state.rankCache = {};
      toast('已保存，正在验证连接…');
      let ok = 0;
      for (const s of list.filter((x) => x.enabled !== false)) {
        try {
          const { data } = await TakealotAPI.getSeller(null, s.apiKey);
          s.sellerId = data.seller_id;
          s.displayName = data.display_name;
          ok += 1;
        } catch {
          /* keep */
        }
      }
      TakealotAPI.saveSellers(list);
      state.rankCache = {};
      updateSellerSwitcher();
      loadSettings();
      checkApiStatus();
      toast(`保存成功，${ok}/${list.length} 个卖家连接正常`);
    });

    main.querySelectorAll('.seller-del-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        const id = row.dataset.id;
        const list = collectSellersFromTable().filter((s) => s.id !== id);
        TakealotAPI.saveSellers(list);
        state.rankCache = {};
        updateSellerSwitcher();
        loadSettings();
        toast('已删除');
      });
    });

    main.querySelectorAll('.seller-test-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const row = e.target.closest('tr');
        const key = row.querySelector('.seller-key-input')?.value.trim();
        if (!key) {
          toast('请先填写 API Key', true);
          return;
        }
        btn.disabled = true;
        try {
          const { data } = await TakealotAPI.getSeller(null, key);
          toast(`连接成功：${data.display_name || data.seller_id}`);
        } catch (err) {
          toast(err.message, true);
        } finally {
          btn.disabled = false;
        }
      });
    });

    $('#diagBtn').addEventListener('click', async () => {
      const box = $('#diagResult');
      box.style.display = 'block';
      box.textContent = '正在检测 Chrome / curl / Node 三条通道…';
      $('#diagBtn').disabled = true;
      try {
        const diag = await TakealotAPI.runNetworkDiag();
        const lines = [
          `版本: ${diag.version}`,
          `本机浏览器: ${diag.browserInstalled ? '已安装' : '未找到 Chrome/Edge'}`,
          `Chrome 通道: ${diag.channels.chrome.ok ? '✓' : '✗'} ${diag.channels.chrome.message}`,
          `curl 通道: ${diag.channels.curl.ok ? '✓' : '✗'} ${diag.channels.curl.message}`,
          `Node 通道: ${diag.channels.node.ok ? '✓' : '✗'} ${diag.channels.node.message}`,
          `建议: ${diag.recommendation}`,
        ];
        box.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
      } catch (err) {
        box.textContent = '自检失败: ' + err.message;
      } finally {
        $('#diagBtn').disabled = false;
      }
    });

    $('#bootstrapBtn').addEventListener('click', async () => {
      const box = $('#diagResult');
      box.style.display = 'block';
      box.textContent = '正在弹出 Chrome 窗口，请在窗口中等待出现 {"status":"ok"}…';
      $('#bootstrapBtn').disabled = true;
      try {
        const result = await TakealotAPI.runBrowserBootstrap();
        box.innerHTML = `<div>${result.ok ? '✓' : '✗'} ${result.message}</div>`;
        if (result.ok) {
          toast('浏览器验证成功，请再次点击「保存并检测连接」');
          checkApiStatus();
        }
      } catch (err) {
        box.textContent = '验证失败: ' + err.message;
      } finally {
        $('#bootstrapBtn').disabled = false;
      }
    });
  }

  function bindFilter(view, sel) {
    const form = main.querySelector(sel);
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      state.filters[view] = Object.fromEntries(fd.entries());
      VIEWS[view].loader();
    });
  }

  function bindPager(view, onNext, onPrev) {
    main.querySelector('[data-page="next"]')?.addEventListener('click', onNext);
    main.querySelector('[data-page="prev"]')?.addEventListener('click', onPrev);
  }

  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.nav-item').forEach((n) => {
      n.classList.toggle('active', n.dataset.view === view);
    });
    pageTitle.textContent = VIEWS[view].title;
    updateSellerSwitcher();
    VIEWS[view].loader();
  }

  sellerSwitcher.addEventListener('change', () => {
    TakealotAPI.setActiveSellerId(sellerSwitcher.value);
    const label = sellerSwitcher.selectedOptions[0]?.text || '卖家';
    if (SELLER_SCOPED_VIEWS.has(state.view)) {
      VIEWS[state.view].loader();
    }
    toast(`已切换：${label}`);
  });

  $('#sideNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (btn?.dataset.view) switchView(btn.dataset.view);
  });

  $('#refreshBtn').addEventListener('click', () => {
    VIEWS[state.view].loader();
    toast('已刷新');
  });

  $('#syncBtn').addEventListener('click', async () => {
    if (state.view === 'settings') {
      toast('请在设置页保存 API Key');
      return;
    }
    $('#syncBtn').disabled = true;
    try {
      await VIEWS[state.view].loader();
      toast('同步完成');
    } catch (err) {
      toast(err.message, true);
    } finally {
      $('#syncBtn').disabled = false;
    }
  });

  if (TakealotAPI.isErpMode && TakealotAPI.isErpMode()) {
    const settingsNav = document.querySelector('.nav-item[data-view="settings"]');
    if (settingsNav) settingsNav.textContent = '网络诊断';

    main.addEventListener('click', async (e) => {
      if (e.target.closest('#diagBtn')) {
        const el = $('#diagResult');
        if (!el) return;
        el.style.display = 'block';
        el.textContent = '检测中…';
        try {
          const d = await TakealotAPI.runNetworkDiag();
          el.innerHTML = `<pre>${JSON.stringify(d, null, 2)}</pre>`;
        } catch (err) {
          el.textContent = err.message;
        }
        return;
      }

      if (e.target.closest('#bootstrapBtn')) {
        try {
          const r = await TakealotAPI.runBrowserBootstrap();
          toast(r.message || '已启动浏览器验证');
        } catch (err) {
          toast(err.message, true);
        }
      }
    });

    window.addEventListener('message', (e) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      if (e.data?.type === 'erp-auth') onErpAuth(e.data.token, e.data.session);
    });
    try {
      window.parent?.postMessage({ type: 'erp-monitor-ready' }, window.location.origin);
    } catch { /* parent may be unavailable in standalone mode */ }
    waitForErpAuth();
  } else {
    checkApiStatus();
    updateSellerSwitcher();
    const startView = TakealotAPI.isErpMode?.() ? 'overview' : (TakealotAPI.getEnabledSellers().length ? 'overview' : 'settings');
    switchView(startView);
  }
})();
