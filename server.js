require('dotenv').config();

const path = require('path');
const express = require('express');
const apiApp = require('./api');
const { connectToDatabase } = require('./db');

const app = express();

// 1. Static Assets & Subfolders
app.use('/image', express.static(path.join(__dirname, 'image')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/client', express.static(path.join(__dirname, 'client')));
app.use(express.static(__dirname));

// 2. Root HTML Page Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/signup.html', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
app.get('/forgot-password.html', (req, res) => res.sendFile(path.join(__dirname, 'forgot-password.html')));

// 3. Subfolder Explicit Dynamic Routes (Fixes Vercel 404s for /client/ and /admin/)
app.get('/client/:page', (req, res) => res.sendFile(path.join(__dirname, 'client', req.params.page)));
app.get('/admin/:page', (req, res) => res.sendFile(path.join(__dirname, 'admin', req.params.page)));

// 4. API Routes
app.use(apiApp);

const port = process.env.PORT || 3000;

async function startServer() {
  await connectToDatabase();

  if (!process.env.VERCEL) {
    app.listen(port, () => {
      console.log(`Digital Success Point server listening on port ${port}`);
    });
  }
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = app;