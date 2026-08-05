const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'digital-success-point-secret-key-2026';
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhNzI0NjllMDc1YTVlMmYwMjIxZjM3YSIsInJvbGUiOiJjbGllbnQiLCJpYXQiOjE3ODU4NzQwNzgsImV4cCI6MTc4NjQ3ODg3OH0.vYtH5QmXSZDsWZHZlWijyjhwD_HIrNvSYEzDSsfs6WE';
console.log('secret=', secret);
console.log('decoded=', jwt.decode(token, { complete: true }));
try {
  const verified = jwt.verify(token, secret);
  console.log('verified=', verified);
} catch (error) {
  console.error('verify failed=', error.message);
}
