/* ================================================================
   P2P WALLET — p2p.js
   Vanilla JS client runtime (ES2022+), no bundler, no framework.
   Same architecture as the RTR storefront's client.js:
   IIFE · auto page detection via document.body.dataset.page ·
   Config · Utils · Storage · Store · API client · Auth · Notify ·
   Modal · Layout · page modules · Bootstrap.

   SIMULATION ONLY: no real money is ever moved. All balances,
   transfers and deposits are simulated by the backend.

   TYPES (JSDoc, mirrors backend app/schemas.py). Money is ALWAYS a
   decimal STRING (e.g. "1500.00000000") — never parse it as a float.
   @typedef {{id:string,email:string,username:string,full_name:string,account_number:string,
              status:string,role:'user'|'admin'|'super_admin',is_email_verified:boolean,
              created_at:string,updated_at:string}} User
   @typedef {{id:string,username:string,full_name:string,account_number:string}} PublicUser
   @typedef {{id:string,user_id:string,wallet_number:string,currency:string,available_balance:string,
              ledger_balance:string,status:'active'|'frozen'|'suspended'|'closed',created_at:string}} Wallet
   @typedef {{id:string,reference:string,transaction_type:string,direction:'sent'|'received',status:string,
              amount:string,currency:string,fee:string,description:string|null,counterparty:PublicUser|null,
              created_at:string,completed_at:string|null}} TransactionHistoryItem
   @typedef {{id:string,reference:string,sender_user_id:string|null,recipient_user_id:string|null,
              sender_wallet_id:string|null,recipient_wallet_id:string|null,transaction_type:string,status:string,
              amount:string,currency:string,fee:string,description:string|null,created_at:string,
              completed_at:string|null}} Transaction
   @typedef {{items:any[],total:number,page:number,page_size:number,total_pages:number}} Page
   ================================================================ */
(() => {
  'use strict';

  /* ==============================================================
     1. CONFIGURATION
     ============================================================== */
  const CONFIG = {
    API_BASE: (window.P2P_CONFIG && window.P2P_CONFIG.API_BASE || '').replace(/\/+$/, ''),
    REQUEST_TIMEOUT: 20000,
    SESSION_KEY: 'p2p_session',
    PENDING_TRANSFER_KEY: 'p2p_pending_transfer',
    DEFAULT_PAGE_SIZE: 10,
    PASSWORD_MIN: 12,
  };

  const WALLET_STATUS = ['active', 'frozen', 'suspended', 'closed'];

  /* ==============================================================
     2. DOM + UTILITY HELPERS
     ============================================================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (node, evt, fn, opts) => node && node.addEventListener(evt, fn, opts);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const html = (strings, ...vals) => strings.reduce((out, s, i) => out + s + (i < vals.length ? (vals[i] && vals[i].__raw !== undefined ? vals[i].__raw : esc(vals[i])) : ''), '');
  const raw = (s) => ({ __raw: s });

  const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`);

  const qs = (params) => {
    const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return q ? `?${q}` : '';
  };

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  /** Format a decimal STRING without floating point: group thousands, 2–8 decimals (trailing zeros trimmed to 2). */
  const fmtAmount = (value) => {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim());
    if (!m) return '—';
    const [, sign, int, dec = ''] = m;
    let frac = dec.replace(/0+$/, '');
    if (frac.length < 2) frac = frac.padEnd(2, '0');
    return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
  };
  const fmtMoney = (value, currency) => `${fmtAmount(value)} ${esc(currency || '')}`.trim();

  /** Compare two non-negative decimal strings exactly (returns -1, 0, 1). */
  const cmpDecimal = (a, b) => {
    const norm = (s) => { const [i, d = ''] = String(s).split('.'); return [i.replace(/^0+(?=\d)/, ''), d.replace(/0+$/, '')]; };
    const [ai, ad] = norm(a); const [bi, bd] = norm(b);
    if (ai.length !== bi.length) return ai.length < bi.length ? -1 : 1;
    if (ai !== bi) return ai < bi ? -1 : 1;
    const len = Math.max(ad.length, bd.length); const x = ad.padEnd(len, '0'); const y = bd.padEnd(len, '0');
    return x === y ? 0 : x < y ? -1 : 1;
  };

  const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const icon = (name) => ({
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>',
  }[name] || '');

  /* ==============================================================
     3. STORAGE + STATE
     Sessions live in sessionStorage (tab-scoped, cleared when the tab
     closes). Passwords are never stored. NOTE: any script-readable
     storage is exposed to XSS; the safer production design is an
     httpOnly refresh-token cookie issued by the backend.
     ============================================================== */
  const Session = {
    read() { try { return JSON.parse(sessionStorage.getItem(CONFIG.SESSION_KEY)) || null; } catch { return null; } },
    write(s) { try { sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } },
    clear() { try { sessionStorage.removeItem(CONFIG.SESSION_KEY); } catch { /* ignore */ } },
  };

  /* ==============================================================
     4. NOTIFICATIONS (toasts — same markup/classes as client.js)
     ============================================================== */
  const Notify = (() => {
    let stack;
    const ensure = () => { if (!stack) { stack = document.createElement('div'); stack.className = 'toast-stack'; stack.setAttribute('role', 'status'); stack.setAttribute('aria-live', 'polite'); document.body.appendChild(stack); } return stack; };
    const show = (msg, type = 'success', ms = 3800) => {
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      t.innerHTML = `<span class="ti">${icon(type === 'error' ? 'x' : type === 'warning' ? 'warn' : type === 'info' ? 'info' : 'check')}</span><span>${esc(msg)}</span>`;
      ensure().appendChild(t);
      requestAnimationFrame(() => t.classList.add('show'));
      const close = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
      const timer = setTimeout(close, ms);
      on(t, 'click', () => { clearTimeout(timer); close(); });
    };
    return { success: (m) => show(m, 'success'), error: (m) => show(m, 'error', 6000), warning: (m) => show(m, 'warning', 5000), info: (m) => show(m, 'info') };
  })();

  /* ==============================================================
     5. MODAL (focus trap, Esc to close) — .modal-bg / .modal classes
     ============================================================== */
  const Modal = (() => {
    const focusable = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
    let stack = [];
    const trap = (e) => {
      const top = stack[stack.length - 1];
      if (!top) return;
      if (e.key === 'Escape' && top.dismissible) { e.preventDefault(); top.close(null); return; }
      if (e.key !== 'Tab') return;
      const nodes = $$(focusable, top.bg).filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    on(document, 'keydown', trap);

    /** Open a dialog. Resolves with the value passed to close(); `bodyHtml` must be pre-escaped. */
    const open = ({ title, bodyHtml, footHtml = '', dismissible = true, onMount }) => new Promise((resolve) => {
      const lastFocused = document.activeElement;
      const bg = document.createElement('div');
      bg.className = 'modal-bg on';
      bg.setAttribute('aria-hidden', 'false');
      bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title"><div class="modal-head"><h3 class="modal-title" id="m-title">${esc(title)}</h3>${dismissible ? `<button class="icon-btn" data-m-close aria-label="Close">${icon('x')}</button>` : ''}</div><div class="modal-body">${bodyHtml}</div>${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}</div>`;
      document.body.appendChild(bg);
      document.body.style.overflow = 'hidden';
      const entry = { bg, dismissible, close(value) { stack = stack.filter((s) => s !== entry); bg.remove(); if (!stack.length) document.body.style.overflow = ''; lastFocused && lastFocused.focus && lastFocused.focus(); resolve(value); } };
      stack.push(entry);
      on(bg, 'click', (e) => { if (e.target === bg && dismissible) entry.close(null); if (e.target.closest('[data-m-close]')) entry.close(null); const v = e.target.closest('[data-m-value]'); if (v) entry.close(v.dataset.mValue); });
      setTimeout(() => { const f = $(focusable, bg); f && f.focus(); }, 30);
      if (onMount) onMount(bg, entry);
    });

    /** Confirmation dialog -> Promise<boolean>. */
    const confirm = async ({ title, message, confirmLabel = 'Confirm', danger = false, bodyHtml = '' }) => {
      const v = await open({ title, bodyHtml: `<p>${esc(message)}</p>${bodyHtml}`, footHtml: `<button class="btn btn-ghost" data-m-value="no">Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-m-value="yes">${esc(confirmLabel)}</button>` });
      return v === 'yes';
    };

    /** Prompt for a required reason -> Promise<string|null>. */
    const reason = ({ title, message, confirmLabel = 'Confirm' }) => open({
      title,
      bodyHtml: `<p>${esc(message)}</p><div class="form-group" style="margin-top:1rem"><label for="m-reason">Reason (min. 5 characters)</label><input id="m-reason" maxlength="500" autocomplete="off"><span class="field-error" id="m-reason-err"></span></div>`,
      footHtml: `<button class="btn btn-ghost" data-m-value="">Cancel</button><button class="btn btn-primary" id="m-reason-ok">${esc(confirmLabel)}</button>`,
      onMount: (bg, entry) => {
        const input = $('#m-reason', bg);
        const submit = () => { const v = input.value.trim(); if (v.length < 5) { $('#m-reason-err', bg).textContent = 'Please enter at least 5 characters.'; return; } entry.close(v); };
        on($('#m-reason-ok', bg), 'click', submit);
        on(input, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      },
    }).then((v) => (v ? v : null));

    return { open, confirm, reason, close: () => stack.length && stack[stack.length - 1].close(null) };
  })();

  /* ==============================================================
     6. API CLIENT (single entry point for every backend call)
     - Base URL from js/config.js
     - Bearer token, JSON, timeouts, error normalisation
     - One automatic token refresh (single-flight) on 401
     - Retries only idempotent GETs; never blindly repeats a POST
     ============================================================== */
  class ApiError extends Error {
    constructor(message, { status = 0, code = null, errors = null, uncertain = false, headers = null } = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.errors = errors;
      /** True when the request may or may not have been processed (timeout / dropped connection). */
      this.uncertain = uncertain;
      this.headers = headers;
    }
  }

  let refreshInFlight = null;

  const rawFetch = async (method, path, { json, token, timeout = CONFIG.REQUEST_TIMEOUT, headers = {} } = {}) => {
    if (!CONFIG.API_BASE) throw new ApiError('The API URL is not configured (see js/config.js).');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const opts = { method, signal: controller.signal, headers: { Accept: 'application/json', ...headers } };
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    if (json !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(json); }
    let res;
    try {
      res = await fetch(CONFIG.API_BASE + path, opts);
    } catch (err) {
      const timedOut = err && err.name === 'AbortError';
      throw new ApiError(timedOut ? 'The request timed out.' : 'Cannot reach the server. Check your connection.', { code: timedOut ? 'timeout' : 'network', uncertain: method !== 'GET' });
    } finally { clearTimeout(timer); }

    let payload = null;
    if ((res.headers.get('content-type') || '').includes('application/json')) { try { payload = await res.json(); } catch { payload = null; } }
    if (!res.ok) {
      let message = (payload && typeof payload.detail === 'string' && payload.detail) || `Request failed (${res.status}).`;
      if (payload && Array.isArray(payload.errors) && payload.errors.length) message = payload.errors.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' · ');
      throw new ApiError(message, { status: res.status, code: payload && payload.code, errors: payload && payload.errors, uncertain: res.status >= 500 && method !== 'GET', headers: res.headers });
    }
    payload = payload === null ? {} : payload;
    Object.defineProperty(payload, '__headers', { value: res.headers, enumerable: false });
    Object.defineProperty(payload, '__status', { value: res.status, enumerable: false });
    return payload;
  };

  const refreshTokens = () => {
    if (refreshInFlight) return refreshInFlight;
    const s = Session.read();
    if (!s || !s.refresh) return Promise.reject(new ApiError('Session expired.', { status: 401, code: 'not_authenticated' }));
    refreshInFlight = rawFetch('POST', '/auth/refresh', { json: { refresh_token: s.refresh } })
      .then((data) => { Session.write({ access: data.access_token, refresh: data.refresh_token, user: data.user }); return data; })
      .finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  };

  const request = async (method, path, { json, auth = true, retries, headers, timeout } = {}) => {
    const attempts = (retries ?? (method === 'GET' ? 2 : 0)) + 1;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const s = auth ? Session.read() : null;
        if (auth && !s) throw new ApiError('Please sign in to continue.', { status: 401, code: 'not_authenticated' });
        try {
          return await rawFetch(method, path, { json, token: s && s.access, headers, timeout });
        } catch (err) {
          // Expired access token: refresh once, then repeat. Safe for POSTs because a 401
          // means the server rejected the call before doing any work.
          if (auth && err instanceof ApiError && err.status === 401 && !path.startsWith('/auth/')) {
            try { await refreshTokens(); } catch { Auth.expire(); throw err; }
            return await rawFetch(method, path, { json, token: Session.read().access, headers, timeout });
          }
          throw err;
        }
      } catch (err) {
        lastErr = err;
        const retryable = method === 'GET' && err instanceof ApiError && (err.code === 'network' || err.code === 'timeout' || err.status >= 502);
        if (!retryable || i === attempts - 1) break;
        await sleep(500 * (i + 1));
      }
    }
    throw lastErr;
  };

  const http = {
    get: (p, o) => request('GET', p, o),
    post: (p, json, o) => request('POST', p, { json, ...o }),
    patch: (p, json, o) => request('PATCH', p, { json, ...o }),
  };

  /* Domain API surface — mapped 1:1 to backend app/routes.py (see ENDPOINT MAP in README). */
  const API = {
    register: (d) => http.post('/auth/register', d, { auth: false }),
    login: (identifier, password) => http.post('/auth/login', { identifier, password }, { auth: false }),
    logout: (refresh_token) => http.post('/auth/logout', { refresh_token }),
    verifyEmail: (token) => http.post('/auth/verify-email', { token }, { auth: false }),
    resendVerification: (email) => http.post('/auth/resend-verification', { email }, { auth: false }),
    forgotPassword: (email) => http.post('/auth/password-reset/request', { email }, { auth: false }),
    resetPassword: (d) => http.post('/auth/password-reset/confirm', d, { auth: false }),
    changePassword: (d) => http.post('/auth/change-password', d),
    me: () => http.get('/users/me'),
    updateMe: (d) => http.patch('/users/me', d),
    lookup: (acct) => http.get(`/users/lookup/${encodeURIComponent(acct)}`, { retries: 0 }),
    wallets: () => http.get('/wallets'),
    createWallet: (currency) => http.post('/wallets', { currency }),
    wallet: (id) => http.get(`/wallets/${id}`),
    reconcile: (id) => http.get(`/wallets/${id}/reconciliation`),
    transfer: (d) => http.post('/transactions/transfer', d, { timeout: 30000 }),
    history: (p) => http.get(`/transactions/history${qs(p)}`),
    totals: (currency) => http.get(`/transactions/totals${qs({ currency })}`),
    transaction: (id) => http.get(`/transactions/${id}`),
    admin: {
      overview: () => http.get('/admin/overview'),
      users: (p) => http.get(`/admin/users${qs(p)}`),
      updateUser: (id, d) => http.patch(`/admin/users/${id}`, d),
      wallets: (p) => http.get(`/admin/wallets${qs(p)}`),
      reconcile: (id) => http.get(`/admin/wallets/${id}/reconciliation`),
      walletAction: (id, action, d) => http.post(`/admin/wallets/${id}/${action}`, d),
      transactions: (p) => http.get(`/admin/transactions${qs(p)}`),
      deposit: (d) => http.post('/admin/deposits/simulate', d, { timeout: 30000 }),
      audit: (p) => http.get(`/admin/audit-logs${qs(p)}`),
    },
  };

  /* ==============================================================
     7. AUTH MANAGER
     ============================================================== */
  const Auth = {
    user() { const s = Session.read(); return s ? s.user : null; },
    isAuthed() { return !!Session.read(); },
    role() { const u = this.user(); return u ? u.role : null; },
    isAdmin() { return ['admin', 'super_admin'].includes(this.role()); },
    isSuperAdmin() { return this.role() === 'super_admin'; },
    async login(identifier, password) {
      const data = await API.login(identifier, password);
      Session.write({ access: data.access_token, refresh: data.refresh_token, user: data.user });
      return data.user;
    },
    async logout() {
      const s = Session.read();
      try { if (s && s.refresh) await API.logout(s.refresh); } catch { /* the local session is cleared regardless */ }
      Session.clear();
      location.href = 'index.html';
    },
    /** Called when the session can no longer be refreshed. */
    expire() {
      Session.clear();
      if (document.body.dataset.page !== 'auth') location.href = `index.html?expired=1&next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`;
    },
    /** Guard for protected pages (presentation only — the backend enforces authorisation). */
    require({ admin = false } = {}) {
      if (!this.isAuthed()) { location.replace(`index.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`); return false; }
      if (admin && !this.isAdmin()) { location.replace('dashboard.html'); return false; }
      return true;
    },
    async refreshUser() { const u = await API.me(); const s = Session.read(); if (s) Session.write({ ...s, user: u }); return u; },
  };

  /* ==============================================================
     8. SHARED UI HELPERS
     ============================================================== */
  const statusBadge = (s) => `<span class="badge ${esc(String(s).toLowerCase())}">${esc(titleCase(s))}</span>`;
  const skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="skeleton skeleton-block" style="height:3.2rem;margin-bottom:.7rem"></div>').join('');
  const emptyState = (title, text, action = '') => `<div class="empty-state"><div class="es-icon">${icon('wallet')}</div><h4>${esc(title)}</h4><p>${esc(text)}</p>${action}</div>`;
  const errorState = (err, retryId) => `<div class="alert alert-danger" role="alert">${icon('warn')}<div><div class="alert-title">Something went wrong</div><p>${esc(err.message || 'Please try again.')}</p>${retryId ? `<button class="btn btn-ghost btn-sm" id="${retryId}" style="margin-top:.6rem">Retry</button>` : ''}</div></div>`;

  /** Disable a button and show a spinner while `fn` runs. Prevents double submission. */
  const withBusy = async (btn, fn) => {
    if (!btn || btn.disabled) return undefined;
    const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-sm"></span>';
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
  };

  const setFieldError = (form, name, msg) => {
    const input = form.elements[name]; if (!input) return;
    const group = input.closest('.form-group'); if (!group) return;
    let node = $('.field-error', group);
    if (!node) { node = document.createElement('span'); node.className = 'field-error'; group.appendChild(node); }
    node.textContent = msg || ''; input.classList.toggle('input-error', !!msg);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  const clearErrors = (form) => $$('.field-error', form).forEach((n) => { n.textContent = ''; $$('input,select', n.closest('.form-group') || form).forEach((i) => i.classList.remove('input-error')); });

  /** Surface backend per-field validation errors (422) next to the inputs. Returns true if any were shown. */
  const showServerFieldErrors = (form, err) => {
    if (!err || !Array.isArray(err.errors)) return false;
    let shown = false;
    err.errors.forEach((e) => { const name = (e.field || '').split('.').pop(); if (form.elements[name]) { setFieldError(form, name, e.message); shown = true; } });
    return shown;
  };

  const V = {
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
    username: (v) => /^[A-Za-z0-9_.-]{3,30}$/.test(v),
    account: (v) => /^\d{8,20}$/.test(v),
    amount: (v) => /^\d{1,16}(\.\d{1,8})?$/.test(v) && /[1-9]/.test(v),
    password(v) {
      const p = [];
      if (v.length < CONFIG.PASSWORD_MIN) p.push(`at least ${CONFIG.PASSWORD_MIN} characters`);
      if (!/[A-Z]/.test(v)) p.push('an uppercase letter');
      if (!/[a-z]/.test(v)) p.push('a lowercase letter');
      if (!/\d/.test(v)) p.push('a number');
      if (!/[^A-Za-z0-9]/.test(v)) p.push('a special character');
      return p.length ? `Password needs ${p.join(', ')}.` : '';
    },
  };

  const passwordField = (id, label, name = id, autocomplete = 'current-password') => `
    <div class="form-group"><label for="${id}">${esc(label)}</label>
      <div style="position:relative"><input id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" required maxlength="128" style="padding-right:4.2rem">
      <button type="button" class="btn btn-sm" data-toggle-pw="${id}" aria-label="Show or hide password" style="position:absolute;right:.35rem;top:50%;transform:translateY(-50%)">Show</button></div></div>`;

  const bindPasswordToggles = (root) => $$('[data-toggle-pw]', root).forEach((b) => on(b, 'click', () => {
    const input = $(`#${b.dataset.togglePw}`, root); const show = input.type === 'password';
    input.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show';
  }));

  const pager = (page) => `<div class="pager"><button class="btn btn-ghost btn-sm" data-page="${page.page - 1}" ${page.page <= 1 ? 'disabled' : ''}>Previous</button><span class="text-muted">Page ${page.page} of ${Math.max(page.total_pages, 1)} · ${page.total} total</span><button class="btn btn-ghost btn-sm" data-page="${page.page + 1}" ${page.page >= page.total_pages ? 'disabled' : ''}>Next</button></div>`;
  const bindPager = (root, fn) => $$('[data-page]', root).forEach((b) => on(b, 'click', () => !b.disabled && fn(Number(b.dataset.page))));

  const copyText = async (text) => { try { await navigator.clipboard.writeText(text); Notify.success('Copied.'); } catch { Notify.warning('Copy is not available in this browser.'); } };

  /** Map backend error codes to clear messages (falls back to the server message). */
  const friendlyError = (err) => {
    const m = {
      insufficient_funds: 'Insufficient balance in the selected wallet.',
      recipient_unavailable: 'That recipient account was not found or is unavailable.',
      recipient_wallet_not_found: 'The recipient has no wallet in this currency yet.',
      recipient_wallet_unavailable: 'The recipient’s wallet cannot receive funds right now.',
      self_transfer: 'You cannot send money to yourself.',
      idempotency_conflict: 'This request key was already used for a different transfer. Please start a new transfer.',
      idempotency_in_progress: 'This transfer is still being processed. Please wait a moment and check your history.',
      idempotency_key_expired: 'This transfer request expired. Please start a new transfer.',
      rate_limited: 'Too many requests. Please wait a moment and try again.',
      account_locked: 'Too many failed attempts. Please try again later.',
    }[err.code];
    if (m) return m;
    if (err.code && /^source wallet_(frozen|suspended|closed)$|^source_wallet_/.test(err.code)) return err.message;
    return err.message || 'Something went wrong.';
  };

  /* ==============================================================
     9. LAYOUT (header / nav / footer injected on every page)
     ============================================================== */
  const NAV = [
    ['dashboard.html', 'Dashboard', 'dashboard'], ['wallets.html', 'Wallets', 'wallets'],
    ['send.html', 'Send Money', 'send'], ['transactions.html', 'Transactions', 'transactions'], ['profile.html', 'Profile', 'profile'],
  ];

  const Layout = {
    mount({ authed = true } = {}) {
      const page = document.body.dataset.page;
      const user = Auth.user();
      const links = authed ? [...NAV, ...(Auth.isAdmin() ? [['admin.html', 'Admin', 'admin']] : [])] : [];
      const root = $('#root');
      root.innerHTML = `
        <a class="skip-link" href="#view">Skip to content</a>
        <header class="site-header"><div class="header-inner container">
          <a class="brand" href="${authed ? 'dashboard.html' : 'index.html'}"><span class="brand-mark">P2P</span> Wallet</a>
          ${authed ? `<button class="p2p-menu-btn" id="menuBtn" aria-label="Menu" aria-expanded="false" aria-controls="p2pNav">${icon('menu')}</button>
          <nav class="p2p-nav" id="p2pNav" aria-label="Main">${links.map(([href, label, key]) => `<a class="nav-link ${key === page ? 'active' : ''}" href="${href}" ${key === page ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('')}
            <span class="p2p-user">${esc(user ? user.username : '')}</span><button class="btn btn-ghost btn-sm" id="logoutBtn">Sign out</button></nav>` : ''}
        </div></header>
        <div class="simulated-banner" role="note"><strong>SIMULATION ONLY</strong> — demonstration platform. No real money is moved; balances are simulated.</div>
        <main class="main-content"><div class="container section" id="view" tabindex="-1"></div></main>
        <footer class="site-footer"><div class="container"><p class="text-muted">© ${new Date().getFullYear()} P2P Wallet demo · simulated balances only · not a bank or licensed financial service.</p></div></footer>`;
      if (authed) {
        on($('#logoutBtn'), 'click', () => Auth.logout());
        on($('#menuBtn'), 'click', (e) => { const open = $('#p2pNav').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(open)); });
      }
      return $('#view');
    },
  };

  const pageHead = (title, sub = '') => `<div class="page-heading"><h1>${esc(title)}</h1>${sub ? `<p class="text-muted">${esc(sub)}</p>` : ''}</div>`;

  /* ==============================================================
     10. PAGE: AUTHENTICATION (login / register / forgot) — index.html
     ============================================================== */
  const AuthPage = {
    init() {
      if (Auth.isAuthed()) { location.replace('dashboard.html'); return; }
      const view = Layout.mount({ authed: false });
      const params = new URLSearchParams(location.search);
      const next = params.get('next');
      const safeNext = next && /^[a-z-]+\.html(\?.*)?$/i.test(next) ? next : 'dashboard.html';
      if (params.get('expired')) setTimeout(() => Notify.warning('Your session expired. Please sign in again.'), 100);
      let mode = 'login';

      const render = () => {
        view.innerHTML = `<div class="auth-wrap"><div class="auth-card">
          <div class="tab-row" role="tablist"><button role="tab" class="tab ${mode === 'login' ? 'active' : ''}" data-mode="login" aria-selected="${mode === 'login'}">Sign in</button><button role="tab" class="tab ${mode === 'register' ? 'active' : ''}" data-mode="register" aria-selected="${mode === 'register'}">Create account</button></div>
          <div id="authBody"></div></div></div>`;
        $$('[data-mode]', view).forEach((b) => on(b, 'click', () => { mode = b.dataset.mode; render(); }));
        ({ login, register, forgot })[mode]($('#authBody', view));
      };

      const login = (box) => {
        box.innerHTML = `<h2>Welcome back</h2><form id="f" novalidate>
          <div class="form-group"><label for="identifier">Email or username</label><input id="identifier" name="identifier" autocomplete="username" required maxlength="254"></div>
          ${passwordField('password', 'Password')}
          <div id="formMsg" role="alert"></div>
          <button class="btn btn-primary btn-full" type="submit">Sign in</button>
          <p style="margin-top:1rem"><a href="#" id="forgot">Forgot your password?</a></p></form>`;
        bindPasswordToggles(box);
        on($('#forgot', box), 'click', (e) => { e.preventDefault(); mode = 'forgot'; $$('.tab', view).forEach((t) => t.classList.remove('active')); forgot(box); });
        const form = $('#f', box);
        on(form, 'submit', async (e) => {
          e.preventDefault(); clearErrors(form);
          const identifier = form.identifier.value.trim(); const password = form.password.value;
          if (!identifier) return setFieldError(form, 'identifier', 'Enter your email or username.');
          if (!password) return setFieldError(form, 'password', 'Enter your password.');
          await withBusy($('button[type=submit]', form), async () => {
            try { await Auth.login(identifier, password); location.href = safeNext; }
            catch (err) {
              if (err.code === 'email_not_verified') {
                $('#formMsg', form).innerHTML = `<div class="alert alert-warning">${icon('warn')}<div><p>Please verify your email address before signing in.</p><button type="button" class="btn btn-ghost btn-sm" id="resend">Resend verification email</button></div></div>`;
                on($('#resend', form), 'click', async (ev) => withBusy(ev.currentTarget, async () => { try { await API.resendVerification(identifier.includes('@') ? identifier : ''); Notify.success('If the account needs verification, an email is on its way.'); } catch (e2) { Notify.error(friendlyError(e2)); } }));
              } else { $('#formMsg', form).innerHTML = `<div class="alert alert-danger">${icon('warn')}<div><p>${esc(friendlyError(err))}</p></div></div>`; }
            }
          });
        });
      };

      const register = (box) => {
        box.innerHTML = `<h2>Create your account</h2><form id="f" novalidate>
          <div class="form-group"><label for="full_name">Full name</label><input id="full_name" name="full_name" autocomplete="name" required maxlength="100"></div>
          <div class="form-group"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="30"></div>
          <div class="form-group"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254"></div>
          ${passwordField('password', 'Password', 'password', 'new-password')}
          ${passwordField('confirm_password', 'Confirm password', 'confirm_password', 'new-password')}
          <p class="text-muted" style="font-size:.85rem">At least ${CONFIG.PASSWORD_MIN} characters with upper and lower case, a number and a symbol.</p>
          <div id="formMsg" role="alert"></div>
          <button class="btn btn-primary btn-full" type="submit">Create account</button></form>`;
        bindPasswordToggles(box);
        const form = $('#f', box);
        on(form, 'submit', async (e) => {
          e.preventDefault(); clearErrors(form);
          const d = { full_name: form.full_name.value.trim(), username: form.username.value.trim(), email: form.email.value.trim(), password: form.password.value, confirm_password: form.confirm_password.value };
          let bad = false; const fail = (n, m) => { setFieldError(form, n, m); bad = true; };
          if (d.full_name.length < 2) fail('full_name', 'Enter your full name.');
          if (!V.username(d.username)) fail('username', '3–30 letters, numbers, dots, dashes or underscores.');
          if (!V.email(d.email)) fail('email', 'Enter a valid email address.');
          const pw = V.password(d.password); if (pw) fail('password', pw);
          if (d.password !== d.confirm_password) fail('confirm_password', 'Passwords do not match.');
          if (bad) return;
          await withBusy($('button[type=submit]', form), async () => {
            try {
              await API.register(d);
              box.innerHTML = `<div class="alert alert-success">${icon('check')}<div><div class="alert-title">Check your inbox</div><p>We sent a verification link to ${esc(d.email)}. Open it to activate your account, then sign in. The link expires after a short time.</p></div></div><button class="btn btn-primary" id="toLogin" style="margin-top:1rem">Go to sign in</button>`;
              on($('#toLogin', box), 'click', () => { mode = 'login'; render(); });
            } catch (err) { if (!showServerFieldErrors(form, err)) $('#formMsg', form).innerHTML = `<div class="alert alert-danger">${icon('warn')}<div><p>${esc(friendlyError(err))}</p></div></div>`; }
          });
        });
      };

      const forgot = (box) => {
        box.innerHTML = `<h2>Reset your password</h2><form id="f" novalidate><div class="form-group"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div><button class="btn btn-primary btn-full" type="submit">Send reset link</button><p style="margin-top:1rem"><a href="#" id="back">Back to sign in</a></p></form>`;
        on($('#back', box), 'click', (e) => { e.preventDefault(); mode = 'login'; render(); });
        const form = $('#f', box);
        on(form, 'submit', async (e) => {
          e.preventDefault(); clearErrors(form);
          const email = form.email.value.trim(); if (!V.email(email)) return setFieldError(form, 'email', 'Enter a valid email address.');
          await withBusy($('button[type=submit]', form), async () => {
            try { await API.forgotPassword(email); box.innerHTML = `<div class="alert alert-success">${icon('check')}<div><p>If an eligible account exists, password reset instructions will be sent.</p></div></div>`; }
            catch (err) { Notify.error(friendlyError(err)); }
          });
        });
      };
      render();
    },
  };

  /* ==============================================================
     11. PAGES: VERIFY EMAIL / RESET PASSWORD (links from e-mails)
     ============================================================== */
  const takeToken = () => {
    const token = new URLSearchParams(location.search).get('token') || '';
    // Remove the one-time token from the address bar / history immediately.
    if (token) history.replaceState(null, '', location.pathname);
    return token;
  };

  const VerifyPage = {
    async init() {
      const view = Layout.mount({ authed: false });
      const token = takeToken();
      view.innerHTML = `<div class="auth-wrap"><div class="auth-card" id="box"><div class="spinner"></div><p>Verifying your email…</p></div></div>`;
      const box = $('#box', view);
      if (!token) { box.innerHTML = `<div class="alert alert-danger">${icon('warn')}<div><p>This verification link is missing its token. Open the link from your email again.</p></div></div><a class="btn btn-primary" href="index.html">Back to sign in</a>`; return; }
      try { await API.verifyEmail(token); box.innerHTML = `<div class="alert alert-success">${icon('check')}<div><div class="alert-title">Email verified</div><p>Your account is active. You can sign in now.</p></div></div><a class="btn btn-primary" href="index.html" style="margin-top:1rem">Continue to sign in</a>`; }
      catch (err) { box.innerHTML = `<div class="alert alert-danger">${icon('warn')}<div><div class="alert-title">Verification failed</div><p>${esc(err.message)} The link may have expired or already been used.</p></div></div><a class="btn btn-primary" href="index.html" style="margin-top:1rem">Back to sign in</a>`; }
    },
  };

  const ResetPage = {
    init() {
      const view = Layout.mount({ authed: false });
      const token = takeToken();
      if (!token) { view.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="alert alert-danger">${icon('warn')}<div><p>This reset link is missing its token. Request a new one.</p></div></div><a class="btn btn-primary" href="index.html">Back to sign in</a></div></div>`; return; }
      view.innerHTML = `<div class="auth-wrap"><div class="auth-card"><h2>Choose a new password</h2><form id="f" novalidate>${passwordField('new_password', 'New password', 'new_password', 'new-password')}${passwordField('confirm_password', 'Confirm new password', 'confirm_password', 'new-password')}<div id="formMsg" role="alert"></div><button class="btn btn-primary btn-full" type="submit">Reset password</button></form></div></div>`;
      bindPasswordToggles(view);
      const form = $('#f', view);
      on(form, 'submit', async (e) => {
        e.preventDefault(); clearErrors(form);
        const p = form.new_password.value; const c = form.confirm_password.value;
        const pw = V.password(p); if (pw) return setFieldError(form, 'new_password', pw);
        if (p !== c) return setFieldError(form, 'confirm_password', 'Passwords do not match.');
        await withBusy($('button[type=submit]', form), async () => {
          try { await API.resetPassword({ token, new_password: p, confirm_password: c }); view.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="alert alert-success">${icon('check')}<div><p>Your password has been reset. Sign in with your new password.</p></div></div><a class="btn btn-primary" href="index.html">Sign in</a></div></div>`; }
          catch (err) { if (!showServerFieldErrors(form, err)) $('#formMsg', form).innerHTML = `<div class="alert alert-danger">${icon('warn')}<div><p>${esc(friendlyError(err))}</p></div></div>`; }
        });
      });
    },
  };

  /* ==============================================================
     12. SHARED RENDERERS (wallets / transactions)
     ============================================================== */
  const walletCard = (w) => `<article class="wallet-card ${esc(w.status)}" data-wallet="${esc(w.id)}"><header><span class="wallet-cur">${esc(w.currency)}</span>${statusBadge(w.status)}</header>
    <p class="wallet-label">Available balance</p><p class="wallet-balance">${fmtAmount(w.available_balance)}</p>
    <p class="wallet-sub">Ledger balance: ${fmtAmount(w.ledger_balance)} ${esc(w.currency)}</p><p class="wallet-sub">Wallet no. ${esc(w.wallet_number)}</p></article>`;

  const txnRows = (items) => `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Reference</th><th>Details</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${items.map((t) => {
    const sent = t.direction === 'sent';
    const who = t.counterparty ? `${sent ? 'To' : 'From'} ${esc(t.counterparty.full_name)}` : (t.transaction_type === 'deposit' ? 'Simulated deposit' : titleCase(t.transaction_type));
    return `<tr class="clickable" tabindex="0" data-txn="${esc(t.id)}"><td>${esc(fmtDate(t.created_at))}</td><td><code>${esc(t.reference)}</code></td><td>${who}${t.description ? `<br><small class="text-muted">${esc(t.description)}</small>` : ''}</td><td>${statusBadge(t.status)}</td><td class="num ${sent ? 'amt-out' : 'amt-in'}">${sent ? '−' : '+'}${fmtAmount(t.amount)} ${esc(t.currency)}</td></tr>`;
  }).join('')}</tbody></table></div>`;

  const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

  const showTransaction = async (id, { admin = false } = {}) => {
    const me = Auth.user();
    Modal.open({ title: 'Transaction details', bodyHtml: '<div id="txnBody">' + skeleton(3) + '</div>', footHtml: '<button class="btn btn-ghost" data-m-close>Close</button>',
      onMount: async (bg) => {
        try {
          const t = admin ? await http.get(`/admin/transactions/${id}`) : await API.transaction(id);
          const dir = admin ? '' : (t.sender_user_id === me.id ? 'Sent' : 'Received');
          const party = (u, fallbackId) => (u ? `${esc(u.full_name)} (@${esc(u.username)}) · ${esc(u.account_number)}` : (fallbackId ? (fallbackId === me.id ? 'You' : 'Another user') : '—'));
          $('#txnBody', bg).innerHTML = kv([
            ['Reference', `<code>${esc(t.reference)}</code>`], ['Type', esc(titleCase(t.transaction_type))], ...(dir ? [['Direction', dir]] : []),
            ['Status', statusBadge(t.status)], ['Amount', `<strong>${fmtMoney(t.amount, t.currency)}</strong>`], ['Fee', fmtMoney(t.fee, t.currency)],
            ...(admin ? [['Sender', party(t.sender)], ['Recipient', party(t.recipient)]] : [['Sender', party(null, t.sender_user_id)], ['Recipient', party(null, t.recipient_user_id)]]),
            ['Description', esc(t.description || '—')], ['Created', esc(fmtDate(t.created_at))], ['Completed', esc(fmtDate(t.completed_at))],
          ]) + (t.transaction_type === 'deposit' ? '<p class="text-muted"><strong>SIMULATED DEPOSIT</strong> — no real funds were received.</p>' : '');
        } catch (err) { $('#txnBody', bg).innerHTML = errorState(err); }
      } });
  };
  const bindTxnClicks = (root, opts) => $$('[data-txn]', root).forEach((r) => { const go = () => showTransaction(r.dataset.txn, opts); on(r, 'click', go); on(r, 'keydown', (e) => { if (e.key === 'Enter') go(); }); });

  /* ==============================================================
     13. PAGE: DASHBOARD
     ============================================================== */
  const DashboardPage = {
    async init() {
      if (!Auth.require()) return;
      const view = Layout.mount();
      view.innerHTML = pageHead(`Welcome${Auth.user() ? `, ${Auth.user().full_name.split(' ')[0]}` : ''}`, 'Your simulated wallets and recent activity.') + `
        <section class="dash-grid"><div id="profileBox" class="glass-panel">${skeleton(2)}</div><div id="walletsBox" class="dash-wide">${skeleton(2)}</div></section>
        <section class="glass-panel" style="margin-top:1.5rem"><h3>Quick actions</h3><div class="quick-actions">
          <a class="btn btn-primary" href="send.html">Send money</a><a class="btn btn-ghost" href="wallets.html">View wallets</a><a class="btn btn-ghost" href="transactions.html">Transaction history</a><a class="btn btn-ghost" href="profile.html">Profile settings</a></div></section>
        <section class="glass-panel" style="margin-top:1.5rem"><h3>Recent transactions</h3><div id="recentBox">${skeleton(3)}</div></section>`;
      const load = async () => {
        const [me, wallets, hist] = await Promise.allSettled([Auth.refreshUser(), API.wallets(), API.history({ page: 1, page_size: 5 })]);
        const pb = $('#profileBox', view);
        pb.innerHTML = me.status === 'fulfilled' ? `<h3>Your account</h3>${kv([['Name', esc(me.value.full_name)], ['Username', '@' + esc(me.value.username)], ['Email', esc(me.value.email)],
          ['Account number', `<code>${esc(me.value.account_number)}</code> <button class="btn btn-sm btn-ghost" id="copyAcct" aria-label="Copy account number">Copy</button>`],
          ['Email status', me.value.is_email_verified ? '<span class="badge completed">Verified</span>' : '<span class="badge pending">Not verified</span>']])}` : errorState(me.reason, 'retryAll');
        on($('#copyAcct', pb), 'click', () => copyText(me.value.account_number));
        const wb = $('#walletsBox', view);
        if (wallets.status === 'fulfilled') {
          const list = wallets.value.wallets || [];
          wb.innerHTML = list.length ? `<div class="wallet-grid">${list.map(walletCard).join('')}</div>` : emptyState('No wallets yet', 'Create a wallet to start sending and receiving simulated funds.', '<a class="btn btn-primary" href="wallets.html">Create a wallet</a>');
        } else wb.innerHTML = errorState(wallets.reason, 'retryAll');
        const rb = $('#recentBox', view);
        if (hist.status === 'fulfilled') {
          rb.innerHTML = hist.value.items.length ? txnRows(hist.value.items) + '<p style="margin-top:.8rem"><a href="transactions.html">View all</a></p>' : emptyState('No transactions yet', 'Your transfers and deposits will appear here.');
          bindTxnClicks(rb);
        } else rb.innerHTML = errorState(hist.reason, 'retryAll');
        $$('#retryAll', view).forEach((b) => on(b, 'click', load));
      };
      load();
    },
  };

  /* ==============================================================
     14. PAGE: WALLETS
     ============================================================== */
  const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'SAR']; // must match backend SUPPORTED_CURRENCIES

  const WalletsPage = {
    async init() {
      if (!Auth.require()) return;
      const view = Layout.mount();
      view.innerHTML = pageHead('Wallets', 'One simulated wallet per currency.') + `<div id="list">${skeleton(2)}</div>
        <section class="glass-panel" style="margin-top:1.5rem"><h3>Create a wallet</h3><form id="f" class="inline-form" novalidate><div class="form-group"><label for="currency">Currency</label><select id="currency" name="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></div><button class="btn btn-primary" type="submit">Create wallet</button></form></section>`;
      const list = $('#list', view);
      const load = async () => {
        try {
          const { wallets } = await API.wallets();
          list.innerHTML = wallets.length ? `<div class="wallet-grid">${wallets.map(walletCard).join('')}</div>` : emptyState('No wallets yet', 'Create your first wallet below.');
          $$('[data-wallet]', list).forEach((c) => { c.tabIndex = 0; const open = () => this.details(wallets.find((w) => w.id === c.dataset.wallet)); on(c, 'click', open); on(c, 'keydown', (e) => e.key === 'Enter' && open()); });
        } catch (err) { list.innerHTML = errorState(err, 'retry'); on($('#retry', list), 'click', load); }
      };
      on($('#f', view), 'submit', async (e) => {
        e.preventDefault();
        await withBusy($('button[type=submit]', e.currentTarget), async () => {
          try { await API.createWallet(e.currentTarget.currency.value); Notify.success('Wallet created.'); load(); }
          catch (err) { Notify.error(err.status === 409 ? 'You already have a wallet in that currency.' : friendlyError(err)); }
        });
      });
      load();
    },
    details(w) {
      const usable = w.status === 'active';
      Modal.open({ title: `${w.currency} wallet`, bodyHtml: kv([['Status', statusBadge(w.status)], ['Wallet number', `<code>${esc(w.wallet_number)}</code>`], ['Currency', esc(w.currency)], ['Available balance', fmtMoney(w.available_balance, w.currency)], ['Ledger balance', fmtMoney(w.ledger_balance, w.currency)], ['Created', esc(fmtDate(w.created_at))]])
        + (usable ? '' : `<div class="alert alert-warning">${icon('warn')}<div><p>This wallet is ${esc(w.status)}. Transfers from or to it are blocked. Contact support if you think this is a mistake.</p></div></div>`)
        + '<div id="rec" style="margin-top:1rem"><button class="btn btn-ghost btn-sm" id="recBtn">Check ledger reconciliation</button></div>',
        footHtml: `${usable ? '<a class="btn btn-primary" href="send.html">Send money</a>' : ''}<a class="btn btn-ghost" href="transactions.html">History</a><button class="btn btn-ghost" data-m-close>Close</button>`,
        onMount: (bg) => on($('#recBtn', bg), 'click', async (e) => withBusy(e.currentTarget, async () => {
          try { const r = await API.reconcile(w.id); $('#rec', bg).innerHTML = r.is_reconciled ? `<div class="alert alert-success">${icon('check')}<div><p>Ledger matches the stored balance (${fmtMoney(r.calculated_ledger_balance, r.currency)}).</p></div></div>` : `<div class="alert alert-danger">${icon('warn')}<div><p>Mismatch detected. Stored ${fmtAmount(r.stored_ledger_balance)} vs calculated ${fmtAmount(r.calculated_ledger_balance)}. Please contact an administrator.</p></div></div>`; }
          catch (err) { Notify.error(friendlyError(err)); }
        })) });
    },
  };

  /* ==============================================================
     15. PAGE: SEND MONEY (lookup → amount → confirm → backend result)
     Duplicate-safe: one idempotency key per transfer intent; a timeout
     never triggers an automatic resend — the user decides, and a retry
     re-uses the SAME key so the server can never apply it twice.
     ============================================================== */
  const Pending = {
    read() { try { return JSON.parse(sessionStorage.getItem(CONFIG.PENDING_TRANSFER_KEY)); } catch { return null; } },
    write(v) { try { sessionStorage.setItem(CONFIG.PENDING_TRANSFER_KEY, JSON.stringify(v)); } catch { /* ignore */ } },
    clear() { try { sessionStorage.removeItem(CONFIG.PENDING_TRANSFER_KEY); } catch { /* ignore */ } },
  };

  const SendPage = {
    async init() {
      if (!Auth.require()) return;
      const view = Layout.mount();
      view.innerHTML = pageHead('Send money', 'Transfer simulated funds to another registered user.') + `<div id="body">${skeleton(3)}</div>`;
      let wallets = [];
      try { wallets = (await API.wallets()).wallets; } catch (err) { $('#body', view).innerHTML = errorState(err); return; }
      const active = wallets.filter((w) => w.status === 'active');
      if (!wallets.length) { $('#body', view).innerHTML = emptyState('You need a wallet first', 'Create a wallet before sending money.', '<a class="btn btn-primary" href="wallets.html">Create a wallet</a>'); return; }
      if (!active.length) { $('#body', view).innerHTML = `<div class="alert alert-warning">${icon('warn')}<div><p>None of your wallets can send money right now (frozen, suspended or closed).</p></div></div>`; return; }
      this.form(view, wallets, active);
      const pend = Pending.read();
      if (pend && pend.state === 'uncertain') this.pendingBanner(view, pend);
    },
    pendingBanner(view, pend) {
      const box = document.createElement('div');
      box.className = 'alert alert-warning'; box.setAttribute('role', 'alert');
      box.innerHTML = `${icon('warn')}<div><div class="alert-title">A previous transfer is unconfirmed</div><p>We did not get a response for a transfer of ${esc(fmtAmount(pend.payload.amount))}. It may or may not have gone through. Retrying is safe: it uses the same request key, so it can never be applied twice.</p><button class="btn btn-primary btn-sm" id="retryPending">Retry safely</button> <a class="btn btn-ghost btn-sm" href="transactions.html">Check history</a> <button class="btn btn-ghost btn-sm" id="discardPending">Discard</button></div>`;
      view.insertBefore(box, $('#body', view));
      on($('#discardPending', box), 'click', () => { Pending.clear(); box.remove(); });
      on($('#retryPending', box), 'click', (e) => withBusy(e.currentTarget, async () => { const ok = await this.submit(view, pend.payload, pend.key); if (ok) box.remove(); }));
    },
    form(view, wallets, active) {
      const body = $('#body', view);
      const state = { recipient: null, verifiedFor: '' };
      body.innerHTML = `<form id="f" class="glass-panel send-form" novalidate>
        <div class="form-group"><label for="source">From wallet</label><select id="source" name="source">${active.map((w) => `<option value="${esc(w.id)}">${esc(w.currency)} · available ${esc(fmtAmount(w.available_balance))}</option>`).join('')}</select></div>
        <div class="form-group"><label for="account">Recipient account number</label><div class="inline-form"><input id="account" name="account" inputmode="numeric" autocomplete="off" maxlength="20" required><button type="button" class="btn btn-ghost" id="lookupBtn">Verify recipient</button></div></div>
        <div id="recipientBox" aria-live="polite"></div>
        <div class="form-group"><label for="amount">Amount</label><input id="amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" required></div>
        <div class="form-group"><label for="description">Description (optional)</label><input id="description" name="description" maxlength="250"></div>
        <button class="btn btn-primary btn-full" type="submit" id="reviewBtn">Review transfer</button></form>`;
      const form = $('#f', body);
      const doLookup = async () => {
        const acct = form.account.value.trim(); clearErrors(form); state.recipient = null;
        if (!V.account(acct)) { setFieldError(form, 'account', 'Enter the 8–20 digit account number.'); return false; }
        const box = $('#recipientBox', body); box.innerHTML = '<div class="spinner spinner-sm"></div>';
        try {
          const u = await API.lookup(acct); state.recipient = u; state.verifiedFor = acct;
          box.innerHTML = `<div class="alert alert-success">${icon('check')}<div><div class="alert-title">${esc(u.full_name)}</div><p>@${esc(u.username)} · account ${esc(u.account_number)}</p></div></div>`;
          return true;
        } catch (err) { box.innerHTML = `<div class="alert alert-danger">${icon('warn')}<div><p>${esc(friendlyError(err))}</p></div></div>`; return false; }
      };
      on($('#lookupBtn', body), 'click', (e) => withBusy(e.currentTarget, doLookup));
      on(form.account, 'input', () => { if (form.account.value.trim() !== state.verifiedFor) { state.recipient = null; $('#recipientBox', body).innerHTML = ''; } });
      on(form, 'submit', async (e) => {
        e.preventDefault(); clearErrors(form);
        const wallet = active.find((w) => w.id === form.source.value);
        const acct = form.account.value.trim(); const amount = form.amount.value.trim().replace(/,/g, '');
        if (!V.account(acct)) return setFieldError(form, 'account', 'Enter the 8–20 digit account number.');
        if (!V.amount(amount)) return setFieldError(form, 'amount', 'Enter a positive amount (up to 8 decimal places).');
        if (cmpDecimal(amount, wallet.available_balance) > 0) return setFieldError(form, 'amount', 'This is more than your available balance.');
        const ok = await withBusy($('#reviewBtn', form), async () => (state.recipient && state.verifiedFor === acct) || doLookup());
        if (!ok) return;
        const payload = { source_wallet_id: wallet.id, recipient_account_number: acct, amount, description: form.description.value.trim() || null };
        const confirmed = await Modal.open({ title: 'Confirm transfer', dismissible: true,
          bodyHtml: `<p class="text-muted"><strong>Simulated transfer</strong> — no real money moves.</p>${kv([['From', `${esc(wallet.currency)} wallet`], ['To', `${esc(state.recipient.full_name)} (@${esc(state.recipient.username)})`], ['Account', esc(acct)], ['Amount', `<strong>${fmtMoney(amount, wallet.currency)}</strong>`], ['Description', esc(payload.description || '—')]])}`,
          footHtml: '<button class="btn btn-ghost" data-m-value="no">Back</button><button class="btn btn-primary" data-m-value="yes">Send now</button>' });
        if (confirmed !== 'yes') return;
        // Same intent (identical payload) => same key. Changed payload => new key.
        const fp = JSON.stringify(payload); const prev = Pending.read();
        const key = prev && JSON.stringify(prev.payload) === fp ? prev.key : newKey();
        await withBusy($('#reviewBtn', form), () => this.submit(view, payload, key, wallet));
      });
    },
    /** Returns true when the backend confirmed the transfer. */
    async submit(view, payload, key, wallet) {
      Pending.write({ key, payload, state: 'submitting' });
      try {
        const res = await API.transfer({ ...payload, idempotency_key: key });
        Pending.clear();
        const t = res.transaction; const replay = res.__headers && res.__headers.get('Idempotent-Replayed') === 'true';
        $('#body', view).innerHTML = `<div class="glass-panel"><div class="alert alert-success" role="status">${icon('check')}<div><div class="alert-title">${replay ? 'Transfer already completed' : 'Transfer completed'}</div><p>${esc(res.message)}</p></div></div>${kv([['Reference', `<code>${esc(t.reference)}</code>`], ['Status', statusBadge(t.status)], ['Amount', `<strong>${fmtMoney(t.amount, t.currency)}</strong>`], ['Completed', esc(fmtDate(t.completed_at || t.created_at))]])}
          <div class="quick-actions"><a class="btn btn-primary" href="send.html">New transfer</a><a class="btn btn-ghost" href="transactions.html">View history</a><a class="btn btn-ghost" href="dashboard.html">Dashboard</a></div></div>`;
        Notify.success('Simulated transfer completed.');
        return true;
      } catch (err) {
        if (err.uncertain || err.code === 'network' || err.code === 'timeout') {
          Pending.write({ key, payload, state: 'uncertain' });
          Modal.open({ title: 'Transfer not confirmed', bodyHtml: `<div class="alert alert-warning">${icon('warn')}<div><p>We could not confirm whether this transfer went through (${esc(err.message)}). <strong>Please do not start a new transfer.</strong> Check your transaction history, or retry safely — the retry cannot create a duplicate.</p></div></div>`, footHtml: '<a class="btn btn-ghost" href="transactions.html">Check history</a><button class="btn btn-primary" data-m-close>OK</button>' });
          if (!$('#retryPending', view)) this.pendingBanner(view, Pending.read());
        } else {
          Pending.clear();
          if (err.status === 401) Notify.error('Your session expired. Please sign in again.');
          else Notify.error(friendlyError(err));
        }
        return false;
      }
    },
  };

  /* ==============================================================
     16. PAGE: TRANSACTIONS (history, filters, pagination, details)
     ============================================================== */
  const TXN_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed'];
  const TXN_TYPES = ['p2p_transfer', 'deposit', 'withdrawal', 'refund'];

  const filterBar = (extra = '') => `<form id="filters" class="filters glass-panel" novalidate>
    <div class="form-group"><label for="f-ref">Reference</label><input id="f-ref" name="reference" maxlength="100"></div>
    <div class="form-group"><label for="f-status">Status</label><select id="f-status" name="status"><option value="">All</option>${TXN_STATUSES.map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('')}</select></div>
    <div class="form-group"><label for="f-type">Type</label><select id="f-type" name="transaction_type"><option value="">All</option>${TXN_TYPES.map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('')}</select></div>
    <div class="form-group"><label for="f-cur">Currency</label><select id="f-cur" name="currency"><option value="">All</option>${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></div>
    <div class="form-group"><label for="f-from">From date</label><input id="f-from" name="start" type="date"></div>
    <div class="form-group"><label for="f-to">To date</label><input id="f-to" name="end" type="date"></div>${extra}
    <div class="filter-actions"><button class="btn btn-primary btn-sm" type="submit">Apply</button><button class="btn btn-ghost btn-sm" type="reset" id="resetF">Reset</button></div></form>`;

  const readFilters = (form) => ({
    reference: form.reference.value.trim(), status: form.status.value, transaction_type: form.transaction_type.value, currency: form.currency.value,
    start_date: form.start.value ? new Date(`${form.start.value}T00:00:00`).toISOString() : '',
    end_date: form.end.value ? new Date(`${form.end.value}T23:59:59`).toISOString() : '',
  });

  const TransactionsPage = {
    init() {
      if (!Auth.require()) return;
      const view = Layout.mount();
      view.innerHTML = pageHead('Transactions', 'Your sent and received transfers.') + filterBar() + '<div id="results" class="glass-panel" style="margin-top:1rem"></div>';
      const results = $('#results', view); const form = $('#filters', view);
      let page = 1;
      const load = async () => {
        results.innerHTML = skeleton(4);
        const f = readFilters(form);
        if (f.start_date && f.end_date && f.start_date > f.end_date) { results.innerHTML = `<div class="alert alert-danger"><p>The start date must be before the end date.</p></div>`; return; }
        try {
          const data = await API.history({ ...f, page, page_size: CONFIG.DEFAULT_PAGE_SIZE });
          results.innerHTML = data.items.length ? txnRows(data.items) + pager(data) : emptyState('No transactions found', 'Try changing or clearing the filters.');
          bindTxnClicks(results); bindPager(results, (p) => { page = p; load(); });
        } catch (err) { results.innerHTML = errorState(err, 'retry'); on($('#retry', results), 'click', load); }
      };
      on(form, 'submit', (e) => { e.preventDefault(); page = 1; load(); });
      on(form, 'reset', () => setTimeout(() => { page = 1; load(); }, 0));
      load();
    },
  };

  /* ==============================================================
     17. PAGE: PROFILE (details, change password, sessions)
     ============================================================== */
  const ProfilePage = {
    async init() {
      if (!Auth.require()) return;
      const view = Layout.mount();
      view.innerHTML = pageHead('Profile & security') + `<div class="dash-grid"><section class="glass-panel" id="profile">${skeleton(3)}</section><section class="glass-panel" id="security"></section></div>`;
      const renderProfile = (u) => {
        const box = $('#profile', view);
        box.innerHTML = `<h3>Profile</h3>${kv([['Email', esc(u.email)], ['Account number', `<code>${esc(u.account_number)}</code>`], ['Email status', u.is_email_verified ? '<span class="badge completed">Verified</span>' : '<span class="badge pending">Not verified</span>'], ['Role', esc(titleCase(u.role))], ['Member since', esc(fmtDate(u.created_at))]])}
          <form id="pf" novalidate style="margin-top:1rem"><div class="form-group"><label for="full_name">Full name</label><input id="full_name" name="full_name" value="${esc(u.full_name)}" maxlength="100"></div><div class="form-group"><label for="username">Username</label><input id="username" name="username" value="${esc(u.username)}" maxlength="30"></div><button class="btn btn-primary" type="submit">Save changes</button></form>`;
        const form = $('#pf', box);
        on(form, 'submit', async (e) => {
          e.preventDefault(); clearErrors(form);
          const d = {}; if (form.full_name.value.trim() !== u.full_name) d.full_name = form.full_name.value.trim(); if (form.username.value.trim().toLowerCase() !== u.username) d.username = form.username.value.trim();
          if (!Object.keys(d).length) return Notify.info('Nothing to update.');
          if (d.username && !V.username(d.username)) return setFieldError(form, 'username', '3–30 letters, numbers, dots, dashes or underscores.');
          await withBusy($('button[type=submit]', form), async () => { try { const nu = await API.updateMe(d); const s = Session.read(); Session.write({ ...s, user: nu }); Notify.success('Profile updated.'); renderProfile(nu); } catch (err) { if (!showServerFieldErrors(form, err)) Notify.error(friendlyError(err)); } });
        });
      };
      try { renderProfile(await Auth.refreshUser()); } catch (err) { $('#profile', view).innerHTML = errorState(err); }
      const sec = $('#security', view);
      sec.innerHTML = `<h3>Change password</h3><form id="cp" novalidate>${passwordField('current_password', 'Current password')}${passwordField('new_password', 'New password', 'new_password', 'new-password')}${passwordField('confirm_password', 'Confirm new password', 'confirm_password', 'new-password')}<button class="btn btn-primary" type="submit">Change password</button></form>
        <hr><h3>Sessions</h3><p class="text-muted">Sign out of every device (all refresh tokens are revoked).</p><button class="btn btn-ghost" id="logoutAll">Sign out everywhere</button>`;
      bindPasswordToggles(sec);
      const form = $('#cp', sec);
      on(form, 'submit', async (e) => {
        e.preventDefault(); clearErrors(form);
        const cur = form.current_password.value; const np = form.new_password.value; const cf = form.confirm_password.value;
        if (!cur) return setFieldError(form, 'current_password', 'Enter your current password.');
        const pw = V.password(np); if (pw) return setFieldError(form, 'new_password', pw);
        if (np !== cf) return setFieldError(form, 'confirm_password', 'Passwords do not match.');
        await withBusy($('button[type=submit]', form), async () => {
          try { await API.changePassword({ current_password: cur, new_password: np, confirm_password: cf }); Notify.success('Password changed. Please sign in again.'); setTimeout(() => { Session.clear(); location.href = 'index.html'; }, 1200); }
          catch (err) { if (!showServerFieldErrors(form, err)) Notify.error(friendlyError(err)); }
        });
      });
      on($('#logoutAll', sec), 'click', async (e) => { if (!(await Modal.confirm({ title: 'Sign out everywhere?', message: 'All your sessions, including this one, will end.', confirmLabel: 'Sign out everywhere' }))) return; await withBusy(e.currentTarget, async () => { try { await http.post('/auth/logout-all'); } catch { /* cleared locally regardless */ } Session.clear(); location.href = 'index.html'; }); });
    },
  };

  /* ==============================================================
     18. PAGE: ADMIN (presentation only — the backend enforces roles)
     Tabs: Overview · Users · Wallets · Transactions ·
           Simulated deposit (super admin) · Audit log (super admin)
     ============================================================== */
  const USER_STATUSES = ['active', 'pending_verification', 'suspended', 'blocked', 'deactivated'];
  const AUDIT_ACTIONS = ['user_created', 'user_updated', 'user_suspended', 'user_unsuspended', 'user_role_changed', 'wallet_created', 'wallet_frozen', 'wallet_unfrozen', 'wallet_suspended', 'wallet_reactivated', 'wallet_closed', 'simulated_deposit', 'login', 'login_failed', 'logout', 'password_changed', 'password_reset', 'email_verified', 'admin_action'];

  const AdminPage = {
    init() {
      if (!Auth.require({ admin: true })) return;
      const view = Layout.mount();
      const sup = Auth.isSuperAdmin();
      const tabs = [['overview', 'Overview'], ['users', 'Users'], ['wallets', 'Wallets'], ['transactions', 'Transactions'], ...(sup ? [['deposit', 'Simulated deposit'], ['audit', 'Audit log']] : [])];
      view.innerHTML = pageHead('Administration', sup ? 'Super administrator' : 'Administrator') + `<div class="tab-row" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}">${esc(l)}</button>`).join('')}</div><div id="panel" class="admin-panel"></div>`;
      const panel = $('#panel', view);
      const show = (key) => {
        $$('[data-tab]', view).forEach((t) => { const a = t.dataset.tab === key; t.classList.toggle('active', a); t.setAttribute('aria-selected', String(a)); });
        history.replaceState(null, '', `#${key}`);
        ({ overview: this.overview, users: this.users, wallets: this.wallets, transactions: this.transactions, deposit: this.deposit, audit: this.audit })[key].call(this, panel);
      };
      $$('[data-tab]', view).forEach((t) => on(t, 'click', () => show(t.dataset.tab)));
      const start = location.hash.slice(1); show(tabs.some(([k]) => k === start) ? start : 'overview');
    },

    async overview(panel) {
      panel.innerHTML = skeleton(3);
      try {
        const o = await API.admin.overview();
        const group = (title, total, map) => `<div class="stat-card"><p class="stat-label">${esc(title)}</p><p class="stat-value">${total}</p><ul class="stat-list">${Object.entries(map).map(([k, v]) => `<li><span>${esc(titleCase(k))}</span><strong>${v}</strong></li>`).join('') || '<li class="text-muted">No records</li>'}</ul></div>`;
        panel.innerHTML = `<div class="stat-grid">${group('Users', o.users_total, o.users_by_status)}${group('User roles', o.users_total, o.users_by_role)}${group('Wallets', o.wallets_total, o.wallets_by_status)}${group('Transactions', o.transactions_total, o.transactions_by_status)}${group('Transaction types', o.transactions_total, o.transactions_by_type)}</div><p class="text-muted">Counts from the database as of ${esc(fmtDate(o.generated_at))}. No monetary totals are calculated here.</p>`;
      } catch (err) { panel.innerHTML = errorState(err, 'retry'); on($('#retry', panel), 'click', () => this.overview(panel)); }
    },

    users(panel) {
      panel.innerHTML = `<form id="uf" class="filters glass-panel" novalidate><div class="form-group"><label for="u-q">Search</label><input id="u-q" name="search" placeholder="Name, email, username or account no." maxlength="100"></div>
        <div class="form-group"><label for="u-s">Status</label><select id="u-s" name="status"><option value="">All</option>${USER_STATUSES.map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('')}</select></div>
        <div class="form-group"><label for="u-r">Role</label><select id="u-r" name="role"><option value="">All</option><option value="user">User</option><option value="admin">Admin</option><option value="super_admin">Super admin</option></select></div>
        <div class="filter-actions"><button class="btn btn-primary btn-sm" type="submit">Search</button><button class="btn btn-ghost btn-sm" type="reset">Reset</button></div></form><div id="res" class="glass-panel" style="margin-top:1rem"></div>`;
      const form = $('#uf', panel); const res = $('#res', panel); let page = 1;
      const load = async () => {
        res.innerHTML = skeleton(4);
        try {
          const d = await API.admin.users({ page, page_size: CONFIG.DEFAULT_PAGE_SIZE, search: form.search.value.trim(), status: form.status.value, role: form.role.value });
          res.innerHTML = d.items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Account no.</th><th>Role</th><th>Status</th><th>Email</th><th>Joined</th><th></th></tr></thead><tbody>${d.items.map((u) => `<tr><td>${esc(u.full_name)}<br><small class="text-muted">@${esc(u.username)} · ${esc(u.email)}</small></td><td><code>${esc(u.account_number)}</code></td><td>${esc(titleCase(u.role))}</td><td>${statusBadge(u.status)}</td><td>${u.is_email_verified ? '<span class="badge completed">Verified</span>' : '<span class="badge pending">Unverified</span>'}</td><td>${esc(fmtDate(u.created_at))}</td><td><button class="btn btn-ghost btn-sm" data-user="${esc(u.id)}">Manage</button></td></tr>`).join('')}</tbody></table></div>${pager(d)}` : emptyState('No users found', 'Try a different search.');
          bindPager(res, (p) => { page = p; load(); });
          $$('[data-user]', res).forEach((b) => on(b, 'click', () => this.manageUser(d.items.find((u) => u.id === b.dataset.user), load)));
        } catch (err) { res.innerHTML = errorState(err, 'retry'); on($('#retry', res), 'click', load); }
      };
      on(form, 'submit', (e) => { e.preventDefault(); page = 1; load(); });
      on(form, 'reset', () => setTimeout(() => { page = 1; load(); }, 0));
      load();
    },

    async manageUser(u, reload) {
      const me = Auth.user(); const sup = Auth.isSuperAdmin();
      const self = u.id === me.id; const targetIsAdmin = u.role !== 'user';
      const locked = self || (targetIsAdmin && !sup);
      await Modal.open({
        title: `Manage ${u.username}`,
        bodyHtml: `${kv([['Name', esc(u.full_name)], ['Email', esc(u.email)], ['Account no.', esc(u.account_number)], ['Verified', u.is_email_verified ? 'Yes' : 'No']])}
          ${locked ? `<div class="alert alert-info">${icon('info')}<div><p>${self ? 'You cannot change your own administrative account.' : 'Only a super administrator can modify another administrator.'}</p></div></div>`
          : `<div class="form-group"><label for="mu-s">Status</label><select id="mu-s">${USER_STATUSES.map((s) => `<option value="${s}" ${s === u.status ? 'selected' : ''}>${titleCase(s)}</option>`).join('')}</select></div>
          ${sup ? `<div class="form-group"><label for="mu-r">Role</label><select id="mu-r">${['user', 'admin', 'super_admin'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${titleCase(r)}</option>`).join('')}</select></div>` : `<p class="text-muted">Role: ${esc(titleCase(u.role))} (only a super administrator can change roles)</p>`}`}`,
        footHtml: `<button class="btn btn-ghost" data-m-close>Close</button>${locked ? '' : '<button class="btn btn-primary" id="mu-save">Save changes</button>'}`,
        onMount: (bg, entry) => {
          const save = $('#mu-save', bg); if (!save) return;
          on(save, 'click', async () => {
            const d = {}; const status = $('#mu-s', bg).value; const roleEl = $('#mu-r', bg); const role = roleEl ? roleEl.value : u.role;
            if (status !== u.status) d.status = status; if (role !== u.role) d.role = role;
            if (!Object.keys(d).length) return Notify.info('No changes to save.');
            const summary = Object.entries(d).map(([k, v]) => `${k} → ${titleCase(v)}`).join(', ');
            const ok = await Modal.confirm({ title: 'Confirm account change', message: `Apply ${summary} to ${u.full_name} (@${u.username})? This is recorded in the audit log.`, confirmLabel: 'Apply', danger: !!d.status && d.status !== 'active' });
            if (!ok) return;
            await withBusy(save, async () => {
              try { await API.admin.updateUser(u.id, d); Notify.success('User updated.'); entry.close('saved'); reload(); }
              catch (err) { Notify.error(friendlyError(err)); }
            });
          });
        },
      });
    },

    wallets(panel) {
      const sup = Auth.isSuperAdmin();
      panel.innerHTML = `<form id="wf" class="filters glass-panel" novalidate><div class="form-group"><label for="w-s">Status</label><select id="w-s" name="status"><option value="">All</option>${WALLET_STATUS.map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('')}</select></div>
        <div class="form-group"><label for="w-c">Currency</label><select id="w-c" name="currency"><option value="">All</option>${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></div>
        <div class="filter-actions"><button class="btn btn-primary btn-sm" type="submit">Apply</button><button class="btn btn-ghost btn-sm" type="reset">Reset</button></div></form><div id="res" class="glass-panel" style="margin-top:1rem"></div>`;
      const form = $('#wf', panel); const res = $('#res', panel); let page = 1;
      const load = async () => {
        res.innerHTML = skeleton(4);
        try {
          const d = await API.admin.wallets({ page, page_size: CONFIG.DEFAULT_PAGE_SIZE, status: form.status.value, currency: form.currency.value });
          res.innerHTML = d.items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Owner</th><th>Wallet</th><th>Status</th><th class="num">Available</th><th class="num">Ledger</th><th>Actions</th></tr></thead><tbody>${d.items.map((w) => {
            const a = []; const b = (act, label, cls = 'btn-ghost') => a.push(`<button class="btn ${cls} btn-sm" data-act="${act}" data-id="${esc(w.id)}">${label}</button>`);
            if (w.status === 'active') { b('freeze', 'Freeze'); b('suspend', 'Suspend'); }
            if (w.status === 'frozen' || w.status === 'suspended') b('reactivate', w.status === 'frozen' ? 'Unfreeze' : 'Reactivate');
            if (w.status === 'frozen') b('suspend', 'Suspend');
            if (sup && w.status !== 'closed') b('close', 'Close', 'btn-danger');
            b('reconcile', 'Reconcile');
            return `<tr><td>${esc(w.owner_full_name)}<br><small class="text-muted">@${esc(w.owner_username)} · ${esc(w.owner_account_number)}</small></td><td>${esc(w.currency)}<br><small class="text-muted">${esc(w.wallet_number)}</small></td><td>${statusBadge(w.status)}</td><td class="num">${fmtAmount(w.available_balance)}</td><td class="num">${fmtAmount(w.ledger_balance)}</td><td class="actions">${a.join(' ')}</td></tr>`;
          }).join('')}</tbody></table></div>${pager(d)}` : emptyState('No wallets found', 'Try a different filter.');
          bindPager(res, (p) => { page = p; load(); });
          $$('[data-act]', res).forEach((btn) => on(btn, 'click', () => this.walletAction(btn, load)));
        } catch (err) { res.innerHTML = errorState(err, 'retry'); on($('#retry', res), 'click', load); }
      };
      on(form, 'submit', (e) => { e.preventDefault(); page = 1; load(); });
      on(form, 'reset', () => setTimeout(() => { page = 1; load(); }, 0));
      load();
    },

    async walletAction(btn, reload) {
      const { act, id } = btn.dataset;
      try {
        if (act === 'reconcile') {
          const r = await API.admin.reconcile(id);
          return Modal.open({ title: 'Ledger reconciliation', bodyHtml: `${kv([['Stored ledger balance', fmtMoney(r.stored_ledger_balance, r.currency)], ['Calculated from ledger entries', fmtMoney(r.calculated_ledger_balance, r.currency)], ['Result', r.is_reconciled ? '<span class="badge completed">Reconciled</span>' : '<span class="badge failed">MISMATCH</span>']])}`, footHtml: '<button class="btn btn-ghost" data-m-close>Close</button>' });
        }
        let body;
        if (act === 'freeze' || act === 'suspend') {
          const reason = await Modal.reason({ title: `${titleCase(act)} wallet`, message: `This blocks all transfers from and to the wallet. The reason is written to the audit log.`, confirmLabel: titleCase(act) });
          if (!reason) return; body = { reason };
        } else {
          const ok = await Modal.confirm({ title: `${act === 'close' ? 'Close' : act === 'reactivate' ? 'Reactivate' : 'Unfreeze'} wallet?`, message: act === 'close' ? 'Closing is permanent and only possible with a zero balance.' : 'The wallet will return to active service.', confirmLabel: act === 'close' ? 'Close wallet' : 'Confirm', danger: act === 'close' });
          if (!ok) return;
        }
        await withBusy(btn, () => API.admin.walletAction(id, act === 'unfreeze' ? 'reactivate' : act, body));
        Notify.success('Wallet updated.'); reload();
      } catch (err) { Notify.error(friendlyError(err)); }
    },

    transactions(panel) {
      panel.innerHTML = filterBar() + '<div id="res" class="glass-panel" style="margin-top:1rem"></div>';
      const form = $('#filters', panel); const res = $('#res', panel); let page = 1;
      const load = async () => {
        res.innerHTML = skeleton(4);
        try {
          const d = await API.admin.transactions({ ...readFilters(form), page, page_size: CONFIG.DEFAULT_PAGE_SIZE });
          res.innerHTML = d.items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Reference</th><th>Sender</th><th>Recipient</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${d.items.map((t) => `<tr class="clickable" tabindex="0" data-txn="${esc(t.id)}"><td>${esc(fmtDate(t.created_at))}</td><td><code>${esc(t.reference)}</code><br><small class="text-muted">${esc(titleCase(t.transaction_type))}</small></td><td>${t.sender ? `${esc(t.sender.full_name)}<br><small class="text-muted">${esc(t.sender.account_number)}</small>` : '—'}</td><td>${t.recipient ? `${esc(t.recipient.full_name)}<br><small class="text-muted">${esc(t.recipient.account_number)}</small>` : '—'}</td><td>${statusBadge(t.status)}</td><td class="num">${fmtAmount(t.amount)} ${esc(t.currency)}</td></tr>`).join('')}</tbody></table></div>${pager(d)}` : emptyState('No transactions found', 'Try a different filter.');
          bindTxnClicks(res, { admin: true }); bindPager(res, (p) => { page = p; load(); });
        } catch (err) { res.innerHTML = errorState(err, 'retry'); on($('#retry', res), 'click', load); }
      };
      on(form, 'submit', (e) => { e.preventDefault(); page = 1; load(); });
      on(form, 'reset', () => setTimeout(() => { page = 1; load(); }, 0));
      load();
    },

    deposit(panel) {
      panel.innerHTML = `<div class="alert alert-warning">${icon('warn')}<div><div class="alert-title">SIMULATED DEPOSIT</div><p>Credits a user's wallet with simulated funds in the internal ledger. It is <strong>not</strong> a bank deposit and no real money is involved.</p></div></div>
        <form id="df" class="glass-panel send-form" novalidate style="margin-top:1rem"><div class="form-group"><label for="d-acct">Recipient account number</label><div class="inline-form"><input id="d-acct" name="account" inputmode="numeric" maxlength="20" autocomplete="off" required><button type="button" class="btn btn-ghost" id="dLookup">Identify recipient</button></div></div><div id="dRecipient" aria-live="polite"></div>
        <div class="form-group"><label for="d-cur">Destination wallet currency</label><select id="d-cur" name="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></div>
        <div class="form-group"><label for="d-amt">Simulated amount</label><input id="d-amt" name="amount" inputmode="decimal" placeholder="0.00" autocomplete="off" required></div>
        <div class="form-group"><label for="d-desc">Description (optional)</label><input id="d-desc" name="description" maxlength="250"></div>
        <button class="btn btn-primary btn-full" type="submit">Review simulated deposit</button></form><div id="dResult"></div>`;
      const form = $('#df', panel); let recipient = null; let verifiedFor = ''; let pending = null;
      const lookup = async () => {
        const acct = form.account.value.trim(); clearErrors(form); recipient = null;
        if (!V.account(acct)) { setFieldError(form, 'account', 'Enter the 8–20 digit account number.'); return false; }
        try { recipient = await API.lookup(acct); verifiedFor = acct; $('#dRecipient', panel).innerHTML = `<div class="alert alert-success">${icon('check')}<div><div class="alert-title">${esc(recipient.full_name)}</div><p>@${esc(recipient.username)} · ${esc(recipient.account_number)}</p></div></div>`; return true; }
        catch (err) { $('#dRecipient', panel).innerHTML = `<div class="alert alert-danger">${icon('warn')}<div><p>${esc(friendlyError(err))}</p></div></div>`; return false; }
      };
      on($('#dLookup', panel), 'click', (e) => withBusy(e.currentTarget, lookup));
      on(form.account, 'input', () => { if (form.account.value.trim() !== verifiedFor) { recipient = null; $('#dRecipient', panel).innerHTML = ''; } });
      on(form, 'submit', async (e) => {
        e.preventDefault(); clearErrors(form);
        const acct = form.account.value.trim(); const amount = form.amount.value.trim().replace(/,/g, '');
        if (!V.amount(amount)) return setFieldError(form, 'amount', 'Enter a positive amount (up to 8 decimal places).');
        if (!((recipient && verifiedFor === acct) || (await lookup()))) return;
        const payload = { recipient_account_number: acct, amount, currency: form.currency.value, description: form.description.value.trim() || 'Administrative simulated deposit' };
        const go = await Modal.confirm({ title: 'Confirm SIMULATED deposit', message: `Credit ${fmtAmount(amount)} ${payload.currency} (simulated) to ${recipient.full_name} (${acct})?`, confirmLabel: 'Create simulated deposit' });
        if (!go) return;
        const fp = JSON.stringify(payload); const key = pending && pending.fp === fp ? pending.key : newKey(); pending = { fp, key };
        await withBusy($('button[type=submit]', form), async () => {
          try {
            const t = await API.admin.deposit({ ...payload, idempotency_key: key }); pending = null;
            $('#dResult', panel).innerHTML = `<div class="alert alert-success" role="status">${icon('check')}<div><div class="alert-title">SIMULATED DEPOSIT completed</div><p>Reference <code>${esc(t.reference)}</code> · ${fmtMoney(t.amount, t.currency)} · status ${esc(t.status)}</p></div></div>`;
            Notify.success('Simulated deposit completed.');
          } catch (err) {
            if (err.uncertain) Notify.warning('Result unconfirmed. Submit again to retry safely (same request key), or check the transaction list.');
            else { pending = null; Notify.error(friendlyError(err)); }
          }
        });
      });
    },

    audit(panel) {
      panel.innerHTML = `<form id="af" class="filters glass-panel" novalidate><div class="form-group"><label for="a-a">Action</label><select id="a-a" name="action"><option value="">All</option>${AUDIT_ACTIONS.map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('')}</select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" type="submit">Apply</button></div></form><div id="res" class="glass-panel" style="margin-top:1rem"></div>`;
      const form = $('#af', panel); const res = $('#res', panel); let page = 1;
      const load = async () => {
        res.innerHTML = skeleton(4);
        try {
          const d = await API.admin.audit({ page, page_size: 15, action: form.action.value });
          res.innerHTML = d.items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>When</th><th>Action</th><th>Administrator</th><th>Target</th><th>Description</th><th>Request</th></tr></thead><tbody>${d.items.map((l) => `<tr><td>${esc(fmtDate(l.created_at))}</td><td>${esc(titleCase(l.action))}</td><td>${esc(l.actor_username || 'system / user')}</td><td>${esc(l.target_type || '—')}${l.target_id ? `<br><small class="text-muted">${esc(l.target_id)}</small>` : ''}</td><td>${esc(l.description)}${l.metadata ? `<br><small class="text-muted">${esc(JSON.stringify(l.metadata))}</small>` : ''}</td><td><small class="text-muted">${esc(l.ip_address || '—')}</small></td></tr>`).join('')}</tbody></table></div>${pager(d)}` : emptyState('No audit records', 'Nothing matches this filter.');
          bindPager(res, (p) => { page = p; load(); });
        } catch (err) { res.innerHTML = errorState(err, 'retry'); on($('#retry', res), 'click', load); }
      };
      on(form, 'submit', (e) => { e.preventDefault(); page = 1; load(); });
      load();
    },
  };

  /* ==============================================================
     19. BOOTSTRAP
     ============================================================== */
  const PAGES = { auth: AuthPage, verify: VerifyPage, reset: ResetPage, dashboard: DashboardPage, wallets: WalletsPage, send: SendPage, transactions: TransactionsPage, profile: ProfilePage, admin: AdminPage };

  document.addEventListener('DOMContentLoaded', () => {
    const page = PAGES[document.body.dataset.page];
    if (page) page.init();
    // Expose a tiny, side-effect-free surface for debugging/tests.
    window.P2P = Object.freeze({ fmtAmount, cmpDecimal, V, esc });
  });
})();
