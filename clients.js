

const RENVA_CLIENTS = (() => {
  let currentUser = null;
  let allClients = [];
  let deleteTargetId = null;
  let searchQuery = '';

  function lockScroll() { const y=window.scrollY; document.body.dataset.sy=y; document.documentElement.style.overflow='hidden'; document.body.style.position='fixed'; document.body.style.top=`-${y}px`; document.body.style.left='0'; document.body.style.right='0'; }
  function unlockScroll() { const y=parseInt(document.body.dataset.sy||'0'); document.documentElement.style.overflow=''; document.body.style.position=''; document.body.style.top=''; document.body.style.left=''; document.body.style.right=''; window.scrollTo(0,y); delete document.body.dataset.sy; }

  const $ = id => document.getElementById(id);
  let toast, tbody, loading, empty, search, countBadge;

  function showToast(msg, type = 'success') {
    toast.textContent = msg;
    toast.className = `toast toast-${type} show`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function loadingDone() { loading.style.display = 'none'; }
  function setEmpty(v) { empty.style.display = v ? 'flex' : 'none'; }

  function setBrandSubtitle(name) {
    document.querySelectorAll('.company-name').forEach(el => {
      el.textContent = name || RENVA_I18N.t('brand.subtitle');
    });
  }

  function makeClient(row) {
    return {
      id: row.id,
      name: row.name || '',
      cin: row.cin || '',
      phone: row.phone || '',
      email: row.email || '',
      address: row.address || '',
      notes: row.notes || '',
      createdAt: row.created_at ? new Date(row.created_at) : null
    };
  }

  function render() {
    const q = searchQuery.trim().toLowerCase();
    let filtered = allClients;
    if (q) {
      filtered = allClients.filter(c =>
        (c.name + ' ' + c.cin + ' ' + c.phone + ' ' + c.email).toLowerCase().includes(q)
      );
    }
    countBadge.textContent = filtered.length;

    if (!filtered.length) {
      tbody.innerHTML = '';
      setEmpty(true);
      return;
    }
    setEmpty(false);

    tbody.innerHTML = filtered.map(c => {
      const count = window.clientInvoiceCounts ? (window.clientInvoiceCounts[c.name] || 0) : '-';
      return `<tr>
        <td><span style="font-weight:600;">${escHtml(c.name)}</span></td>
        <td>${escHtml(c.cin)}</td>
        <td>${escHtml(c.phone)}</td>
        <td>${escHtml(c.email)}</td>
        <td><span class="badge badge-outline" style="font-weight:600;">${count}</span></td>
        <td>
          <div class="row-actions">
            <button class="inv-action-btn" onclick="RENVA_CLIENTS.openEdit('${c.id}')" title="${RENVA_I18N.t('common.edit')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="inv-action-btn" onclick="location.href='invoices.html?clientName=${encodeURIComponent(c.name)}&cin=${encodeURIComponent(c.cin)}&phone=${encodeURIComponent(c.phone)}'" title="${RENVA_I18N.t('clients.createInvoice')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </button>
            <button class="inv-action-btn danger" onclick="RENVA_CLIENTS.openDelete('${c.id}')" title="${RENVA_I18N.t('common.delete')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function openModal(client = null) {
    const modal = $('clientModal');
    $('client_id').value = client ? client.id : '';
    $('client_name').value = client ? client.name : '';
    $('client_cin').value = client ? client.cin : '';
    $('client_phone').value = client ? client.phone : '';
    $('client_email').value = client ? client.email : '';
    $('client_address').value = client ? client.address : '';
    $('client_notes').value = client ? client.notes : '';
    $('clientModalTitle').textContent = client ? RENVA_I18N.t('clients.editClient') : RENVA_I18N.t('clients.newClient');
    modal.classList.add('open');
    lockScroll();
  }

  function closeModal() {
    $('clientModal').classList.remove('open');
    unlockScroll();
    $('clientForm').reset();
    $('client_id').value = '';
  }

  async function saveClient(e) {
    e.preventDefault();
    const id = $('client_id').value;
    const name = $('client_name').value.trim();
    const cin = $('client_cin').value.trim();
    if (!name || !cin) {
      showToast(RENVA_I18N.t('common.fillRequired'), 'error');
      return;
    }

    const saveBtn = $('clientSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = RENVA_I18N.t('common.saving');

    try {
      const data = {
        name: $('client_name').value.trim(),
        cin: $('client_cin').value.trim(),
        phone: $('client_phone').value.trim(),
        email: $('client_email').value.trim(),
        address: $('client_address').value.trim(),
        notes: $('client_notes').value.trim(),
        updated_at: new Date().toISOString()
      };

      if (id) {
        const { error } = await supabase.from('clients').update(data).eq('id', id);
        if (error) throw error;
        showToast(RENVA_I18N.t('clients.updated'));
      } else {
        data.user_id = currentUser.uid;
        data.created_at = new Date().toISOString();
        const { error } = await supabase.from('clients').insert(data);
        if (error) throw error;
        showToast(RENVA_I18N.t('clients.saved'));
      }
      closeModal();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = RENVA_I18N.t('common.save');
    }
  }

  async function confirmDelete() {
    if (!deleteTargetId || !currentUser) return;
    const btn = $('deleteConfirmBtn');
    btn.disabled = true;
    try {
      const { error } = await supabase.from('clients').delete().eq('id', deleteTargetId);
      if (error) throw error;
      showToast(RENVA_I18N.t('clients.deleted'));
      closeDeleteModal();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function closeDeleteModal() {
    $('deleteModal').classList.remove('open');
    unlockScroll();
    deleteTargetId = null;
  }

  async function subscribe() {
    loading.style.display = 'flex';
    setEmpty(false);

    try {
      const { data, error } = await supabase.from('clients')
        .select('*')
        .eq('user_id', currentUser.uid)
        .order('created_at', { ascending: false });
      if (error) throw error;
      allClients = (data || []).map(makeClient);
      loadingDone();
      render();
      loadInvoiceCounts();
    } catch (err) {
      console.error('Clients load error', err);
      loadingDone();
      setEmpty(true);
    }
  }

  async function loadInvoiceCounts() {
    if (!currentUser) return;
    try {
      const { data, error } = await supabase.from('invoices')
        .select('client_name')
        .eq('user_id', currentUser.uid);
      if (error) throw error;
      const counts = {};
      (data || []).forEach(d => {
        const name = d.client_name || '';
        if (name) counts[name] = (counts[name] || 0) + 1;
      });
      window.clientInvoiceCounts = counts;
      render();
    } catch (e) {}
  }

  function initSidebar() {
    const hamburger = document.getElementById('hamburger');
    const sidebar   = document.getElementById('sidebar');
    const overlay   = document.getElementById('sidebarOverlay');
    if (hamburger && sidebar) {
      hamburger.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay?.classList.toggle('show');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar?.classList.remove('open');
        overlay.classList.remove('show');
      });
    }
  }

  function init(user) {
    if (!user) return;
    currentUser = user;

    document.querySelectorAll('.user-email').forEach(el => el.textContent = user.email);
    document.querySelectorAll('.user-avatar-text').forEach(el => el.textContent = 'RV');

    supabase.from('companies').select('company_name').eq('user_id', user.uid).maybeSingle().then(({ data }) => {
      const cn = data?.company_name || '';
      setBrandSubtitle(cn);
      RENVA_CLIENTS._cn = cn;
    }).catch(() => {});

    // Resolve DOM refs here — guaranteed ready (avoids null refs on mobile)
    toast      = $('clientToast');
    tbody      = $('clientTableBody');
    loading    = $('clientLoading');
    empty      = $('clientEmpty');
    search     = $('clientSearch');
    countBadge = $('clientCount');

    subscribe();
    initSidebar();

    $('btnNewClient').addEventListener('click', () => openModal());
    $('clientModalClose').addEventListener('click', closeModal);
    $('clientModalCancel').addEventListener('click', closeModal);
    $('clientSaveBtn').addEventListener('click', saveClient);
    $('clientForm').addEventListener('submit', saveClient);

    $('deleteModalClose').addEventListener('click', closeDeleteModal);
    $('deleteCancelBtn').addEventListener('click', closeDeleteModal);
    $('deleteConfirmBtn').addEventListener('click', confirmDelete);

    search.addEventListener('input', e => {
      searchQuery = e.target.value;
      render();
    });
    search.addEventListener('search', () => render());

    document.querySelectorAll('.modal-backdrop').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target === el) {
          el.classList.remove('open');
          unlockScroll();
        }
      });
    });
  }

  function openEdit(id) {
    const client = allClients.find(c => c.id === id);
    if (client) openModal(client);
  }

  return { init, openEdit, refresh: () => render(), openDelete: id => { deleteTargetId = id; $('deleteModal').classList.add('open'); lockScroll(); } };
})();

document.addEventListener('DOMContentLoaded', () => {
  RENVA_I18N.init();
  RENVA_AUTH.init();

  document.addEventListener('RENVA:authReady', ({ detail }) => {
    if (detail.user) RENVA_CLIENTS.init(detail.user);
  });

  document.addEventListener('RENVA:langChanged', () => {
    RENVA_I18N.applyToDOM();
    setBrandSubtitle(RENVA_CLIENTS._cn || '');
    RENVA_CLIENTS.refresh();
  });
});
