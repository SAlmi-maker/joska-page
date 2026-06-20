// ============================================================
// RENVA — Invoices Module
// Handles: create/edit/delete invoices,
//           live totals, filtering, search, InvoicePro export.
// ============================================================

const RENVA_INVOICES = (() => {

  // ── State ─────────────────────────────────────────────────
  let currentUser    = null;
  let companySettings = {};
  let pdfTemplate    = 'classic';
  let allInvoices    = [];
  let filteredInvoices = [];
  let activeStatus   = 'all';
  let searchQuery    = '';
  let editingId      = null;
  let deleteTargetId = null;
  let invoiceColorMode = 'bw';
  let invoiceColor     = '#2563EB';
  let invoiceLanguage  = '';
  let pendingViewId    = null;

  // ── Helpers ────────────────────────────────────────────────
  function lockScroll() { const y=window.scrollY; document.body.dataset.sy=y; document.documentElement.style.overflow='hidden'; document.body.style.position='fixed'; document.body.style.top=`-${y}px`; document.body.style.left='0'; document.body.style.right='0'; }
  function unlockScroll() { const y=parseInt(document.body.dataset.sy||'0'); document.documentElement.style.overflow=''; document.body.style.position=''; document.body.style.top=''; document.body.style.left=''; document.body.style.right=''; window.scrollTo(0,y); delete document.body.dataset.sy; }

  // ── Init ─────────────────────────────────────────────────
  async function init(user) {
    if (!user) return;
    currentUser = user;

    try {
      const { data: csData, error: csError } = await supabase.from('companies')
        .select('*')
        .eq('user_id', user.uid)
        .maybeSingle();
      if (!csError && csData) {
        companySettings = csData;
        pdfTemplate = 'classic';
        invoiceColorMode = csData.invoice_color_mode || 'bw';
        invoiceColor     = csData.invoice_color || '#2563EB';
        invoiceLanguage  = csData.invoice_language || '';
        RENVA_I18N.setCurrency(csData.currency || 'MAD');
      }
    } catch (e) { /* non-critical */ }

    renderUserInfo(user);
    subscribeToInvoices(user.uid);
    wireUI();
    initSidebar();
    setTodayAsDefault();
    populateExportModal();

    const params = new URLSearchParams(window.location.search);
    const viewId = params.get('view');
    if (viewId) pendingViewId = viewId;

    if (params.get('clientName')) {
      openNewWithClient(params.get('clientName'), params.get('cin'), params.get('phone'));
    }
  }

  // ── User info in sidebar ──────────────────────────────────
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

  async function subscribeToInvoices(uid) {
    showLoading(true);

    try {
      const { data, error } = await supabase.from('invoices')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (error) throw error;
      allInvoices = (data || []).map(d => ({ id: d.id, ...d }));
      applyFilters();
      showLoading(false);

      const badge = document.getElementById('navInvoiceCount');
      if (badge) badge.textContent = allInvoices.length;

      if (pendingViewId) {
        openPreview(pendingViewId);
        pendingViewId = null;
      }
    } catch (err) {
      console.error('Invoice load error:', err);
      showLoading(false);
      showToast('error', RENVA_I18N.t('settings.error'));
    }
  }

  // ── Filter & search ───────────────────────────────────────
  function applyFilters() {
    let list = allInvoices;

    if (activeStatus !== 'all') {
      list = list.filter(inv => inv.status === activeStatus);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(inv =>
        (inv.client_name   || '').toLowerCase().includes(q) ||
        (inv.cin           || '').toLowerCase().includes(q) ||
        (inv.vehicle_brand || '').toLowerCase().includes(q) ||
        (inv.vehicle_model || '').toLowerCase().includes(q) ||
        (inv.plate         || '').toLowerCase().includes(q) ||
        (inv.invoice_number || '').toLowerCase().includes(q)
      );
    }

    filteredInvoices = list;
    renderTable(filteredInvoices);

    const badge = document.getElementById('invCountBadge');
    if (badge) badge.textContent = filteredInvoices.length;
  }

  // ── Render table ──────────────────────────────────────────
  function renderTable(invoices) {
    const tbody = document.getElementById('invTableBody');
    const empty = document.getElementById('invEmpty');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!invoices.length) {
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';

    const currency = RENVA_I18N.t('common.currency');
    const lang     = RENVA_I18N.getLang();

    invoices.forEach((inv, i) => {
      const tr = document.createElement('tr');
      tr.style.animationDelay = `${i * 40}ms`;
      tr.classList.add('fade-in-row');

      const date = toDate(inv.created_at);
      const dateStr = date ? date.toLocaleDateString(lang) : '—';

      const startStr = inv.start_date || '—';
      const endStr   = inv.end_date   || '—';
      const period   = (inv.start_date && inv.end_date)
        ? `${formatShortDate(inv.start_date, lang)} → ${formatShortDate(inv.end_date, lang)}`
        : '—';

      const total    = parseFloat(inv.total || 0);
      const status   = inv.status || 'draft';
      const statusLabel = RENVA_I18N.t(`dash.${status}`);

      const num = inv.invoice_number || inv.id.slice(-6).toUpperCase();
      const vehicle = [inv.vehicle_brand, inv.vehicle_model].filter(Boolean).join(' ') || '—';

      tr.innerHTML = `
        <td><span class="invoice-num">#${escHtml(num)}</span></td>
        <td>
          <div style="font-weight:600;font-size:0.875rem;">${escHtml(inv.client_name || '—')}</div>
          <div style="font-size:0.75rem;color:var(--text-tertiary);">${escHtml(inv.cin || '')}</div>
        </td>
        <td>
          <div style="font-size:0.875rem;">${escHtml(vehicle)}</div>
          <div style="font-size:0.75rem;color:var(--text-tertiary);">${escHtml(inv.plate || '')}</div>
        </td>
        <td style="font-size:0.82rem;color:var(--text-secondary);">${period}</td>
        <td><span class="amount">${formatCurrency(total, currency)}</span></td>
        <td><span class="badge badge-${status}">${statusLabel}</span></td>
        <td>
          <div class="row-actions">
            <button class="inv-action-btn" title="Edit" onclick="RENVA_INVOICES.openEdit('${inv.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="inv-action-btn" title="Download PDF" onclick="RENVA_INVOICES.exportSingle('${inv.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="inv-action-btn danger" title="Delete" onclick="RENVA_INVOICES.openDelete('${inv.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
        </td>`;

      tbody.appendChild(tr);
    });
  }

  // ── Wire all UI events ────────────────────────────────────
  function wireUI() {
    document.getElementById('btnNewInvoice')?.addEventListener('click', openNew);
    document.getElementById('modalClose')?.addEventListener('click',  closeModal);
    document.getElementById('modalCancel')?.addEventListener('click', closeModal);
    document.getElementById('invoiceModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('invoiceModal')) closeModal();
    });
    document.getElementById('modalSave')?.addEventListener('click', () => saveInvoice(false));
    document.getElementById('modalSaveDraft')?.addEventListener('click', () => saveInvoice(true));
    document.getElementById('modalPDF')?.addEventListener('click', () => saveAndExport());
    document.getElementById('previewCloseBtn')?.addEventListener('click', closeModal);
    document.getElementById('deleteModalClose')?.addEventListener('click', closeDeleteModal);
    document.getElementById('deleteCancelBtn')?.addEventListener('click', closeDeleteModal);
    document.getElementById('deleteConfirmBtn')?.addEventListener('click', confirmDelete);
    document.getElementById('deleteModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('deleteModal')) closeDeleteModal();
    });
    document.getElementById('btnExportAll')?.addEventListener('click', exportFiltered);
    document.getElementById('exportModalClose')?.addEventListener('click', closeExportModal);
    document.getElementById('exportCancelBtn')?.addEventListener('click', closeExportModal);
    document.getElementById('exportConfirmBtn')?.addEventListener('click', doExportPDF);
    document.getElementById('exportModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('exportModal')) closeExportModal();
    });
    document.getElementById('invSearch')?.addEventListener('input', e => {
      searchQuery = e.target.value;
      applyFilters();
    });
    document.querySelectorAll('.inv-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.inv-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeStatus = btn.dataset.status;
        applyFilters();
      });
    });
    const priceFields = ['inv_dailyPrice','inv_startDate','inv_endDate','inv_insurance','inv_fuel','inv_extraDriver','inv_other'];
    priceFields.forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => { recalculate(); renderHTMLPreview(); });
      document.getElementById(id)?.addEventListener('change', () => { recalculate(); renderHTMLPreview(); });
    });
    const previewFields = ['inv_clientName','inv_cin','inv_phone','inv_vehicleBrand','inv_vehicleModel','inv_plate','inv_startDate','inv_endDate','inv_dailyPrice','inv_insurance','inv_fuel','inv_extraDriver','inv_other','inv_notes'];
    previewFields.forEach(id => {
      document.getElementById(id)?.addEventListener('input', renderHTMLPreview);
      document.getElementById(id)?.addEventListener('change', renderHTMLPreview);
    });
    document.getElementById('inv_plate')?.addEventListener('input', e => {
      const pos = e.target.selectionStart;
      e.target.value = e.target.value.toUpperCase();
      e.target.setSelectionRange(pos, pos);
    });
    document.getElementById('inv_status')?.addEventListener('change', renderHTMLPreview);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (document.getElementById('exportModal')?.classList.contains('open')) closeExportModal();
        if (document.getElementById('invoiceModal')?.classList.contains('open')) closeModal();
        if (document.getElementById('deleteModal')?.classList.contains('open')) closeDeleteModal();
      }
    });
  }

  // ── Default dates ─────────────────────────────────────────
  function setTodayAsDefault() {
    const today = new Date().toISOString().split('T')[0];
    const startEl = document.getElementById('inv_startDate');
    const endEl   = document.getElementById('inv_endDate');
    if (startEl && !startEl.value) startEl.value = today;
    if (endEl   && !endEl.value)   endEl.value   = today;
  }

  // ── Modal open/close ──────────────────────────────────────
  function openNew() {
    editingId = null;
    resetForm();
    setTodayAsDefault();
    recalculate();
    document.getElementById('modalTitle').setAttribute('data-i18n', 'inv.newInvoice');
    document.getElementById('modalTitle').textContent = RENVA_I18N.t('inv.newInvoice');
    document.getElementById('invoiceModal').classList.add('open');
    lockScroll();
    document.getElementById('invPreviewWrap')?.classList.add('open');
    setTimeout(() => { document.getElementById('inv_clientName')?.focus(); renderHTMLPreview(); }, 100);
  }

  function openNewWithClient(clientName, cin, phone) {
    editingId = null;
    resetForm();
    setTodayAsDefault();
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    set('inv_clientName', clientName);
    set('inv_cin', cin);
    set('inv_phone', phone);
    recalculate();
    document.getElementById('modalTitle').setAttribute('data-i18n', 'inv.newInvoice');
    document.getElementById('modalTitle').textContent = RENVA_I18N.t('inv.newInvoice');
    document.getElementById('invoiceModal').classList.add('open');
    lockScroll();
    document.getElementById('invPreviewWrap')?.classList.add('open');
    setTimeout(() => { document.getElementById('inv_clientName')?.focus(); renderHTMLPreview(); }, 100);
  }

  function openEdit(id) {
    const inv = allInvoices.find(i => i.id === id);
    if (!inv) return;
    editingId = id;
    populateForm(inv);
    recalculate();
    document.getElementById('modalTitle').textContent = `${RENVA_I18N.t('common.edit')} #${inv.invoice_number || id.slice(-6).toUpperCase()}`;
    document.getElementById('invoiceModal').classList.add('open');
    lockScroll();
    document.getElementById('invPreviewWrap')?.classList.add('open');
    setTimeout(() => renderHTMLPreview(), 100);
  }

  function openPreview(id) {
    const inv = allInvoices.find(i => i.id === id);
    if (!inv) return;
    populatePreview(inv);
    const backdrop = document.getElementById('invoiceModal');
    if (backdrop) {
      backdrop.classList.add('open');
      backdrop.classList.add('preview-only');
      const panel = backdrop.querySelector('.modal-panel');
      if (panel) panel.style.display = 'none';
    }
    document.getElementById('invPreviewWrap')?.classList.add('open');
    lockScroll();
  }

  function closeModal() {
    document.getElementById('invoiceModal').classList.remove('open');
    document.getElementById('invoiceModal').classList.remove('preview-only');
    const modalPanel = document.querySelector('#invoiceModal .modal-panel');
    if (modalPanel) modalPanel.style.display = '';
    document.getElementById('invPreviewWrap')?.classList.remove('open');
    unlockScroll();
    editingId = null;
  }

  // ── Delete modal ──────────────────────────────────────────
  function openDelete(id) {
    deleteTargetId = id;
    document.getElementById('deleteModal').classList.add('open');
    lockScroll();
  }

  function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('open');
    unlockScroll();
    deleteTargetId = null;
  }

  async function confirmDelete() {
    if (!deleteTargetId || !currentUser) return;
    const btn = document.getElementById('deleteConfirmBtn');
    btn.disabled = true;
    try {
      const { error } = await supabase.from('invoices').delete().eq('id', deleteTargetId);
      if (error) throw error;
      showToast('success', RENVA_I18N.t('inv.deleted'));
      closeDeleteModal();
    } catch (e) {
      console.error(e);
      showToast('error', RENVA_I18N.t('settings.error'));
    } finally {
      btn.disabled = false;
    }
  }

  // ── Form helpers ──────────────────────────────────────────
  function resetForm() {
    document.getElementById('invoiceForm').reset();
    document.getElementById('inv_id').value = '';
    document.getElementById('inv_status').value = 'draft';
    ['inv_insurance','inv_fuel','inv_extraDriver','inv_other'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '0';
    });
  }

  function populateForm(inv) {
    resetForm();
    const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined && val !== null) el.value = val; };
    set('inv_id',           inv.id);
    set('inv_clientName',   inv.client_name);
    set('inv_cin',          inv.cin);
    set('inv_phone',        inv.phone);
    set('inv_vehicleBrand', inv.vehicle_brand);
    set('inv_vehicleModel', inv.vehicle_model);
    set('inv_plate',        inv.plate);
    set('inv_startDate',    inv.start_date);
    set('inv_endDate',      inv.end_date);
    set('inv_dailyPrice',   inv.daily_price);
    set('inv_insurance',    inv.insurance   || 0);
    set('inv_fuel',         inv.fuel        || 0);
    set('inv_extraDriver',  inv.extra_driver || 0);
    set('inv_other',        inv.other       || 0);
    set('inv_status',       inv.status);
    set('inv_notes',        inv.notes);
  }

  function readForm() {
    const g = id => document.getElementById(id)?.value ?? '';
    const n = id => parseFloat(document.getElementById(id)?.value || 0) || 0;
    return {
      client_name:   g('inv_clientName').trim(),
      cin:           g('inv_cin').trim(),
      phone:         g('inv_phone').trim(),
      vehicle_brand: g('inv_vehicleBrand').trim(),
      vehicle_model: g('inv_vehicleModel').trim(),
      plate:         g('inv_plate').trim().toUpperCase(),
      start_date:    g('inv_startDate'),
      end_date:      g('inv_endDate'),
      daily_price:   n('inv_dailyPrice'),
      insurance:     n('inv_insurance'),
      fuel:          n('inv_fuel'),
      extra_driver:  n('inv_extraDriver'),
      other:         n('inv_other'),
      status:        g('inv_status') || 'draft',
      notes:         g('inv_notes').trim(),
    };
  }

  function validateForm(data) {
    const required = { client_name: 'clientName', cin: 'cin', vehicle_brand: 'vehicleBrand', vehicle_model: 'vehicleModel', plate: 'plate', start_date: 'startDate', end_date: 'endDate' };
    for (const [key, fieldId] of Object.entries(required)) {
      if (!data[key]) {
        const labelMap = {
          clientName:   'inv.field.clientName',
          cin:          'inv.field.cin',
          vehicleBrand: 'inv.field.vehicleBrand',
          vehicleModel: 'inv.field.vehicleModel',
          plate:        'inv.field.plate',
          startDate:    'inv.field.startDate',
          endDate:      'inv.field.endDate',
        };
        showToast('error', `${RENVA_I18N.t(labelMap[fieldId] || fieldId)} ${RENVA_I18N.t('inv.isRequired')}`);
        document.getElementById(`inv_${fieldId}`)?.focus();
        return false;
      }
    }
    if (data.daily_price <= 0) {
      showToast('error', RENVA_I18N.t('inv.dailyPriceRequired'));
      document.getElementById('inv_dailyPrice')?.focus();
      return false;
    }
    if (data.start_date > data.end_date) {
      showToast('error', RENVA_I18N.t('inv.dateRangeError'));
      return false;
    }
    return true;
  }

  // ── Live totals recalculation ─────────────────────────────
  function recalculate() {
    const startDate  = document.getElementById('inv_startDate')?.value;
    const endDate    = document.getElementById('inv_endDate')?.value;
    const dailyPrice = parseFloat(document.getElementById('inv_dailyPrice')?.value || 0) || 0;
    const insurance  = parseFloat(document.getElementById('inv_insurance')?.value  || 0) || 0;
    const fuel       = parseFloat(document.getElementById('inv_fuel')?.value       || 0) || 0;
    const extraDriver= parseFloat(document.getElementById('inv_extraDriver')?.value|| 0) || 0;
    const other      = parseFloat(document.getElementById('inv_other')?.value      || 0) || 0;

    const days = calcDays(startDate, endDate);
    const rental = days * dailyPrice;
    const total  = rental + insurance + fuel + extraDriver + other;

    const currency = RENVA_I18N.t('common.currency');
    const daysEl   = document.getElementById('invDaysText');
    const rentalEl = document.getElementById('calcRental');
    const totalEl  = document.getElementById('invTotalDisplay');
    const daysWrap = document.getElementById('invDaysDisplay');

    if (daysEl) {
      if (days >= 0 && startDate && endDate) {
        daysEl.textContent = `${days} ${RENVA_I18N.t('inv.days')}`;
        if (daysWrap) daysWrap.style.display = 'flex';
      } else {
        if (daysWrap) daysWrap.style.display = 'none';
      }
    }
    if (rentalEl) rentalEl.textContent = formatCurrency(rental, currency);
    if (totalEl)  totalEl.textContent  = formatCurrency(total, currency);
  }

  function calcDays(start, end) {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    const diff = Math.round((e - s) / (1000 * 60 * 60 * 24));
    return diff < 0 ? 0 : diff + 1;
  }

  // ── Export modal helpers ──────────────────────────────────
  const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

  function getMonthLabels() {
    const l = RENVA_I18N.getLang();
    if (l === 'fr') return MONTHS_FR;
    if (l === 'ar') return MONTHS_AR;
    return MONTHS_EN;
  }

  function populateExportModal() {
    const yearSel = document.getElementById('exportYear');
    if (yearSel) {
      const cur = new Date().getFullYear();
      yearSel.innerHTML = '';
      for (let y = cur; y >= cur - 5; y--) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === cur) opt.selected = true;
        yearSel.appendChild(opt);
      }
    }
    const grid = document.getElementById('exportMonthGrid');
    if (!grid) return;
    const months = getMonthLabels();
    const curMonth = new Date().getMonth();
    grid.innerHTML = '';
    months.forEach((name, i) => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:0.82rem;cursor:pointer;padding:4px 6px;border-radius:6px;border:1px solid var(--border-color);transition:all .15s;';
      label.innerHTML = `<input type="checkbox" value="${i+1}" ${i === curMonth ? 'checked' : ''} style="accent-color:var(--primary);"> ${name}`;
      grid.appendChild(label);
    });
  }

  // ── Save invoice ──────────────────────────────────────────
  async function saveInvoice(forceDraft = false) {
    const data = readForm();
    if (forceDraft) data.status = 'draft';
    if (!validateForm(data)) return;

    const saveBtn  = document.getElementById('modalSave');
    const draftBtn = document.getElementById('modalSaveDraft');
    setLoading(saveBtn,  true);
    setLoading(draftBtn, true);

    try {
      const days   = calcDays(data.start_date, data.end_date);
      const rental = days * data.daily_price;
      const total  = rental + data.insurance + data.fuel + data.extra_driver + data.other;
      const now    = new Date().toISOString();

      const payload = {
        ...data,
        days,
        total,
        updated_at: now,
      };

      if (editingId) {
        const { error } = await supabase.from('invoices').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        payload.user_id = currentUser.uid;
        payload.invoice_number = await generateInvoiceNumber();
        payload.created_at = now;
        const { error } = await supabase.from('invoices').insert(payload);
        if (error) throw error;
      }

      showToast('success', RENVA_I18N.t('settings.saved'));
      closeModal();
    } catch (err) {
      console.error(err);
      showToast('error', RENVA_I18N.t('settings.error'));
    } finally {
      setLoading(saveBtn,  false);
      setLoading(draftBtn, false);
    }
  }

  async function saveAndExport() {
    const data = readForm();
    if (!validateForm(data)) return;

    const days   = calcDays(data.start_date, data.end_date);
    const rental = days * data.daily_price;
    const total  = rental + data.insurance + data.fuel + data.extra_driver + data.other;

    const invNumber = editingId
      ? (allInvoices.find(i => i.id === editingId)?.invoice_number || editingId.slice(-6).toUpperCase())
      : `INV-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${String(allInvoices.length+1).padStart(4,'0')}`;
    const tempInv = { id: editingId || 'new', invoice_number: invNumber, days, total, ...data };
    printInvoice(tempInv);

    try {
      const now = new Date().toISOString();
      if (editingId) {
        const { error } = await supabase.from('invoices').update({ ...data, days, total, updated_at: now }).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('invoices').insert({ ...data, user_id: currentUser.uid, days, total, invoice_number: invNumber, created_at: now, updated_at: now });
        if (error) throw error;
      }
      showToast('success', RENVA_I18N.t('inv.pdfReady'));
    } catch (err) {
      console.error(err);
      showToast('error', RENVA_I18N.t('settings.error'));
    }
  }

  // ── Invoice number generator ──────────────────────────────
  async function generateInvoiceNumber() {
    const year  = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const count = allInvoices.length + 1;
    return `INV-${year}${month}-${String(count).padStart(4, '0')}`;
  }

  // ── Export single invoice ─────────────────────────────────
  function exportSingle(id) {
    const inv = allInvoices.find(i => i.id === id);
    if (!inv) return;
    printInvoice(inv);
  }

  // ── Export selection modal ────────────────────────────────
  function exportFiltered() {
    populateExportModal();
    const modal = document.getElementById('exportModal');
    if (modal) { modal.classList.add('open'); lockScroll(); }
  }

  function closeExportModal() {
    const modal = document.getElementById('exportModal');
    if (modal) modal.classList.remove('open');
    unlockScroll();
  }

  function doExportPDF() {
    const checked = document.querySelectorAll('#exportMonthGrid input[type="checkbox"]:checked');
    const yearEl  = document.getElementById('exportYear');
    if (!checked.length) { showToast('error', 'Select at least one month'); return; }

    const months = Array.from(checked).map(cb => parseInt(cb.value));
    const year   = parseInt(yearEl?.value || new Date().getFullYear());

    const matched = allInvoices.filter(inv => {
      let d = null;
      if (inv.start_date) {
        const parts = inv.start_date.split('-');
        if (parts.length === 3) {
          d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        } else {
          d = new Date(inv.start_date);
        }
      }
      if (!d || isNaN(d.getTime())) {
        if (inv.created_at) d = new Date(inv.created_at);
      }
      if (!d || isNaN(d.getTime())) return false;
      return months.includes(d.getMonth() + 1) && d.getFullYear() === year;
    });

    if (!matched.length) { showToast('error', 'No invoices found for the selected period'); return; }

    closeExportModal();

    // Grab the template once
    const templateEl = document.querySelector('.ip-invoice');
    if (!templateEl) { showToast('error', 'Invoice template not found'); return; }
    const templateHTML = templateEl.outerHTML;

    const lang = getPDFLang();
    const isRTL = lang === 'ar';
    const currency = RENVA_I18N.t('common.currency');
    const fmt = (n) => formatCurrency(n, currency, lang);

    // Build all invoice HTML strings upfront, then write everything at once
    const invoiceHTMLs = [];
    let written = 0;
    matched.forEach((inv, idx) => {
      try {
        const container = document.createElement('div');
        container.innerHTML = templateHTML;
        const invEl = container.firstElementChild;
        if (!invEl) return;
        // page-break is handled by the print CSS on .ip-invoice; no inline override needed
        if (isRTL) invEl.setAttribute('dir', 'rtl');

        const accentHex = invoiceColorMode === 'bw' ? '#1e293b' : (invoiceColor || '#2563EB');
        invEl.style.setProperty('--ip-primary', accentHex);

        const s = (id, val) => {
          const el = invEl.querySelector('#' + id);
          if (el) el.textContent = val ?? '';
        };

        const days = inv.days ?? calcDays(inv.start_date, inv.end_date);
        const dp = parseFloat(inv.daily_price || 0);
        const rental = days * dp;
        const total = parseFloat(inv.total || 0);

        const extras = [
          { label: tl('inv.field.insurance'), val: parseFloat(inv.insurance || 0) },
          { label: tl('inv.field.fuel'), val: parseFloat(inv.fuel || 0) },
          { label: tl('inv.field.extraDriver'), val: parseFloat(inv.extra_driver || 0) },
          { label: tl('inv.field.other'), val: parseFloat(inv.other || 0) },
        ].filter(e => e.val > 0);

        const t = tl;
        const coName = companySettings.company_name || 'RENVA';

        s('preview_companyName', coName);
        s('preview_companyAddr', companySettings.address || '');
        s('preview_companyEmail', companySettings.email || '');
        s('preview_companyPhone', companySettings.phone || '');
        s('preview_companyWebsite', companySettings.website || '');
        s('preview_title', t('pdf.invoice'));
        s('preview_invNumber', `#${inv.invoice_number || inv.id?.slice(-6) || '—'}`);
        s('preview_issueLabel', t('pdf.issue'));
        s('preview_issueDate', inv.start_date || '—');
        s('preview_dueLabel', t('pdf.due'));
        s('preview_dueDate', inv.end_date || '—');
        s('preview_billToLabel', t('pdf.billTo'));
        s('preview_clientName', inv.client_name || '—');
        s('preview_clientCIN', inv.cin ? `${t('pdf.cin')}: ${inv.cin}` : '');
        s('preview_clientPhone', inv.phone ? `${t('pdf.tel')}: ${inv.phone}` : '');
        s('preview_clientVehicle', `${inv.vehicle_brand || ''} ${inv.vehicle_model || ''}`.trim() || '');
        s('preview_clientPlate', inv.plate ? `${t('pdf.plate')}: ${inv.plate}` : '');
        s('preview_descLabel', t('pdf.description'));
        s('preview_qtyLabel', t('pdf.qty'));
        s('preview_unitLabel', t('pdf.ratePerDay'));
        s('preview_amtLabel', t('pdf.amount'));

        const tbody = invEl.querySelector('#preview_itemsBody');
        if (tbody) {
          tbody.innerHTML = '';
          const dash = '—';
          const addRow = (desc, daysVal, unit, amt) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${escHtml(desc)}</td><td>${daysVal}</td><td>${typeof unit === 'number' ? fmt(unit) : unit}</td><td>${fmt(amt)}</td>`;
            tbody.appendChild(tr);
          };
          addRow(`${t('inv.field.rentalSubtotal')} (${inv.vehicle_brand || ''} ${inv.vehicle_model || ''})`, days, dp, rental);
          extras.forEach(e => addRow(e.label, dash, dash, e.val));
        }

        s('preview_grandLabel', t('pdf.grandTotal'));
        s('preview_grandTotal', fmt(total));

        const statusLabel = invEl.querySelector('#preview_statusLabel');
        if (statusLabel) statusLabel.textContent = t('pdf.status');

        const status = inv.status || 'draft';
        const badge = invEl.querySelector('#preview_status');
        if (badge) {
          badge.textContent = t('dash.' + status);
          badge.className = 'ip-status-badge ip-status-' + status;
        }

        const notesWrap = invEl.querySelector('#preview_notesWrap');
        if (notesWrap) {
          if (inv.notes) {
            s('preview_notesLabel', t('pdf.notes'));
            s('preview_notes', inv.notes);
            notesWrap.style.display = 'block';
          } else {
            notesWrap.style.display = 'none';
          }
        }

        const logoEl = invEl.querySelector('#preview_logo');
        if (companySettings.logo_base64 && logoEl) {
          logoEl.src = companySettings.logo_base64;
          logoEl.style.display = 'block';
        } else if (logoEl) {
          logoEl.style.display = 'none';
        }

        invoiceHTMLs.push(invEl.outerHTML);
        written++;
      } catch (err) {
        console.error('Export invoice error (idx=' + idx + '):', err);
      }
    });

    // Inject invoices into the main page and call window.print()
    // The @media print CSS in invoices.css hides all UI and shows #RENVA-print-container
    const printContainer = document.createElement('div');
    printContainer.id = 'RENVA-print-container';
    printContainer.innerHTML = invoiceHTMLs.join('\n');
    document.body.appendChild(printContainer);

    window.print();

    // Clean up after print dialog is dismissed
    const cleanup = () => { document.body.removeChild(printContainer); };
    if ('onafterprint' in window) {
      window.onafterprint = cleanup;
    } else {
      setTimeout(cleanup, 3000);
    }

    showToast('success', `Exporting ${written} invoice(s) as PDF`);
  }

  // ── Print / PDF via browser ─────────────────────────────
  function getPDFLang() {
    return invoiceLanguage || RENVA_I18N.getLang();
  }

  // Translate a key using the invoice language (falls back to website language)
  function tl(key) {
    if (invoiceLanguage && invoiceLanguage !== RENVA_I18N.getLang()) {
      return RENVA_I18N.tLang(key, invoiceLanguage);
    }
    return RENVA_I18N.t(key);
  }

  function printInvoice(inv) {
    const modal = document.getElementById('invoiceModal');
    const wasOpen = modal?.classList.contains('open');

    populatePreview(inv);

    // Ensure the preview is rendered so table columns are computed
    void document.querySelector('.ip-invoice')?.offsetHeight;

    // Close preview if it wasn't already open
    if (!wasOpen) {
      const wrap = document.getElementById('invPreviewWrap');
      if (wrap) wrap.classList.remove('open');
      if (modal) modal.classList.remove('open');
      unlockScroll();
    }

    const invoiceEl = document.querySelector('.ip-invoice');
    if (!invoiceEl) { window.print(); return; }

    const clone = invoiceEl.cloneNode(true);
    if (getPDFLang() === 'ar') clone.setAttribute('dir', 'rtl');

    // Build a standalone print document in an off-screen iframe
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none;';
    document.body.appendChild(iframe);

    const printDoc = iframe.contentWindow.document;
    printDoc.open();
    printDoc.write('<!DOCTYPE html><html><head><meta charset="utf-8">');

    // Copy all stylesheet links and inline styles
    document.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
      if (el.href) printDoc.write(`<link rel="stylesheet" href="${el.href}">`);
    });
    document.querySelectorAll('style').forEach(el => {
      printDoc.write(`<style>${el.textContent}</style>`);
    });

    printDoc.write('</head><body>');
    printDoc.write('<div id="RENVA-print-container">');
    printDoc.write(clone.outerHTML);
    printDoc.write('</div>');
    printDoc.write('</body></html>');
    printDoc.close();

    // Wait for fonts/styles to load, then print
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Cleanup after print dialog closes
      setTimeout(() => { document.body.removeChild(iframe); }, 1000);
    }, 500);
  }

  // ── Populate InvoicePro preview elements ────────────────
  function populatePreview(inv) {
    const s = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? ''; };

    const t = tl;
    const lang = getPDFLang();
    const currency = RENVA_I18N.t('common.currency');
    const fmt = (n) => formatCurrency(n, currency, lang);
    const coName = companySettings.company_name || 'RENVA';
    const coAddr = companySettings.address || '';
    const coEmail = companySettings.email || '';
    const coPhone = companySettings.phone || '';
    const days = inv.days ?? calcDays(inv.start_date, inv.end_date);
    const dp = parseFloat(inv.daily_price || 0);
    const rental = days * dp;
    const total = parseFloat(inv.total || 0);
    const status = inv.status || 'draft';

    const extras = [
      { label: t('inv.field.insurance'), val: parseFloat(inv.insurance || 0) },
      { label: t('inv.field.fuel'), val: parseFloat(inv.fuel || 0) },
      { label: t('inv.field.extraDriver'), val: parseFloat(inv.extra_driver || 0) },
      { label: t('inv.field.other'), val: parseFloat(inv.other || 0) },
    ].filter(e => e.val > 0);

    const accentHex = invoiceColorMode === 'bw' ? '#1e293b' : (invoiceColor || '#2563EB');
    const invoiceEl = document.getElementById('ip_invoicePreview');
    if (invoiceEl) {
      invoiceEl.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      invoiceEl.style.setProperty('--ip-primary', accentHex);
    }

    const logoEl = document.getElementById('preview_logo');
    if (companySettings.logo_base64 && logoEl) {
      logoEl.src = companySettings.logo_base64;
      logoEl.style.display = 'block';
    } else if (logoEl) {
      logoEl.style.display = 'none';
    }
    s('preview_companyName', coName);
    s('preview_companyAddr', coAddr);
    s('preview_companyEmail', coEmail);
    s('preview_companyPhone', coPhone);
    s('preview_companyWebsite', companySettings.website || '');
    s('preview_title', t('pdf.invoice'));
    s('preview_invNumber', `#${inv.invoice_number || inv.id?.slice(-6) || '—'}`);
    s('preview_issueLabel', t('pdf.issue'));
    s('preview_issueDate', inv.start_date || '—');
    s('preview_dueLabel', t('pdf.due'));
    s('preview_dueDate', inv.end_date || '—');
    s('preview_billToLabel', t('pdf.billTo'));
    s('preview_clientName', inv.client_name || '—');
    s('preview_clientCIN', inv.cin ? `${t('pdf.cin')}: ${inv.cin}` : '');
    s('preview_clientPhone', inv.phone ? `${t('pdf.tel')}: ${inv.phone}` : '');
    s('preview_clientVehicle', `${inv.vehicle_brand || ''} ${inv.vehicle_model || ''}`.trim() || '');
    s('preview_clientPlate', inv.plate ? `${t('pdf.plate')}: ${inv.plate}` : '');
    s('preview_descLabel', t('pdf.description'));
    s('preview_qtyLabel', t('pdf.qty'));
    s('preview_unitLabel', t('pdf.ratePerDay'));
    s('preview_amtLabel', t('pdf.amount'));

    const tbody = document.getElementById('preview_itemsBody');
    if (tbody) {
      tbody.innerHTML = '';
      const dash = '—';
      const addRow = (desc, daysVal, unit, amt) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escHtml(desc)}</td><td>${daysVal}</td><td>${typeof unit === 'number' ? fmt(unit) : unit}</td><td>${fmt(amt)}</td>`;
        tbody.appendChild(tr);
      };
      addRow(`${t('inv.field.rentalSubtotal')} (${inv.vehicle_brand || ''} ${inv.vehicle_model || ''})`, days, dp, rental);
      extras.forEach(e => addRow(e.label, dash, dash, e.val));
    }

    s('preview_grandLabel', t('pdf.grandTotal'));
    s('preview_grandTotal', fmt(total));

    const statusLabel = document.getElementById('preview_statusLabel');
    if (statusLabel) statusLabel.textContent = t('pdf.status');

    const badge = document.getElementById('preview_status');
    if (badge) {
      badge.textContent = t('dash.' + status);
      badge.className = 'ip-status-badge ip-status-' + status;
    }

    const notesWrap = document.getElementById('preview_notesWrap');
    if (inv.notes) {
      s('preview_notesLabel', t('pdf.notes'));
      s('preview_notes', inv.notes);
      notesWrap.style.display = 'block';
    } else {
      notesWrap.style.display = 'none';
    }
  }

  // ── InvoicePro-style Live Preview ────────────────────────
  function renderHTMLPreview() {
    const wrap = document.getElementById('invPreviewWrap');
    const emptyEl = document.getElementById('invPreviewEmpty');
    if (!wrap || !wrap.classList.contains('open')) return;

    const d = readForm();
    const days = calcDays(d.start_date, d.end_date);
    const dp = parseFloat(d.daily_price || 0);
    const ins = parseFloat(d.insurance || 0);
    const fuel = parseFloat(d.fuel || 0);
    const ed = parseFloat(d.extra_driver || 0);
    const oth = parseFloat(d.other || 0);
    const rental = days * dp;
    const total = rental + ins + fuel + ed + oth;
    const status = document.getElementById('inv_status')?.value || 'draft';
    const invNum = editingId
      ? (allInvoices.find(i => i.id === editingId)?.invoice_number || editingId.slice(-6).toUpperCase())
      : `INV-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${String(allInvoices.length+1).padStart(4,'0')}`;

    const hasData = d.client_name || d.vehicle_brand || d.start_date || dp > 0;
    if (emptyEl) emptyEl.classList.toggle('hidden', hasData);
    if (!hasData) return;

    const inv = { ...d, days, total, invoice_number: invNum, status };
    populatePreview(inv);
  }

  function buildPDFPageClassic(doc, inv) {
    const t = tl;
    const currency = t('common.currency');
    const W = 210, M = 18;
    let y = 0;
    const lang = getPDFLang();
    const fmt = (amt) => formatCurrency(amt, currency, lang);
    const accent = getAccentColor();

    const setAccent = () => doc.setTextColor(accent.r, accent.g, accent.b);
    const fillAccent = () => doc.setFillColor(accent.r, accent.g, accent.b);

    // ── Header: Logo left, Company left ───────────────────────
    let nameX = M;
    if (companySettings.logo_base64) {
      doc.addImage(companySettings.logo_base64, 'PNG', M, 6, 24, 24);
      nameX = M + 28;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(companySettings.company_name || 'RENVA', nameX, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    const compLines = [companySettings.address || '', companySettings.email || '', companySettings.phone || '', companySettings.website || ''].filter(Boolean);
    compLines.forEach((line, i) => {
      doc.text(line, nameX, 20 + i * 4);
    });
    y = Math.max(30, 20 + compLines.length * 4 + 4);

    // ── INVOICE title bar ─────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    setAccent();
    doc.text(t('pdf.invoice'), M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    const metaY = y - 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`#${inv.invoice_number || inv.id.slice(-6).toUpperCase()}`, W - M, metaY, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    const today = new Date();
    const issueStr = inv.start_date ? new Date(inv.start_date + 'T00:00:00').toLocaleDateString(lang) : today.toLocaleDateString(lang);
    const dueStr = inv.end_date ? new Date(inv.end_date + 'T00:00:00').toLocaleDateString(lang) : today.toLocaleDateString(lang);
    doc.text(`${t('pdf.issue')}: ${issueStr}`, W - M, metaY + 4.5, { align: 'right' });
    doc.text(`${t('pdf.due')}: ${dueStr}`, W - M, metaY + 9, { align: 'right' });

    y += 4;
    doc.setDrawColor(accent.r, accent.g, accent.b);
    doc.setLineWidth(0.6);
    doc.line(M, y, W - M, y);
    doc.setLineWidth(0.2);
    y += 10;

    // ── Customer Info (right side) ────────────────────────────
    const billToX = W / 2 + 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(t('pdf.billTo'), billToX, y);
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(inv.client_name || '—', billToX, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    if (inv.cin) { doc.text(`${t('pdf.cin')}: ${inv.cin}`, billToX, y); y += 4; }
    if (inv.phone) { doc.text(`${t('pdf.tel')}: ${inv.phone}`, billToX, y); y += 4; }
    doc.text(`${inv.vehicle_brand || ''} ${inv.vehicle_model || ''}`.trim() || '—', billToX, y); y += 4;
    if (inv.plate) { doc.text(`${t('pdf.plate')}: ${inv.plate}`, billToX, y); y += 4; }
    y += 8;

    // ── Rental info line ──────────────────────────────────────
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    const daysN = inv.days ?? calcDays(inv.start_date, inv.end_date);
    doc.text(`${t('pdf.rentalPeriod')}: ${inv.start_date || '—'} → ${inv.end_date || '—'}  |  ${daysN} ${t('inv.days')}`, M, y);
    y += 6;

    // ── Items table ───────────────────────────────────────────
    const tW = W - M * 2;
    const colW = [tW * 0.5, tW * 0.12, tW * 0.18, tW * 0.2];
    const colX = [M, M + colW[0], M + colW[0] + colW[1], M + colW[0] + colW[1] + colW[2]];

    fillAccent();
    doc.rect(M, y, tW, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    doc.text(t('pdf.description'), colX[0] + 4, y + 5.5);
    doc.text(t('pdf.qty'), colX[1] + 2, y + 5.5);
    doc.text(t('pdf.ratePerDay'), colX[2] + 2, y + 5.5);
    doc.text(t('pdf.amount'), colX[3] + 8, y + 5.5);
    y += 8;

    const dailyPrice = parseFloat(inv.daily_price || 0);
    const rental = daysN * dailyPrice;
    const extras = [
      { label: t('inv.field.insurance'), val: parseFloat(inv.insurance || 0) },
      { label: t('inv.field.fuel'), val: parseFloat(inv.fuel || 0) },
      { label: t('inv.field.extraDriver'), val: parseFloat(inv.extra_driver || 0) },
      { label: t('inv.field.other'), val: parseFloat(inv.other || 0) },
    ];
    const activeExtras = extras.filter(e => e.val > 0);

    const dash2 = '—';
    const drawRow = (desc, qty, unit, total, idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(M, y, tW, 9, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(String(desc), colX[0] + 4, y + 6.5);
      doc.text(String(qty), colX[1] + 2, y + 6.5);
      doc.text(fmt(unit), colX[2] + 2, y + 6.5);
      doc.text(fmt(total), colX[3] + 8, y + 6.5, { align: 'right' });
      doc.setDrawColor(226, 232, 240);
      doc.line(M, y + 9, W - M, y + 9);
      y += 9;
    };

    drawRow(`${t('inv.field.rentalSubtotal')} (${inv.vehicle_brand || ''} ${inv.vehicle_model || ''})`, daysN, dailyPrice, rental, 0);
    activeExtras.forEach((e, i) => {
      drawRow(e.label, dash2, e.val, e.val, i + 1);
    });

    y += 4;

    // ── Grand Total row ───────────────────────────────────────
    doc.setDrawColor(accent.r, accent.g, accent.b);
    doc.setLineWidth(0.5);
    doc.line(M, y, W - M, y);
    y += 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    setAccent();
    doc.text(t('pdf.grandTotal'), M, y + 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(fmt(parseFloat(inv.total || 0)), W - M, y + 4, { align: 'right' });
    y += 10;

    // ── Status badge ──────────────────────────────────────────
    const status = inv.status || 'draft';
    const statusColors = { paid: [16, 185, 129], pending: [245, 158, 11], overdue: [239, 68, 68], draft: [107, 114, 128] };
    const [r, g, b] = statusColors[status] || statusColors.draft;
    doc.setFillColor(r, g, b);
    doc.roundedRect(M, y, 28, 8, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    doc.text(t(`dash.${status}`).toUpperCase(), M + 14, y + 5.5, { align: 'center' });
    y += 14;

    // ── Notes ─────────────────────────────────────────────────
    if (inv.notes) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text(t('pdf.notes'), M, y);
      y += 4;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(String(inv.notes), M, y);
      y += 8;
    }

    // ── Footer ────────────────────────────────────────────────
    if (companySettings.logo_base64) {
      doc.addImage(companySettings.logo_base64, 'PNG', W - M - 28, 240 - 28, 28, 28);
    }
    doc.setDrawColor(226, 232, 240);
    doc.line(M, 255, W - M, 255);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(t('pdf.generatedBy'), W / 2, 282, { align: 'center' });
    const footerLines = [companySettings.email || '', companySettings.website || ''].filter(Boolean);
    footerLines.forEach((line, i) => doc.text(line, W / 2, 286 + i * 4, { align: 'center' }));
  }

  function buildPDFPageModern(doc, inv) {
    const t2 = tl;
    const currency = t2('common.currency');
    const W = 210, M = 18;
    let y = 0;
    const lang = getPDFLang();
    const fmt = (amt) => formatCurrency(amt, currency, lang);
    const accent = getAccentColor();

    const fillAccent = () => doc.setFillColor(accent.r, accent.g, accent.b);
    const setAccent = () => doc.setTextColor(accent.r, accent.g, accent.b);

    fillAccent();
    doc.rect(0, 0, 8, 297, 'F');

    let nameX2 = M + 4;
    if (companySettings.logo_base64) {
      doc.addImage(companySettings.logo_base64, 'PNG', M + 4, 4, 20, 20);
      nameX2 = M + 28;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42);
    doc.text(companySettings.company_name || 'RENVA', nameX2, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(t2('brand.tagline'), nameX2, 27);

    const numY = 20;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setAccent();
    doc.text(`#${inv.invoice_number || inv.id.slice(-6).toUpperCase()}`, W - M, numY, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(new Date().toLocaleDateString(lang), W - M, numY + 5, { align: 'right' });

    y = 40;
    doc.setDrawColor(226, 232, 240);
    doc.line(M + 4, y, W - M, y);
    y += 8;

    const col1 = M + 4, col2 = W / 2 + 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(t2('pdf.billTo').toUpperCase(), col1, y);
    doc.text(t2('inv.field.vehicle').toUpperCase(), col2, y);
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(inv.client_name || '—', col1, y);
    doc.text(`${inv.vehicle_brand || ''} ${inv.vehicle_model || ''}`.trim() || '—', col2, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${t2('pdf.cin')}: ${inv.cin || '—'}`, col1, y); y += 4;
    doc.text(`${t2('pdf.plate')}: ${inv.plate || '—'}`, col2, y - 4);
    if (inv.phone) { doc.text(`${t2('pdf.tel')}: ${inv.phone}`, col1, y); }
    y += 10;

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(M + 4, y, W - M * 2 - 4, 12, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`${inv.start_date || '—'}  →  ${inv.end_date || '—'}`, M + 10, y + 8);
    const daysN = inv.days ?? calcDays(inv.start_date, inv.end_date);
    doc.setFont('helvetica', 'bold');
    setAccent();
    doc.text(`${daysN} ${t2('inv.days')}`, W - M - 8, y + 8, { align: 'right' });
    y += 20;

    const tW = W - M * 2 - 4, descW = tW * 0.5, amtW = tW * 0.25;
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.rect(M + 4, y, tW, 7, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(t2('pdf.description'), M + 8, y + 4.5);
    doc.text(t2('pdf.qty'), M + descW + 4, y + 4.5);
    doc.text(t2('pdf.ratePerDay'), M + descW + amtW / 2, y + 4.5, { align: 'center' });
    doc.text(t2('pdf.amount'), W - M - 6, y + 4.5, { align: 'right' });
    y += 7;

    const dash3 = '—';
    const dp = parseFloat(inv.daily_price || 0);
    const rental = daysN * dp;
    const items = [
      { desc: t2('inv.field.rentalSubtotal'), qty: daysN, unit: dp, total: rental },
      ...(parseFloat(inv.insurance || 0) > 0 ? [{ desc: t2('inv.field.insurance'), qty: dash3, unit: parseFloat(inv.insurance), total: parseFloat(inv.insurance) }] : []),
      ...(parseFloat(inv.fuel || 0) > 0 ? [{ desc: t2('inv.field.fuel'), qty: dash3, unit: parseFloat(inv.fuel), total: parseFloat(inv.fuel) }] : []),
      ...(parseFloat(inv.extra_driver || 0) > 0 ? [{ desc: t2('inv.field.extraDriver'), qty: dash3, unit: parseFloat(inv.extra_driver), total: parseFloat(inv.extra_driver) }] : []),
      ...(parseFloat(inv.other || 0) > 0 ? [{ desc: t2('inv.field.other'), qty: dash3, unit: parseFloat(inv.other), total: parseFloat(inv.other) }] : []),
    ];
    items.forEach((row) => {
      doc.setDrawColor(241, 245, 249);
      doc.rect(M + 4, y, tW, 8, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(String(row.desc), M + 8, y + 5.5);
      doc.text(String(row.qty), M + descW + 4, y + 5.5);
      doc.text(fmt(row.unit), M + descW + amtW / 2, y + 5.5, { align: 'center' });
      doc.text(fmt(row.total), W - M - 6, y + 5.5, { align: 'right' });
      y += 8;
    });
    y += 4;

    fillAccent();
    doc.roundedRect(W - M - 55, y, 55, 14, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(180, 210, 255);
    doc.text(t2('pdf.grandTotal'), W - M - 51, y + 5);
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(fmt(parseFloat(inv.total || 0)), W - M - 4, y + 10.5, { align: 'right' });

    const s = inv.status || 'draft';
    const sc = { paid: [16, 185, 129], pending: [245, 158, 11], overdue: [239, 68, 68], draft: [107, 114, 128] };
    const [r2, g2, b2] = sc[s] || sc.draft;
    doc.setFillColor(r2, g2, b2);
    doc.roundedRect(M + 4, y + 1, 24, 10, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text(t2(`dash.${s}`).toUpperCase(), M + 16, y + 7, { align: 'center' });
    y += 22;

    if (inv.notes) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text(`${t2('pdf.notes')}: ${inv.notes}`, M + 4, y);
      y += 6;
    }

    if (companySettings.sealBase64) {
      doc.addImage(companySettings.sealBase64, 'PNG', W - M - 25, y, 25, 25);
    }

    doc.setDrawColor(226, 232, 240);
    doc.line(M + 4, 278, W - M, 278);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(t2('pdf.generatedBy'), W / 2 + 2, 283, { align: 'center' });
  }

  function buildPDFPageCompact(doc, inv) {
    const t3 = tl;
    const currency = t3('common.currency');
    const W = 210, M = 14;
    let y = 0;
    const lang = getPDFLang();
    const fmt = (amt) => formatCurrency(amt, currency, lang);
    const accent = getAccentColor();

    const fillAccent = () => doc.setFillColor(accent.r, accent.g, accent.b);
    const setAccent = () => doc.setTextColor(accent.r, accent.g, accent.b);

    fillAccent();
    doc.rect(0, 0, W, 20, 'F');
    let nameX3 = M;
    if (companySettings.logoBase64) {
      doc.addImage(companySettings.logoBase64, 'PNG', M, 2, 18, 18);
      nameX3 = M + 22;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(companySettings.companyName || 'RENVA', nameX3, 13);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(`#${inv.invoiceNumber || inv.id.slice(-6).toUpperCase()}`, W - M, 13, { align: 'right' });
    y = 28;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    const info = [`${inv.clientName || '—'}  |  ${inv.cin || '—'}`];
    if (inv.phone) info.push(`${t3('pdf.tel')}: ${inv.phone}`);
    info.forEach(line => { doc.text(line, M, y); y += 4; });
    doc.text(`${inv.vehicleBrand || ''} ${inv.vehicleModel || ''}`.trim() || '—', W - M, y - 4, { align: 'right' });
    if (inv.plate) doc.text(`${t3('pdf.plate')}: ${inv.plate}`, W - M, y, { align: 'right' });
    y += 4;
    doc.text(`${inv.startDate || '—'} → ${inv.endDate || '—'}  (${inv.days ?? calcDays(inv.startDate, inv.endDate)} ${t3('inv.days')})`, M, y);
    y += 8;

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(M, y, W - M, y);
    y += 3;

    const tW = W - M * 2;
    const colW2 = [tW * 0.50, tW * 0.12, tW * 0.18, tW * 0.20];
    const colX = [M, M + colW2[0], M + colW2[0] + colW2[1], M + colW2[0] + colW2[1] + colW2[2]];

    const drawRow = (cells, bold = false, color = [15, 23, 42], size = 7) => {
      cells.forEach((text, i) => {
        const align = i < 2 ? 'left' : (i === 2 ? 'center' : 'right');
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(color[0], color[1], color[2]);
        if (align === 'right') {
          doc.text(text, colX[i] + colW2[i], y, { align: 'right' });
        } else if (align === 'center') {
          doc.text(text, colX[i] + colW2[i] / 2, y, { align: 'center' });
        } else {
          doc.text(text, colX[i] + 4, y);
        }
      });
    };

    // Header row
    fillAccent();
    doc.rect(M, y, tW, 7, 'F');
    drawRow([t3('pdf.description'), t3('pdf.qty'), t3('pdf.ratePerDay'), t3('pdf.amount')], true, [255, 255, 255], 6);
    y += 7;

    const daysN = inv.days ?? calcDays(inv.startDate, inv.endDate);
    const dp2 = parseFloat(inv.dailyPrice || 0);
    const rental = daysN * dp2;
    const dash = '—';

    // Rental subtotal row
    drawRow([t3('inv.field.rentalSubtotal'), String(daysN), fmt(dp2), fmt(rental)], false, [71, 85, 105], 6.5);
    y += 5;

    // Extras rows
    const extras = [
      [t3('inv.field.insurance'), parseFloat(inv.insurance || 0)],
      [t3('inv.field.fuel'), parseFloat(inv.fuel || 0)],
      [t3('inv.field.extraDriver'), parseFloat(inv.extraDriver || 0)],
      [t3('inv.field.other'), parseFloat(inv.other || 0)],
    ];
    extras.forEach(([label, val]) => {
      if (val > 0) {
        drawRow([label, dash, fmt(val), fmt(val)], false, [71, 85, 105], 6.5);
        y += 4.5;
      }
    });

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(M, y, W - M, y);
    y += 3;

    drawRow(['', '', t3('pdf.grandTotal'), fmt(parseFloat(inv.total || 0))], true, [15, 23, 42], 8);
    y += 7;

    const s = inv.status || 'draft';
    const sc = { paid: [16, 185, 129], pending: [245, 158, 11], overdue: [239, 68, 68], draft: [107, 114, 128] };
    const [r, g, b] = sc[s] || sc.draft;
    doc.setFillColor(r, g, b);
    doc.roundedRect(M, y - 6, 22, 8, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(255, 255, 255);
    doc.text(t3(`dash.${s}`).toUpperCase(), M + 11, y - 1.5, { align: 'center' });
    y += 6;
    if (inv.notes) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text(inv.notes, M, y);
    }

    if (companySettings.sealBase64) {
      doc.addImage(companySettings.sealBase64, 'PNG', W - M - 22, y, 22, 22);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(203, 213, 225);
    doc.text(t3('pdf.generatedBy'), W / 2, 288, { align: 'center' });
  }

  // ── Theme toggle ──────────────────────────────────────────
  // ── Sidebar toggle ────────────────────────────────────────
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

  // ── Color helpers ──────────────────────────────────────────
  function getAccentColor() {
    if (invoiceColorMode === 'bw') return { r: 30, g: 41, b: 59 };
    return hexToRgb(invoiceColor);
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return { r: parseInt(h.substring(0,2), 16), g: parseInt(h.substring(2,4), 16), b: parseInt(h.substring(4,6), 16) };
  }

  // ── Helpers ───────────────────────────────────────────────
  function showLoading(state) {
    const loader = document.getElementById('invLoading');
    const tbody  = document.getElementById('invTableBody');
    if (loader) loader.style.display = state ? 'block' : 'none';
  }

  function setLoading(btn, state) {
    if (!btn) return;
    btn.disabled = state;
    btn.classList.toggle('loading', state);
  }

  function showToast(type, message) {
    const toast = document.getElementById('invToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className   = `toast toast-${type} show`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  function formatCurrency(amount, currency, locale) {
    if (isNaN(amount)) amount = 0;
    const num = new Intl.NumberFormat(locale || RENVA_I18N.getLang(), {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
    return (locale === 'ar' ? '\u200E' : '') + num + ' ' + currency;
  }

  function formatShortDate(dateStr, lang) {
    try {
      return new Date(dateStr).toLocaleDateString(lang, { day: '2-digit', month: 'short' });
    } catch {
      return dateStr;
    }
  }

  function toDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    return new Date(val);
  }

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, openEdit, openPreview, openDelete, exportSingle, populateExportModal };
})();


// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  RENVA_I18N.init();
  RENVA_AUTH.init();

  document.addEventListener('RENVA:authReady', ({ detail }) => {
    if (detail.user) RENVA_INVOICES.init(detail.user);
  });

  document.addEventListener('RENVA:langChanged', () => {
    RENVA_I18N.applyToDOM();
    setBrandSubtitle(companySettings.companyName || '');
    RENVA_INVOICES.populateExportModal();
  });
});
