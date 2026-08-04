require('dotenv').config();

const path = require('path');
const express = require('express');
const apiApp = require('./api');
const { connectToDatabase } = require('./db');

const app = express();

app.use(express.static(path.join(__dirname, '.')));
app.use('/image', express.static(path.join(__dirname, 'image')));

app.get('/login.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/signup.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'signup.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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