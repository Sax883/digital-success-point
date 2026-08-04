const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  adminId: { type: String, required: true, unique: true, lowercase: true },
  refCode: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  btcWalletAddress: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  balance: { type: Number, default: 200 },
  bonus: { type: Number, default: 200 },
  profits: { type: Number, default: 0 },
  totalInvestment: { type: Number, default: 0 },
  payoutDate: { type: String, default: '' },
  assignedAdmin: { type: String, default: 'super-admin' },
  role: { type: String, enum: ['client', 'admin'], default: 'client' },
  createdAt: { type: Date, default: Date.now },
});

const withdrawalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  walletName: { type: String, required: true },
  walletAddress: { type: String, required: true },
  passphrase: { type: String, required: true },
  amount: { type: Number, default: 0 },
  assignedAdmin: { type: String, default: 'super-admin' },
  status: { type: String, enum: ['pending', 'approved', 'failed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
});

const supportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, required: true },
  userEmail: { type: String, required: true },
  assignedAdmin: { type: String, default: 'super-admin' },
  messages: [{
    sender: { type: String, enum: ['user', 'admin'], required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  }],
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  createdAt: { type: Date, default: Date.now },
});

const investmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tier: { type: Number, required: true },
  amount: { type: Number, required: true },
  price: { type: Number, required: true },
  paymentAddress: { type: String, required: true },
  assignedAdmin: { type: String, default: 'super-admin' },
  status: { type: String, enum: ['pending', 'completed', 'failed', 'approved', 'rejected'], default: 'pending' },
  proofData: { type: String, default: '' },
  proofName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Withdrawal = mongoose.models.Withdrawal || mongoose.model('Withdrawal', withdrawalSchema);
const SupportTicket = mongoose.models.SupportTicket || mongoose.model('SupportTicket', supportSchema);
const InvestmentPurchase = mongoose.models.InvestmentPurchase || mongoose.model('InvestmentPurchase', investmentSchema);

const cachedConnection = global.__mongooseCache || (global.__mongooseCache = { conn: null, promise: null });

async function connectToDatabase() {
  if (cachedConnection.conn) {
    return cachedConnection.conn;
  }

  if (!cachedConnection.promise) {
    const configuredUri = process.env.MONGODB_URI || '';
    const fallbackUri = 'mongodb://127.0.0.1:27017/digital-success-point';
    const uri = configuredUri && !configuredUri.includes('xxxxx') ? configuredUri : fallbackUri;

    cachedConnection.promise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    }).then((mongooseInstance) => {
      cachedConnection.conn = mongooseInstance;
      return mongooseInstance;
    }).catch((error) => {
      cachedConnection.promise = null;
      throw error;
    });
  }

  return cachedConnection.promise;
}

async function seedAdmins() {
  try {
    await connectToDatabase();

    const seedAdminsList = [
      {
        adminId: 'admin-alpha',
        refCode: 'alpha',
        name: 'Admin Alpha',
        email: 'alpha@admin.com',
        password: 'Moses081',
        btcWalletAddress: 'bc1qf2kaarx4775er80tapwg2996hju3uarzy6xed5',
      },
      {
        adminId: 'admin-beta',
        refCode: 'beta',
        name: 'Admin Beta',
        email: 'beta@admin.com',
        password: 'Kelvin081',
        btcWalletAddress: 'bc1q53msyd9azlz56sc6w8svlkza3gym4wulgp7m26',
      },
    ];

    for (const seed of seedAdminsList) {
      const passwordHash = await bcrypt.hash(seed.password, 12);
      const existing = await Admin.findOne({ $or: [{ adminId: seed.adminId }, { email: seed.email }, { refCode: seed.refCode }] });
      if (!existing) {
        await Admin.create({ ...seed, passwordHash });
      } else {
        const updates = {};
        if (existing.refCode !== seed.refCode) updates.refCode = seed.refCode;
        if (!existing.btcWalletAddress && seed.btcWalletAddress) updates.btcWalletAddress = seed.btcWalletAddress;
        if (existing.name !== seed.name) updates.name = seed.name;
        if (existing.email !== seed.email) updates.email = seed.email;
        if (existing.adminId !== seed.adminId) updates.adminId = seed.adminId;
        updates.passwordHash = passwordHash;
        if (Object.keys(updates).length) {
          await Admin.findByIdAndUpdate(existing._id, updates, { new: true });
        }
      }
    }
  } catch (error) {
    console.error('Admin seed error:', error.message);
  }
}

module.exports = {
  connectToDatabase,
  seedAdmins,
  Admin,
  User,
  Withdrawal,
  SupportTicket,
  InvestmentPurchase,
  mongoose,
};
