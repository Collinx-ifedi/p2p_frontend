/* Single place to configure the backend. Edit API_BASE for each deployment.
   Must include the API prefix (backend API_V1_PREFIX, default /api/v1).
   Use https:// in production. */
window.P2P_CONFIG = {
  API_BASE: /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'http://localhost:8000/api/v1'
    : 'https://YOUR-API-HOST.example.com/api/v1',
};
