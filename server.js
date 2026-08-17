'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import routes
const authRoutes = require('./api/routes/auth');
const syncRoutes = require('./api/routes/sync');

const app = express();
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] 
    : ['http://localhost:8080', 'http://127.0.0.1:8080'],
  credentials: true
}));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  next();
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Static files allowlist
const ALLOWED_STATIC = new Set([
  '/index.html',
  '/login.html',
  '/css/styles.css',
  '/css/login.css',
  '/js/db.js',
  '/js/voice.js',
  '/js/app.js',
  '/js/sync.js',
  '/js/auth.js',
  '/sw.js',
  '/manifest.webmanifest',
  '/assets/favicon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png'
]);

// Serve static files with allowlist
app.use((req, res, next) => {
  let pathname = req.path;
  if (pathname === '/') pathname = '/login.html';
  
  // Block .json, .map, and dotfiles
  const blocked = pathname.endsWith('.json') || 
                  pathname.endsWith('.map') || 
                  pathname.split('/').some(part => part.startsWith('.') && part.length > 1);
  
  if (blocked) {
    return res.status(403).send('Forbidden');
  }
  
  if (!ALLOWED_STATIC.has(pathname)) {
    return res.status(404).send('Not found');
  }
  
  const file = path.join(__dirname, pathname);
  const ext = path.extname(file);
  
  // Cache control
  if (pathname === '/sw.js' || pathname.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
  
  res.sendFile(file, (err) => {
    if (err) {
      res.status(404).send('Not found');
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'خطای سرور' });
});

app.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║         🚀 Factorino Server Started              ║
╠═══════════════════════════════════════════════════╣
║  URL: http://${HOST}:${PORT}                    ║
║  Mode: ${process.env.NODE_ENV || 'development'}  ║
║  API: http://${HOST}:${PORT}/api                ║
╚═══════════════════════════════════════════════════╝
  `);
});
