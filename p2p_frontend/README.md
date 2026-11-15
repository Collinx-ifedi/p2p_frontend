# P2P Wallet frontend (simulation only)

Vanilla JS + the existing RTR `client.css` design system (unchanged). No build step.

* `js/config.js` – **the single place to set the API URL** (`API_BASE`, including `/api/v1`).
* `js/p2p.js` – the whole client (API client, session, notifications, modal, pages).
* `css/client.css` – your original stylesheet, untouched. `css/p2p.css` – additive styles only.

Run locally (backend on :8000, `FRONTEND_URL`/`CORS_ORIGINS` include http://localhost:5500):

    cd frontend && python3 -m http.server 5500      # then open http://localhost:5500

Static hosting must serve the `.html` files as-is (e-mail links point at `verify-email.html` and
`reset-password.html`; paths are configurable with FRONTEND_VERIFY_EMAIL_PATH / FRONTEND_RESET_PASSWORD_PATH).
Set a `Content-Security-Policy` / HTTPS at the host; the meta CSP in each page is a baseline —
edit `connect-src` to your real API origin.

Tests: `node tests/pure_logic.test.js` (money formatting/comparison, validators, HTML escaping).
