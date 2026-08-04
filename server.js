require('dotenv').config();

const app = require('./api');
const { connectToDatabase } = require('./db');

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