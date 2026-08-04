require('dotenv').config();

const path = require('path');
const express = require('express');
const apiApp = require('./api');
const { connectToDatabase } = require('./db');

const app = express();

// Serve static assets and subfolders explicitly
app.use('/image', express.static(path.join(__dirname, 'image')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/client', express.static(path.join(__dirname, 'client')));
app.use(express.static(__dirname));

// HTML Page Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/signup.html', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));

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