// ============================================================
// RENVA - Authentication Module (Supabase)
// ============================================================

const RENVA_AUTH = (() => {
  const PROTECTED_PAGES = ['dashboard.html', 'settings.html', 'invoices.html', 'reports.html', 'clients.html'];
  const LOGIN_PAGE      = 'login.html';
  const HOME_PAGE       = 'dashboard.html';

  let _currentUser = null;

  // ── Route Guard ──────────────────────────────────────────
  function guardRoute() {
    const page = window.location.pathname.split('/').pop() || 'index.html';

    supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null;
      _currentUser = user;

      const isProtected = PROTECTED_PAGES.some(p => page.includes(p));
      const isLoginPage  = page.includes(LOGIN_PAGE) || page === '' || page === 'index.html';

      if (!user && isProtected) {
        window.location.href = LOGIN_PAGE;
      } else if (user && isLoginPage) {
        window.location.href = HOME_PAGE;
      }

      document.dispatchEvent(new CustomEvent('RENVA:authReady', { detail: { user } }));
    });
  }

  // ── Login ─────────────────────────────────────────────────
  async function login(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  // ── Logout ────────────────────────────────────────────────
  async function logout() {
    await supabase.auth.signOut();
    window.location.href = LOGIN_PAGE;
  }

  // ── Forgot Password ───────────────────────────────────────
  async function sendPasswordReset(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/' + LOGIN_PAGE,
    });
    if (error) throw error;
  }

  // ── Current User ─────────────────────────────────────────
  function currentUser() {
    return _currentUser;
  }

  // ── Init ─────────────────────────────────────────────────
  function init() {
    guardRoute();

    // Wire login form if present
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        const email    = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const btn      = document.getElementById('loginBtn');
        const errBox   = document.getElementById('loginError');

        setLoading(btn, true);
        errBox.textContent = '';
        errBox.classList.remove('show');

        try {
          await login(email, password);
        } catch (err) {
          errBox.textContent = translateAuthError(err.message);
          errBox.classList.add('show');
          setLoading(btn, false);
        }
      });
    }

    // Wire forgot-password form if present
    const resetForm = document.getElementById('resetForm');
    if (resetForm) {
      resetForm.addEventListener('submit', async e => {
        e.preventDefault();
        const email  = document.getElementById('resetEmail').value.trim();
        const btn    = document.getElementById('resetBtn');
        const msg    = document.getElementById('resetMessage');

        setLoading(btn, true);
        msg.textContent = '';
        msg.className   = 'form-message';

        try {
          await sendPasswordReset(email);
          msg.textContent = RENVA_I18N.t('auth.resetSent');
          msg.classList.add('success');
        } catch (err) {
          msg.textContent = translateAuthError(err.message);
          msg.classList.add('error');
        } finally {
          setLoading(btn, false);
        }
      });
    }

    // Wire logout buttons
    document.querySelectorAll('[data-action="logout"]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); logout(); });
    });
  }

  // ── Helpers ───────────────────────────────────────────────
  function setLoading(btn, state) {
    if (!btn) return;
    btn.disabled = state;
    btn.classList.toggle('loading', state);
  }

  function translateAuthError(message) {
    const map = {
      'Invalid login credentials':           RENVA_I18N.t('auth.wrongPassword'),
      'Email not confirmed':                 RENVA_I18N.t('auth.genericError'),
      'Invalid email':                       RENVA_I18N.t('auth.invalidEmail'),
      'User not found':                      RENVA_I18N.t('auth.userNotFound'),
      'Too many requests':                   RENVA_I18N.t('auth.tooManyRequests'),
      'User is disabled':                    RENVA_I18N.t('auth.userDisabled'),
      'Email rate limit exceeded':           RENVA_I18N.t('auth.tooManyRequests'),
      'Password should be at least 6 characters': RENVA_I18N.t('auth.genericError'),
    };
    return map[message] || RENVA_I18N.t('auth.genericError');
  }

  return { init, login, logout, sendPasswordReset, currentUser, guardRoute };
})();
