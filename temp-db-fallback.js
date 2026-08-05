const { connectToDatabase, User } = require('./db');
(async () => {
  try {
    const conn = await connectToDatabase();
    console.log('connect typeof', typeof conn);
    console.log('connect raw', conn);
    console.log('connect readyState', conn?.readyState);
    console.log('connect fallback', conn?.fallback);
    const email = 'test-fallback-' + Date.now() + '@example.com';
    const user = await User.create({ name: 'Fallback Test', email, passwordHash: 'hash', assignedAdmin: 'super-admin', role: 'client' });
    console.log('created user', user && user._id, user && user.email);
    const found = await User.findOne({ email });
    console.log('found user raw', found);
    const foundObj = found && found.toObject ? found.toObject() : found;
    console.log('found user', foundObj && foundObj._id, foundObj && foundObj.email);
  } catch (e) {
    console.error('error', e && e.message, e && e.stack);
  }
})();
