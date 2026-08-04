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
const fallbackStores = {
  Admin: new Map(),
  User: new Map(),
  Withdrawal: new Map(),
  SupportTicket: new Map(),
  InvestmentPurchase: new Map(),
};
let fallbackMode = false;

function createId() {
  return new mongoose.Types.ObjectId().toString();
}

function cloneDoc(doc) {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') {
    const plain = doc.toObject();
    return { ...plain };
  }
  return { ...doc };
}

function normalizeValue(value) {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return value.toString();
  return String(value);
}

function valueMatches(doc, key, expected) {
  const actual = doc[key];
  if (expected instanceof RegExp) {
    return typeof actual === 'string' && expected.test(actual);
  }
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return Object.entries(expected).every(([nestedKey, nestedValue]) => valueMatches(doc, nestedKey, nestedValue));
  }
  return normalizeValue(actual) === normalizeValue(expected);
}

function matchesFilter(filter, doc) {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }
  if (filter.$or) {
    return filter.$or.some((part) => matchesFilter(part, doc));
  }
  return Object.entries(filter).every(([key, value]) => {
    if (key === '_id') {
      return normalizeValue(doc._id) === normalizeValue(value);
    }
    if (key === 'userId') {
      return normalizeValue(doc.userId) === normalizeValue(value);
    }
    if (key === 'assignedAdmin') {
      return normalizeValue(doc.assignedAdmin) === normalizeValue(value);
    }
    return valueMatches(doc, key, value);
  });
}

function toPlainDoc(doc) {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const { save, toObject, toJSON, ...rest } = plain;
  return rest;
}

function toFallbackDoc(modelName, data) {
  const doc = {
    ...data,
    _id: data._id || createId(),
    createdAt: data.createdAt || new Date(),
  };
  doc.save = async function save() {
    const collection = fallbackStores[modelName];
    const key = String(doc._id);
    collection.set(key, { ...doc });
    return { ...doc };
  };
  doc.toObject = function toObject() {
    return { ...doc };
  };
  doc.toJSON = function toJSON() {
    return { ...doc };
  };
  return doc;
}

class FallbackQuery {
  constructor(modelName, items) {
    this.modelName = modelName;
    this.items = items;
    this.populatePath = null;
    this.sortSpec = null;
  }

  populate(path) {
    this.populatePath = path;
    return this;
  }

  sort(spec) {
    this.sortSpec = spec;
    return this;
  }

  select() {
    return this;
  }

  async execute() {
    let result = [...this.items];
    if (this.sortSpec) {
      const sortField = Object.keys(this.sortSpec)[0];
      const isDesc = this.sortSpec[sortField] === -1;
      result.sort((a, b) => {
        const left = a[sortField] ? new Date(a[sortField]).getTime() : 0;
        const right = b[sortField] ? new Date(b[sortField]).getTime() : 0;
        return isDesc ? right - left : left - right;
      });
    }
    if (this.populatePath) {
      const collectionName = this.populatePath === 'userId' ? 'User' : this.populatePath;
      const collection = fallbackStores[collectionName];
      result = result.map((item) => {
        if (!collection) return item;
        const id = item[this.populatePath];
        const related = collection.get(String(id));
        return related ? { ...item, [this.populatePath]: related } : item;
      });
    }
    return result;
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  catch(reject) {
    return this.execute().catch(reject);
  }
}

function attachFallbackModel(model, modelName) {
  if (model.__fallbackAttached) return;
  model.__fallbackAttached = true;

  model.create = async function create(payload) {
    const collection = fallbackStores[modelName];
    const document = toFallbackDoc(modelName, Array.isArray(payload) ? payload[0] : payload);
    collection.set(String(document._id), document);
    return document;
  };

  model.findOne = function findOne(filter) {
    const collection = fallbackStores[modelName];
    const matches = [...collection.values()].filter((doc) => matchesFilter(filter, doc));
    const doc = matches[0] || null;
    return Promise.resolve(doc ? toFallbackDoc(modelName, cloneDoc(doc)) : null);
  };

  model.find = function find(filter) {
    const collection = fallbackStores[modelName];
    const items = [...collection.values()].filter((doc) => matchesFilter(filter, doc));
    return new FallbackQuery(modelName, items);
  };

  model.findById = function findById(id) {
    const collection = fallbackStores[modelName];
    const doc = collection.get(String(id));
    return Promise.resolve(doc ? toFallbackDoc(modelName, cloneDoc(doc)) : null);
  };

  model.findByIdAndUpdate = async function findByIdAndUpdate(id, updates, options = {}) {
    const collection = fallbackStores[modelName];
    const key = String(id);
    const existing = collection.get(key);
    if (!existing) return null;
    const updated = { ...existing };
    if (updates.$inc) {
      Object.entries(updates.$inc).forEach(([field, amount]) => {
        updated[field] = Number(updated[field] || 0) + Number(amount || 0);
      });
    }
    Object.entries(updates).forEach(([field, value]) => {
      if (field === '$inc') return;
      updated[field] = value;
    });
    if (options.new === false) {
      collection.set(key, updated);
      return toFallbackDoc(modelName, cloneDoc(updated));
    }
    collection.set(key, updated);
    return toFallbackDoc(modelName, cloneDoc(updated));
  };

  model.findByIdAndDelete = async function findByIdAndDelete(id) {
    const collection = fallbackStores[modelName];
    const key = String(id);
    const existing = collection.get(key);
    if (!existing) return null;
    collection.delete(key);
    return toFallbackDoc(modelName, cloneDoc(existing));
  };

  model.deleteMany = async function deleteMany(filter) {
    const collection = fallbackStores[modelName];
    const toDelete = [...collection.values()].filter((doc) => matchesFilter(filter, doc));
    toDelete.forEach((doc) => collection.delete(String(doc._id)));
    return toDelete.length;
  };
}

attachFallbackModel(Admin, 'Admin');
attachFallbackModel(User, 'User');
attachFallbackModel(Withdrawal, 'Withdrawal');
attachFallbackModel(SupportTicket, 'SupportTicket');
attachFallbackModel(InvestmentPurchase, 'InvestmentPurchase');

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
      fallbackMode = false;
      return mongooseInstance;
    }).catch((error) => {
      fallbackMode = true;
      cachedConnection.promise = null;
      if (!process.env.VERCEL) {
        console.warn('MongoDB unavailable, using in-memory fallback store:', error.message);
      }
      return { readyState: 0, fallback: true };
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
