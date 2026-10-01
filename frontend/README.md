# Frontend

Vanilla HTML5 + CSS3 + ES6 modules. No framework, no bundler, no build step.

```
frontend/
├── index.html            entry page (setup-phase landing page)
├── server.js             static dev server (npm run dev)
├── partials/             shared HTML fragments loaded at runtime
│   ├── navbar.html
│   └── footer.html
├── pages/                one HTML file per route (see pages/README.md)
├── components/           component contract + planned list (see README)
├── assets/
│   ├── images/
│   ├── icons/
│   └── fonts/
├── css/
│   ├── tokens.css        design tokens (colors, space, type, motion)
│   ├── base.css          reset + element defaults + a11y
│   ├── layout.css        container, grid, breakpoints, card
│   ├── utilities.css     small single-purpose helpers
│   └── main.css          the only stylesheet pages load (imports the above)
└── js/
    ├── config.js         API base URL and runtime config
    ├── main.js           entry point: partials + page boot
    ├── core/
    │   ├── api.js        fetch wrapper, envelope unwrapping, ApiError
    │   ├── dom.js        el(), append(), loadPartial(), qs()
    │   └── registry.js   component registration convention
    ├── components/       one component per file (planned)
    ├── pages/            one module per page
    ├── store/            shared client state (planned)
    └── utils/            formatting helpers (planned)
```

## Running

```bash
npm run dev:frontend      # http://localhost:5173
```

The backend must also be running (`npm run dev:backend`) for the status card to
show a connected API.

## How the frontend talks to the backend

1. `js/config.js` holds `apiBaseUrl` (default `http://localhost:4000/api/v1`).
2. `js/core/api.js` builds the URL, adds `Accept: application/json`, enforces a
   timeout, unwraps the `{ success, data }` envelope and throws a normalized
   `ApiError` otherwise.
3. The backend's CORS config (driven by `FRONTEND_URL`) allows this origin.
4. Pages never call `fetch` directly — only through `js/core/api.js`.

```js
import { api } from '../core/api.js';

const health = await api.get('/health');
// -> { status: 'healthy', api: 'healthy', database: 'connected', ... }
```
