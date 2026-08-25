/** 卖家销售聚合与南非时间（SAST）日期工具 */
const SellerAnalytics = {
  SAST_TZ: 'Africa/Johannesburg',

  formatSastYmd(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.SAST_TZ }).format(date);
  },

  /** 当前月在 SAST 下的起止日期（月初至今天） */
  getCurrentMonthRange() {
    const today = this.formatSastYmd();
    const [y, m] = today.split('-');
    return {
      gte: `${y}-${m}-01`,
      lte: today,
      label: `${y}年${Number(m)}月（截至 ${today}）`,
      year: y,
      month: m,
    };
  },

  /** 昨天在 SAST 下的日期 */
  getYesterdayRange() {
    const today = this.formatSastYmd();
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    const yest = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    return { gte: yest, lte: yest, label: yest };
  },

  isCancelledStatus(status) {
    if (!status) return false;
    const s = String(status).toLowerCase();
    return s.includes('cancel') || s.includes('returned') || s.includes('refund');
  },

  lineRevenue(sale) {
    const price = Number(sale.selling_price) || 0;
    const qty = Number(sale.quantity) || 1;
    return price * qty;
  },

  lineFees(sale) {
    return Number(sale.total_fees) || 0;
  },

  aggregateSales(items) {
    const valid = items.filter((s) => !this.isCancelledStatus(s.sale_status));
    const orderIds = new Set(valid.map((s) => s.order_id));
    let gmv = 0;
    let fees = 0;
    let units = 0;

    valid.forEach((s) => {
      gmv += this.lineRevenue(s);
      fees += this.lineFees(s);
      units += Number(s.quantity) || 0;
    });

    return {
      items: valid,
      orderCount: orderIds.size,
      lineCount: valid.length,
      units,
      gmv,
      fees,
      net: gmv - fees,
      avgOrderValue: orderIds.size ? gmv / orderIds.size : 0,
    };
  },

  rankMedal(rank) {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return rank;
  },

  async loadSellerProfile(seller) {
    try {
      const { data } = await TakealotAPI.getSeller(null, seller);
      return {
        ...seller,
        sellerId: data.seller_id,
        displayName: data.display_name || seller.name,
        slug: data.slug,
      };
    } catch (err) {
      return {
        ...seller,
        sellerId: seller.sellerId || '—',
        displayName: seller.name,
        error: err.message,
      };
    }
  },

  async fetchRankingForRange({ gte, lte, label, onProgress }) {
    const sellers = TakealotAPI.getEnabledSellers();
    if (!sellers.length) {
      throw new Error(
        TakealotAPI.isErpMode()
          ? '暂无可监控店铺，请联系管理员配置 API Key'
          : '请先在系统设置中添加至少一个卖家 API Key'
      );
    }

    const results = [];
    let done = 0;

    for (const seller of sellers) {
      onProgress?.({
        phase: 'seller',
        current: seller.name,
        done,
        total: sellers.length,
        detail: `正在拉取 ${seller.name} 的销售数据…`,
      });

      const profile = await this.loadSellerProfile(seller);

      let items = [];
      try {
        items = await TakealotAPI.fetchAllSales(seller, {
          gte,
          lte,
          onProgress: (p) => {
            onProgress?.({
              phase: 'fetch',
              current: seller.name,
              done,
              total: sellers.length,
              loaded: p.loaded,
              count: p.count,
              detail: `${seller.name}：已拉取 ${p.loaded} 条${p.count != null ? ` / 约 ${p.count} 条` : ''}`,
            });
          },
        });
      } catch (err) {
        results.push({
          ...profile,
          error: err.message,
          agg: this.aggregateSales([]),
        });
        done += 1;
        continue;
      }

      const agg = this.aggregateSales(items);
      results.push({ ...profile, agg, rawItems: items });
      done += 1;
    }

    const ranked = results
      .map((r) => ({ ...r, gmv: r.agg?.gmv || 0 }))
      .sort((a, b) => b.gmv - a.gmv)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const totalGmv = ranked.reduce((s, r) => s + (r.agg?.gmv || 0), 0);
    const totalOrders = ranked.reduce((s, r) => s + (r.agg?.orderCount || 0), 0);
    const totalUnits = ranked.reduce((s, r) => s + (r.agg?.units || 0), 0);
    const allItems = ranked.flatMap((r) =>
      (r.rawItems || []).map((item) => ({
        ...item,
        _sellerName: r.displayName || r.name,
        _sellerId: r.sellerId,
      }))
    );

    allItems.sort((a, b) => new Date(b.order_date) - new Date(a.order_date));

    return {
      label,
      gte,
      lte,
      ranked,
      totalGmv,
      totalOrders,
      totalUnits,
      allItems,
      sellerCount: sellers.length,
    };
  },
};

window.SellerAnalytics = SellerAnalytics;
