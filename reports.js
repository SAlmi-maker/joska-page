// ============================================================
// RENVA - Reports Module
// Depends on: supabase.js, i18n.js, auth.js
// External:   Chart.js 4, SheetJS (xlsx)
// ============================================================

const RENVA_REPORTS = (() => {

  // ── State ─────────────────────────────────────────────────
  let allInvoices       = [];
  let barChart          = null;
  let doughnutChart     = null;
  let selectedYear      = new Date().getFullYear();
  let companySettings   = {};

  const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

  // ── Init ─────────────────────────────────────────────────
  async function init(user) {
    if (!user) return;
    await loadCompanySettings(user.uid);
    renderUserInfo(user);
    populateYearSelector();
    initSidebar();
    initAnimations();
    subscribeToInvoices(user.uid);

    document.getElementById('exportXlsxBtn')?.addEventListener('click', exportXlsx);
    document.getElementById('yearSelect')?.addEventListener('change', e => {
      selectedYear = parseInt(e.target.value);
      renderAll();
    });

    document.addEventListener('RENVA:langChanged', () => {
      setBrandSubtitle(companySettings.company_name || '');
      renderAll();
    });
  }

  // ── Company Settings ──────────────────────────────────────
  async function loadCompanySettings(uid) {
    try {
      const { data, error } = await supabase.from('companies')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        companySettings = data;
        RENVA_I18N.setCurrency(companySettings.currency || 'MAD');
        if (companySettings.company_name) {
          setBrandSubtitle(companySettings.company_name);
        }
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  }

  // ── User Info ─────────────────────────────────────────────
  function setBrandSubtitle(name) {
    document.querySelectorAll('.company-name').forEach(el => {
      el.textContent = name || RENVA_I18N.t('brand.subtitle');
    });
  }

  function renderUserInfo(user) {
    const name = companySettings?.company_name || '';
    const initials = name ? name.slice(0, 2).toUpperCase() : 'RV';
    document.querySelectorAll('.user-email').forEach(el => el.textContent = user.email);
    document.querySelectorAll('.user-avatar-text').forEach(el => el.textContent = initials);
    setBrandSubtitle(name);
  }

  // ── Year Selector ─────────────────────────────────────────
  function populateYearSelector() {
    const sel  = document.getElementById('yearSelect');
    if (!sel) return;
    const now  = new Date().getFullYear();
    sel.innerHTML = '';
    for (let y = now; y >= now - 4; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === selectedYear) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  async function subscribeToInvoices(uid) {
    setLoading(true);

    try {
      const { data, error } = await supabase.from('invoices')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (error) throw error;
      allInvoices = (data || []).map(d => ({ id: d.id, ...d }));
      renderAll();
      setLoading(false);
    } catch (err) {
      console.error('Reports load error:', err);
      setLoading(false);
    }
  }

  // ── Render All ────────────────────────────────────────────
  function renderAll() {
    const yearInvoices = allInvoices.filter(inv => {
      const d = getDate(inv);
      return d && d.getFullYear() === selectedYear;
    });

    updateYearLabels();
    renderSummaryStats(allInvoices);
    renderBarChart(yearInvoices);
    renderDoughnutChart(allInvoices);
    renderMonthlyTable(yearInvoices);
  }

  // ── Summary Stats ─────────────────────────────────────────
  function renderSummaryStats(invoices) {
    const now       = new Date();
    const todayStr  = now.toISOString().split('T')[0];
    const thisMonth = now.getMonth();
    const thisYear  = now.getFullYear();
    const currency  = RENVA_I18N.t('common.currency');

    const paid = invoices.filter(inv => inv.status === 'paid');
    const toNum = inv => parseFloat(inv.total || inv.amount || 0);

    const todayRev = paid
      .filter(inv => (inv.paid_at || inv.created_at || '').startsWith(todayStr))
      .reduce((s, inv) => s + toNum(inv), 0);

    const monthRev = paid
      .filter(inv => { const d = getDate(inv); return d && d.getMonth() === thisMonth && d.getFullYear() === thisYear; })
      .reduce((s, inv) => s + toNum(inv), 0);

    const yearRev = paid
      .filter(inv => { const d = getDate(inv); return d && d.getFullYear() === thisYear; })
      .reduce((s, inv) => s + toNum(inv), 0);

    setText('rValToday',    formatCurrency(todayRev, currency));
    setText('rValMonth',    formatCurrency(monthRev, currency));
    setText('rValYear',     formatCurrency(yearRev, currency));
    setText('rValInvoices', invoices.length);

    // Animate stat cards
    document.querySelectorAll('.stat-card').forEach(card => {
      card.classList.add('visible');
    });
  }

  // ── Monthly Bar Chart ─────────────────────────────────────
  function renderBarChart(invoices) {
    const canvas = document.getElementById('revenueBarChart');
    if (!canvas) return;

    const months   = getMonthLabels();
    const currency = RENVA_I18N.t('common.currency');

    // Build monthly revenue array (paid only)
    const data = Array(12).fill(0);
    invoices.forEach(inv => {
      if (inv.status !== 'paid') return;
      const d = getDate(inv);
      if (d) data[d.getMonth()] += parseFloat(inv.total || inv.amount || 0);
    });

    const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    const textColor = isDark ? '#475569' : '#94a3b8';

    if (barChart) barChart.destroy();

    barChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [{
          label: RENVA_I18N.t('dash.revenueMonth'),
          data,
          backgroundColor: data.map((_, i) =>
            i === new Date().getMonth() && selectedYear === new Date().getFullYear()
              ? 'rgba(37,99,235,0.9)'
              : 'rgba(37,99,235,0.45)'
          ),
          borderColor: 'rgba(37,99,235,1)',
          borderWidth: 0,
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ' ' + formatCurrency(ctx.raw, currency)
            },
            backgroundColor: isDark ? '#1a2235' : '#fff',
            titleColor: isDark ? '#f1f5f9' : '#0f172a',
            bodyColor: isDark ? '#94a3b8' : '#475569',
            borderColor: isDark ? '#1f2e47' : '#e2e8f0',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { size: 11, family: 'Inter' } },
            border: { display: false }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { size: 11, family: 'Inter' },
              callback: val => formatCurrencyShort(val, currency)
            },
            border: { display: false }
          }
        }
      }
    });
  }

  // ── Status Doughnut Chart ─────────────────────────────────
  function renderDoughnutChart(invoices) {
    const canvas = document.getElementById('statusDoughnutChart');
    if (!canvas) return;

    const counts = { paid: 0, pending: 0, overdue: 0, draft: 0 };
    invoices.forEach(inv => {
      const s = inv.status || 'draft';
      if (counts[s] !== undefined) counts[s]++;
    });

    const total  = invoices.length;
    const labels = [
      RENVA_I18N.t('dash.paid'),
      RENVA_I18N.t('dash.pending'),
      RENVA_I18N.t('dash.overdue'),
      RENVA_I18N.t('dash.draft'),
    ];
    const data   = [counts.paid, counts.pending, counts.overdue, counts.draft];
    const colors = ['#10b981', '#f59e0b', '#ef4444', '#6b7280'];

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    if (doughnutChart) doughnutChart.destroy();

    // Remove existing center overlay
    const existing = canvas.parentElement.querySelector('.doughnut-center');
    if (existing) existing.remove();

    doughnutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors.map(c => c + (isDark ? 'cc' : 'dd')),
          borderColor: isDark ? '#111827' : '#ffffff',
          borderWidth: 3,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: isDark ? '#94a3b8' : '#475569',
              font: { size: 11, family: 'Inter' },
              padding: 14,
              usePointStyle: true,
              pointStyleWidth: 8,
            }
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.raw} (${total ? Math.round(ctx.raw / total * 100) : 0}%)`
            },
            backgroundColor: isDark ? '#1a2235' : '#fff',
            titleColor: isDark ? '#f1f5f9' : '#0f172a',
            bodyColor: isDark ? '#94a3b8' : '#475569',
            borderColor: isDark ? '#1f2e47' : '#e2e8f0',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
          }
        }
      }
    });

    // Center label
    const center = document.createElement('div');
    center.className = 'doughnut-center';
    center.innerHTML = `
      <div class="doughnut-center-value">${total}</div>
      <div class="doughnut-center-label">${RENVA_I18N.t('dash.totalInvoices')}</div>
    `;
    canvas.parentElement.style.position = 'relative';
    canvas.parentElement.appendChild(center);
  }

  // ── Monthly Breakdown Table ───────────────────────────────
  function renderMonthlyTable(invoices) {
    const tbody    = document.getElementById('monthlyTableBody');
    if (!tbody) return;

    const months   = getMonthLabels();
    const currency = RENVA_I18N.t('common.currency');
    const now      = new Date();
    const isCurrentYear = selectedYear === now.getFullYear();

    // Build per-month stats
    const monthData = Array.from({ length: 12 }, () => ({
      total: 0, invoices: 0, paid: 0, pending: 0
    }));

    invoices.forEach(inv => {
      const d = getDate(inv);
      if (!d) return;
      const m = d.getMonth();
      monthData[m].invoices++;
      const amt = parseFloat(inv.total || inv.amount || 0);
      if (inv.status === 'paid')    { monthData[m].paid++;    monthData[m].total += amt; }
      if (inv.status === 'pending') { monthData[m].pending++; }
    });

    const maxRevenue = Math.max(...monthData.map(m => m.total), 1);

    tbody.innerHTML = '';

    months.forEach((month, i) => {
      const row  = monthData[i];
      const pct  = maxRevenue > 0 ? (row.total / maxRevenue * 100) : 0;
      const isCurrent = isCurrentYear && i === now.getMonth();

      const tr = document.createElement('tr');
      if (isCurrent) tr.classList.add('current-month');
      tr.style.animationDelay = `${i * 30}ms`;
      tr.classList.add('fade-in-row');

      tr.innerHTML = `
        <td class="month-name">
          <span class="month-badge">
            ${month}
            ${isCurrent ? `<span class="current-tag">${RENVA_I18N.t('dash.invoicesThisMonth')}</span>` : ''}
          </span>
        </td>
        <td class="num">${row.invoices || '—'}</td>
        <td class="num">${row.paid || '—'}</td>
        <td class="num">${row.pending || '—'}</td>
        <td class="revenue">${row.total > 0 ? formatCurrency(row.total, currency) : '—'}</td>
        <td class="revenue-bar-cell">
          <div class="revenue-bar-wrap">
            <div class="revenue-bar-bg">
              <div class="revenue-bar-fill" style="width:${pct.toFixed(1)}%"></div>
            </div>
            <span class="revenue-bar-pct">${pct > 0 ? pct.toFixed(0) + '%' : '—'}</span>
          </div>
        </td>`;

      tbody.appendChild(tr);
    });
  }

  // ── XLSX Export ───────────────────────────────────────────
  function exportXlsx() {
    if (!window.XLSX) {
      showToast('error', 'SheetJS not loaded. Please refresh the page.');
      return;
    }

    const xl = companySettings.excel_lang || RENVA_I18N.getLang();
    const currency = RENVA_I18N.t('common.currency');
    const months   = getMonthLabels(xl);

    const yearInvoices = allInvoices.filter(inv => {
      const d = getDate(inv);
      return d && d.getFullYear() === selectedYear;
    });

    // Sheet 1 — Monthly Summary
    const monthData = Array.from({ length: 12 }, () => ({
      total: 0, invoices: 0, paid: 0, pending: 0, overdue: 0
    }));
    yearInvoices.forEach(inv => {
      const d = getDate(inv);
      if (!d) return;
      const m = d.getMonth();
      monthData[m].invoices++;
      const amt = parseFloat(inv.total || inv.amount || 0);
      if (inv.status === 'paid')    { monthData[m].paid++;    monthData[m].total += amt; }
      if (inv.status === 'pending')   monthData[m].pending++;
      if (inv.status === 'overdue')   monthData[m].overdue++;
    });

    const summaryRows = [
      [RENVA_I18N.tLang('reports.month', xl), RENVA_I18N.tLang('dash.totalInvoices', xl), RENVA_I18N.tLang('dash.paid', xl), RENVA_I18N.tLang('dash.pending', xl), RENVA_I18N.tLang('dash.overdue', xl), `${RENVA_I18N.tLang('reports.revenue', xl)} (${currency})`],
      ...months.map((m, i) => [
        m,
        monthData[i].invoices,
        monthData[i].paid,
        monthData[i].pending,
        monthData[i].overdue,
        monthData[i].total.toFixed(2)
      ])
    ];

    // Sheet 2 — Raw Invoices
    const invoiceRows = [
      [RENVA_I18N.tLang('reports.invoiceNumber', xl), RENVA_I18N.tLang('inv.col.client', xl), RENVA_I18N.tLang('reports.date', xl), RENVA_I18N.tLang('inv.col.status', xl), `${RENVA_I18N.tLang('pdf.amount', xl)} (${currency})`],
      ...yearInvoices.map(inv => {
        const d = getDate(inv);
        return [
          inv.invoice_number || inv.id.slice(-6).toUpperCase(),
          inv.client_name || '—',
          d ? d.toLocaleDateString() : '—',
          inv.status || 'draft',
          parseFloat(inv.total || inv.amount || 0).toFixed(2)
        ];
      })
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), `Summary ${selectedYear}`);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invoiceRows), `Invoices ${selectedYear}`);

    const companyName = (companySettings.company_name || 'RENVA').replace(/[<>:"/\\|?*]/g, '');
    XLSX.writeFile(wb, `${companyName}_Report_${selectedYear}.xlsx`);
    showToast('success', `Report exported for ${selectedYear}`);
  }

  // ── Theme Toggle ─────────────────────────────────────────
  // ── Sidebar ───────────────────────────────────────────────
  function initSidebar() {
    const hamburger = document.getElementById('hamburger');
    const sidebar   = document.getElementById('sidebar');
    const overlay   = document.getElementById('sidebarOverlay');
    hamburger?.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay?.classList.toggle('show');
    });
    overlay?.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }

  // ── Animations ────────────────────────────────────────────
  function initAnimations() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.stat-card, .glass-card').forEach(el => observer.observe(el));
  }

  // ── Helpers ───────────────────────────────────────────────
  function getDate(inv) {
    if (inv.start_date)        return new Date(inv.start_date);
    if (inv.created_at)        return new Date(inv.created_at);
    return null;
  }

  function getMonthLabels(lang) {
    const l = lang || RENVA_I18N.getLang();
    if (l === 'fr') return MONTHS_FR;
    if (l === 'ar') return MONTHS_AR;
    return MONTHS_EN;
  }

  function formatCurrency(amount, currency) {
    if (isNaN(amount)) amount = 0;
    const lang = RENVA_I18N.getLang();
    const num = new Intl.NumberFormat(lang, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
    return (lang === 'ar' ? '\u200E' : '') + num + ' ' + currency;
  }

  function formatCurrencyShort(val, currency) {
    const lrm = RENVA_I18N.getLang() === 'ar' ? '\u200E' : '';
    if (val >= 1000000) return lrm + (val / 1000000).toFixed(1) + 'M ' + currency;
    if (val >= 1000)    return lrm + (val / 1000).toFixed(0) + 'K ' + currency;
    return lrm + val + ' ' + currency;
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function updateYearLabels() {
    document.querySelectorAll('#selectedYearLabel, #selectedYearLabelTable')
      .forEach(el => el.textContent = selectedYear);
  }

  function setLoading(state) {
    document.querySelectorAll('.stat-card').forEach(c => c.classList.toggle('skeleton', state));
  }

  function showToast(type, message) {
    const toast = document.getElementById('reportsToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className   = `toast toast-${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  return { init };
})();


// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  RENVA_I18N.init();
  RENVA_AUTH.init();

  document.addEventListener('RENVA:authReady', ({ detail }) => {
    if (detail.user) RENVA_REPORTS.init(detail.user);
  });
});
