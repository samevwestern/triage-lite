import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Helper: Discover the laptop's active local IPv4 address (Wi-Fi or wired USB bridge)
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (ifaceList) {
      for (const iface of ifaceList) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  }
  return '127.0.0.1';
}

// Expand User Documents path safely
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';
const SYNC_DIR = path.join(HOME_DIR, 'Documents', 'MTRAx lite', 'local-data');
const DB_FILE = path.join(SYNC_DIR, 'db.json');
const ATTACHMENTS_DIR = path.join(SYNC_DIR, 'attachments');

// Ensure directories exist
function ensureSyncDirectories() {
  if (!fs.existsSync(SYNC_DIR)) {
    fs.mkdirSync(SYNC_DIR, { recursive: true });
  }
  if (!fs.existsSync(ATTACHMENTS_DIR)) {
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mtrax-sync-server-middleware',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          ensureSyncDirectories();

          const url = req.url || '';

          // 1. GET SERVER INFO (Exposes active Wi-Fi / USB IP address to browser)
          if (url === '/api/server-info') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify({ 
              ip: `http://${getLocalIpAddress()}:8084`,
              status: 'listening'
            }));
            return;
          }

          // 2. GET CURRENT SYNC BOARD DATA (Read db.json)
          if (url === '/api/sync' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            if (fs.existsSync(DB_FILE)) {
              const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
              res.end(fileContent);
            } else {
              res.end(JSON.stringify({ cards: [], lists: [] }));
            }
            return;
          }

          // 3. POST SAVE SYNC BOARD DATA (Write to db.json)
          if (url === '/api/sync' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                fs.writeFileSync(DB_FILE, body, 'utf-8');
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ success: true, timestamp: Date.now() }));
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
            return;
          }

          // Handle CORS Preflight pre-requests gracefully
          if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.statusCode = 200;
            res.end();
            return;
          }

          next();
        });
      }
    }
  ],
  server: {
    port: 8084,
    strictPort: true,
    host: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild'
  }
});
