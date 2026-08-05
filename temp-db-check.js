const { connectToDatabase, User, Admin, mongoose } = require('./db');
console.log('User.create type=', typeof User.create);
console.log('User.create source starts=', User.create.toString().slice(0,120));
console.log('Admin.create type=', typeof Admin.create);
console.log('Admin.create source starts=', Admin.create.toString().slice(0,120));
console.log('connectToDatabase contains fallbackMode=', connectToDatabase.toString().includes('fallbackMode'));
console.log('mongoose readyState=', mongoose.connection.readyState);
(async()=>{
  try{
    const conn = await connectToDatabase();
    console.log('connectToDatabase result readyState=', conn.readyState, 'fallback=', conn.fallback);
  } catch(e){
    console.error('connect error', e.message);
  }
})();
