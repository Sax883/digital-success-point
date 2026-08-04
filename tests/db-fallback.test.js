const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/digital-success-point';

const { connectToDatabase, seedAdmins, User } = require('../db');

test('connectToDatabase falls back to the in-memory store when MongoDB is unavailable', async () => {
  const connection = await connectToDatabase();
  assert.ok(connection, 'connectToDatabase should resolve a connection-like value');

  const user = await User.create({
    name: 'Test User',
    email: 'test@example.com',
    passwordHash: 'hash',
    balance: 100,
    bonus: 100,
    assignedAdmin: 'super-admin',
    role: 'client',
  });

  const found = await User.findOne({ email: 'test@example.com' });
  assert.ok(found, 'the user should be retrievable from the fallback store');
  assert.equal(found.name, 'Test User');

  await seedAdmins();
});
