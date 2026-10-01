/**
 * Frontend development server.
 *
 * The storefront is plain HTML/CSS/JS with no build step, so this server only
 * needs to serve static files. Express is used because it is already part of
 * the workspace and behaves identically on Windows, macOS and Linux.
 *
 *   npm run dev:frontend   ->  http://localhost:5173
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = Number(process.env.FRONTEND_PORT ?? 5173);
const NODE_ENV = process.env.NODE_ENV ?? 'development';

// Disable caching so edits appear immediately while developing.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(
  express.static(currentDir, {
    extensions: ['html'],
    index: 'index.html',
  })
);

// Pretty URLs: /products/development -> /pages/products/development.html
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();

  const candidate = path.join(currentDir, 'pages', `${req.path.replace(/^\/+|\/+$/g, '')}.html`);
  if (candidate.startsWith(currentDir) && path.extname(candidate) === '.html') {
    return res.sendFile(candidate);
  }
  return next();
});

// Anything else is a real 404 (do not silently fall back to index.html).
app.use((req, res) => {
  res.status(404).type('text/plain').send('404 - page not found');
});

const server = app.listen(PORT, () => {
  console.log(`Frontend running on http://localhost:${PORT} (${NODE_ENV})`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set FRONTEND_PORT to another port.`);
  } else {
    console.error('Frontend server failed to start:', error);
  }
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

export default server;
