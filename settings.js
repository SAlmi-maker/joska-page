// ============================================================
// RENVA - Settings Module
// ============================================================

const RENVA_SETTINGS = (() => {

  let currentSettings = {};
  let pendingLogoFile = null;

  function setBrandSubtitle(name) {
    document.querySelectorAll('.company-name').forEach(el => {
      el.textContent = name || RENVA_I18N.t('brand.subtitle');
    });
  }

  // ── Init ─────────────────────────────────────────────────
  function init(user) {
    if (!user) return;
    document.querySelectorAll('.user-email').forEach(el => el.textContent = user.email);
    document.querySelectorAll('.user-avatar-text').forEach(el => el.textContent = 'RV');
    loadSettings(user.uid);
    wireForm(user.uid);
    wireFileUploads();
    initSidebar();
  }

  // ── Load Settings ─────────────────────────────────────────
  async function loadSettings(uid) {
    try {
      const { data, error } = await supabase.from('companies')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        currentSettings = data;
        populateForm(currentSettings);
        if (currentSettings.company_name) {
          document.querySelectorAll('.user-avatar-text').forEach(el => el.textContent = currentSettings.company_name.slice(0, 2).toUpperCase());
          setBrandSubtitle(currentSettings.company_name);
        }
      }
    } catch (err) {
      console.error('Settings load error:', err);
    }
  }

  function populateForm(data) {
    const fields = ['company_name', 'address', 'phone', 'email', 'website'];

    const fieldIds = { company_name: 'companyName', address: 'address', phone: 'phone', email: 'email', website: 'website' };

    fields.forEach(f => {
      const el = document.getElementById(`field_${fieldIds[f]}`);
      if (el && data[f]) {
        el.value = data[f];
      }
    });

    const currencyEl = document.getElementById('field_currency');
    if (currencyEl && data.currency) {
      currencyEl.value = data.currency;
      RENVA_I18N.setCurrency(data.currency);
    }

    if (data.logo_base64) {
      const preview = document.getElementById('logoPreview');
      if (preview) {
        preview.src = data.logo_base64;
        preview.style.display = 'block';
      }
    }

    const colorMode = data.invoice_color_mode || 'bw';
    const colorRadio = document.querySelector(`input[name="invoiceColorMode"][value="${colorMode}"]`);
    if (colorRadio) colorRadio.checked = true;
    const colorVal = data.invoice_color || '#2563EB';
    const colorInput = document.getElementById('invoiceColorInput');
    const colorText = document.getElementById('invoiceColorText');
    if (colorInput) colorInput.value = colorVal;
    if (colorText) colorText.value = colorVal;
    toggleColorPicker(colorMode === 'custom');
    const langSel = document.getElementById('invoiceLanguage');
    if (langSel) langSel.value = data.invoice_language || '';
    const excelSel = document.getElementById('excelLang');
    if (excelSel) excelSel.value = data.excel_lang || '';
  }

  function toggleColorPicker(show) {
    const wrapper = document.getElementById('colorPickerWrapper');
    if (wrapper) wrapper.style.display = show ? 'block' : 'none';
  }

  // ── Form Wiring ───────────────────────────────────────────
  function wireForm(uid) {
    const form = document.getElementById('settingsForm');
    if (!form) return;

    // Color mode toggle
    document.querySelectorAll('input[name="invoiceColorMode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        toggleColorPicker(radio.value === 'custom');
      });
    });
    // Sync color picker <-> text input
    const colorInput = document.getElementById('invoiceColorInput');
    const colorText = document.getElementById('invoiceColorText');
    if (colorInput && colorText) {
      colorInput.addEventListener('input', () => { colorText.value = colorInput.value; });
      colorText.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(colorText.value)) colorInput.value = colorText.value; });
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn     = document.getElementById('saveBtn');
      const toast   = document.getElementById('settingsToast');

      setLoading(btn, true);

      try {
        const updates = {
          company_name:       document.getElementById('field_companyName')?.value.trim() || '',
          address:            document.getElementById('field_address')?.value.trim()     || '',
          phone:              document.getElementById('field_phone')?.value.trim()       || '',
          email:              document.getElementById('field_email')?.value.trim()       || '',
          website:            document.getElementById('field_website')?.value.trim()     || '',
          currency:           document.getElementById('field_currency')?.value || 'MAD',
          invoice_color_mode: document.querySelector('input[name="invoiceColorMode"]:checked')?.value || 'bw',
          invoice_color:      document.getElementById('invoiceColorInput')?.value || '#2563EB',
          invoice_language:   document.getElementById('invoiceLanguage')?.value || '',
          excel_lang:         document.getElementById('excelLang')?.value || '',
          updated_at:         new Date().toISOString()
        };

        if (pendingLogoFile) {
          updates.logo_base64 = await fileToBase64(pendingLogoFile);
          pendingLogoFile = null;
        } else if (currentSettings.logo_base64) {
          updates.logo_base64 = currentSettings.logo_base64;
        }

        const { error } = await supabase.from('companies')
          .upsert({ user_id: uid, ...updates }, { onConflict: 'user_id' });
        if (error) throw error;

        currentSettings = { ...currentSettings, ...updates };
        RENVA_I18N.setCurrency(updates.currency);
        showToast(toast, 'success', RENVA_I18N.t('settings.saved'));
      } catch (err) {
        console.error('Settings save error:', err);
        showToast(toast, 'error', RENVA_I18N.t('settings.error'));
      } finally {
        setLoading(btn, false);
      }
    });
  }

  // ── File Uploads ──────────────────────────────────────────
  function wireFileUploads() {
    wireDropZone('logoDropZone', 'logoInput', 'logoPreview', file => { pendingLogoFile = file; });
  }

  function wireDropZone(zoneId, inputId, previewId, onFile) {
    const zone    = document.getElementById(zoneId);
    const input   = document.getElementById(inputId);
    const preview = document.getElementById(previewId);

    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        onFile(file);
        showPreview(preview, file);
      }
    });
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (file) { onFile(file); showPreview(preview, file); }
    });
  }

  function showPreview(previewEl, file) {
    if (!previewEl) return;
    const reader = new FileReader();
    reader.onload = e => { previewEl.src = e.target.result; previewEl.style.display = 'block'; };
    reader.readAsDataURL(file);
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Helpers ───────────────────────────────────────────────
  function setLoading(btn, state) {
    if (!btn) return;
    btn.disabled = state;
    btn.classList.toggle('loading', state);
    const span = btn.querySelector('span');
    if (span) span.textContent = state ? RENVA_I18N.t('settings.saving') : RENVA_I18N.t('settings.saveBtn');
  }

  function showToast(toast, type, message) {
    if (!toast) return;
    toast.textContent = message;
    toast.className   = `toast toast-${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3500);
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
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
      });
    }
  }

  return { init };
})();


// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  RENVA_I18N.init();
  RENVA_AUTH.init();

  document.addEventListener('RENVA:authReady', ({ detail }) => {
    if (detail.user) RENVA_SETTINGS.init(detail.user);
  });

  document.addEventListener('RENVA:langChanged', () => {
    RENVA_I18N.applyToDOM();
    setBrandSubtitle(currentSettings.company_name || '');
  });
});
