const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  connectToDatabase,
  seedAdmins,
  Admin,
  User,
  Withdrawal,
  SupportTicket,
  InvestmentPurchase,
} = require('../db');

const app = express();
const secret = process.env.JWT_SECRET || 'digital-success-point-secret-key-2026';

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, '..')));

function signToken(payload) {
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

function getBearerTokenFromHeader(req) {
  const authorization = req.get('authorization') || req.headers.authorization || req.headers.Authorization;
  if (!authorization || typeof authorization !== 'string') return null;
  const [scheme, token] = authorization.trim().split(/\s+/);
  return /^Bearer$/i.test(scheme) ? token : authorization.trim();
}

function getToken(req) {
  return req.cookies.token || getBearerTokenFromHeader(req);
}

function getAdminToken(req) {
  return req.cookies.adminToken || req.headers['x-admin-token'] || getBearerTokenFromHeader(req);
}

async function resolveAdminFromToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret);
    if (decoded.role !== 'admin') return null;
    return decoded;
  } catch (error) {
    return null;
  }
}

async function requireUser(req, res, next) {
  const token = getToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, secret);
    const userId = decoded.id || decoded.userId || decoded._id;
    if (!userId) {
      return res.status(401).json({ message: 'Invalid token payload.' });
    }

    await connectToDatabase();
    
    // Fallback selection to prevent Mongoose schema crashes
    let user = await User.findById(userId).select('-passwordHash -password');
    if (!user && /^[a-fA-F0-9]{24}$/.test(userId)) {
      user = await User.findOne({ _id: userId }).select('-passwordHash -password');
    }

    if (!user) {
      return res.status(401).json({ message: 'User not found in database.' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error('User token verification failed:', error.message);
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

async function requireAdmin(req, res, next) {
  const token = getAdminToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Admin authentication required.' });
  }

  const decoded = await resolveAdminFromToken(token);
  if (!decoded) {
    return res.status(401).json({ message: 'Invalid admin token.' });
  }

  await connectToDatabase();
  req.admin = decoded;
  next();
}

seedAdmins().catch((error) => {
  console.error('Admin seed error:', error.message);
});

app.get('/api/health', async (_req, res) => {
  try {
    await connectToDatabase();
    res.json({ ok: true, message: 'Digital Success Point API is running.' });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

async function registerUser(req, res) {
  try {
    await connectToDatabase();
    const { name, email, password } = req.body;
    const rawRef = String(req.body.ref || req.body.referredBy || req.body.referralCode || req.body.admin || '').trim();

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    let assignedAdmin = 'super-admin';
    let referredBy = 'super-admin';

    if (rawRef) {
      const normalizedRef = rawRef.toLowerCase();
      
      const adminQuery = [{ adminId: normalizedRef }, { refCode: normalizedRef }];
      const userQuery = [{ referralCode: normalizedRef }];
      
      if (/^[a-fA-F0-9]{24}$/.test(rawRef)) {
        adminQuery.push({ _id: rawRef });
        userQuery.push({ _id: rawRef });
      }

      const selectedAdmin = await Admin.findOne({ $or: adminQuery });
      const selectedUser = await User.findOne({ $or: userQuery });
      const referrer = selectedAdmin || selectedUser;

      referredBy = referrer ? String(referrer._id) : rawRef;
      if (selectedAdmin) {
        assignedAdmin = selectedAdmin.adminId || 'super-admin';
      } else if (selectedUser) {
        assignedAdmin = selectedUser.assignedAdmin || 'super-admin';
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      balance: 200,
      bonus: 200,
      profits: 0,
      totalInvestment: 0,
      payoutDate: '',
      assignedAdmin,
      referredBy,
      role: 'client',
    });

    const userIdStr = user._id ? user._id.toString() : '';
    const token = signToken({ id: userIdStr, email: user.email }); // ID is safely stringified here
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return res.status(201).json({
      success: true,
      token,
      user: {
        id: userIdStr,
        _id: userIdStr,
        name: user.name,
        email: user.email,
        balance: user.balance,
        bonus: user.bonus,
        profits: user.profits,
        totalInvestment: user.totalInvestment,
        payoutDate: user.payoutDate || '',
        referredBy: user.referredBy || '',
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email address is already registered. Please login.' });
    }
    res.status(500).json({ success: false, message: error.message || 'Signup failed.' });
  }
}

app.post('/api/auth/signup', registerUser);
app.post('/api/auth/register', registerUser);

app.post('/api/auth/login', async (req, res) => {
  try {
    await connectToDatabase();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Invalid email or password' });
    }

    const userIdStr = user._id ? user._id.toString() : '';
    const token = signToken({ id: userIdStr, email: user.email }); // ID is safely stringified here
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return res.json({
      success: true,
      token,
      user: {
        id: userIdStr,
        _id: userIdStr,
        name: user.name,
        email: user.email,
        balance: user.balance,
        bonus: user.bonus,
        profits: user.profits,
        totalInvestment: user.totalInvestment,
        payoutDate: user.payoutDate || '',
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Login failed.' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out.' });
});

app.get('/api/client/checkout-info', requireUser, async (req, res) => {
  try {
    const admin = await Admin.findOne({ adminId: req.user.assignedAdmin }).select('adminId name btcWalletAddress');
    res.json({
      assignedAdmin: admin ? { adminId: admin.adminId, name: admin.name, btcWalletAddress: admin.btcWalletAddress } : null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to load checkout wallet info.' });
  }
});

app.get('/api/client/assigned-wallet', requireUser, async (req, res) => {
  try {
    const admin = await Admin.findOne({ adminId: req.user.assignedAdmin }).select('btcWalletAddress');
    res.json({ btcWalletAddress: admin?.btcWalletAddress || '' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to load assigned wallet.' });
  }
});

app.get('/api/settings', requireUser, async (req, res) => {
  try {
    const admin = await Admin.findOne({ adminId: req.user.assignedAdmin }).select('adminId name btcWalletAddress');
    res.json({
      assignedAdmin: admin ? { adminId: admin.adminId, name: admin.name, btcWalletAddress: admin.btcWalletAddress } : null,
      user: { id: req.user._id, name: req.user.name, email: req.user.email },
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to load settings.' });
  }
});

app.get('/api/admin/wallet', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findOne({ adminId: req.admin.adminId }).select('btcWalletAddress');
    res.json({ btcWalletAddress: admin?.btcWalletAddress || '' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to load admin wallet.' });
  }
});

app.get('/api/admin/profile', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findOne({ adminId: req.admin.adminId }).select('-passwordHash');
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found.' });
    }
    res.json({ admin });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to load admin profile.' });
  }
});

app.get('/api/auth/me', requireUser, async (req, res) => {
  try {
    const admin = await Admin.findOne({ adminId: req.user.assignedAdmin }).select('adminId name btcWalletAddress');
    const safeUser = req.user.toObject ? req.user.toObject() : req.user;
    res.json({
      success: true,
      user: {
        ...safeUser,
        assignedAdmin: admin ? { adminId: admin.adminId, name: admin.name, btcWalletAddress: admin.btcWalletAddress } : null,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.patch('/api/profile', requireUser, async (req, res) => {
  try {
    const updates = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.password) {
      updates.passwordHash = await bcrypt.hash(req.body.password, 12);
    }

    const updated = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-passwordHash');
    res.json({ message: 'Profile updated.', user: updated });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Profile update failed.' });
  }
});

async function createWithdrawal(req, res) {
  try {
    const { walletName, walletAddress, passphrase, amount } = req.body;
    const withdrawalAmount = Number(amount);
    if (!walletName || !walletAddress || !passphrase || !withdrawalAmount || withdrawalAmount <= 0) {
      return res.status(400).json({ message: 'A valid withdrawal amount, wallet name, wallet address, and passphrase are required.' });
    }

    const withdrawal = await Withdrawal.create({
      userId: req.user._id,
      walletName,
      walletAddress,
      passphrase,
      amount: withdrawalAmount,
      assignedAdmin: req.user.assignedAdmin || 'super-admin',
    });

    res.status(201).json({ message: 'Withdrawal request submitted. Status: Pending / Awaiting Confirmation.', withdrawal });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Withdrawal failed.' });
  }
}

app.post('/api/withdrawals', requireUser, createWithdrawal);
app.post('/api/withdraw', requireUser, createWithdrawal);

app.get('/api/withdrawals', requireUser, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ withdrawals });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch withdrawals.' });
  }
});

app.post('/api/support/ticket', requireUser, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ message: 'A support message is required.' });
    }

    const ticket = await SupportTicket.create({
      userId: req.user._id,
      userName: req.user.name,
      userEmail: req.user.email,
      assignedAdmin: req.user.assignedAdmin || 'super-admin',
      messages: [{ sender: 'user', text: message }],
    });

    res.status(201).json({ message: 'Support ticket created.', ticket });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Support ticket failed.' });
  }
});

app.post('/api/support/message', requireUser, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ message: 'A support message is required.' });
    }

    const existingTicket = await SupportTicket.findOne({ userId: req.user._id, status: 'open' }).sort({ createdAt: -1 });
    if (existingTicket) {
      existingTicket.messages.push({ sender: 'user', text: message });
      await existingTicket.save();
      return res.status(200).json({ message: 'Support message added to existing ticket.', ticket: existingTicket });
    }

    const ticket = await SupportTicket.create({
      userId: req.user._id,
      userName: req.user.name,
      userEmail: req.user.email,
      assignedAdmin: req.user.assignedAdmin || 'super-admin',
      messages: [{ sender: 'user', text: message }],
    });

    res.status(201).json({ message: 'Support message created.', ticket });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Support message failed.' });
  }
});

app.get('/api/support/tickets', requireUser, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ tickets });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch support history.' });
  }
});

app.get('/api/support/messages', requireUser, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ tickets });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch support messages.' });
  }
});

async function createInvestment(req, res) {
  try {
    const { tier, amount, price } = req.body;
    const tierNumber = Number(tier);
    const amountValue = Number(amount || 0);
    const priceValue = Number(price || amountValue || 0);
    const paymentAddress = `bc1q${tierNumber}${Date.now().toString(16).slice(-8)}x9a`;

    const investment = await InvestmentPurchase.create({
      userId: req.user._id,
      tier: tierNumber,
      amount: amountValue || priceValue,
      price: priceValue,
      paymentAddress,
      assignedAdmin: req.user.assignedAdmin || 'super-admin',
      status: 'pending',
    });

    res.status(201).json({ message: 'Investment purchase initiated. Pending confirmation.', investment });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to create investment purchase.' });
  }
}

app.post('/api/investments', requireUser, createInvestment);
app.post('/api/invest', requireUser, createInvestment);

app.get('/api/investments', requireUser, async (req, res) => {
  try {
    const investments = await InvestmentPurchase.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ investments });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch investments.' });
  }
});

app.post('/api/investments/:id/proof', requireUser, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const investment = await InvestmentPurchase.findOne({ _id: req.params.id, userId });
    if (!investment) return res.status(404).json({ message: 'Investment purchase not found.' });

    investment.proofData = req.body.proofData || '';
    investment.proofName = req.body.proofName || '';
    await investment.save();

    res.json({ message: 'Proof of payment uploaded.', investment });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to upload proof.' });
  }
});

app.post('/api/investments/proof', requireUser, async (req, res) => {
  try {
    const { investmentId, proofData, proofName } = req.body;
    if (!investmentId || !proofData) {
      return res.status(400).json({ message: 'Investment ID and proof data are required.' });
    }
    const userId = req.user._id || req.user.id;
    const investment = await InvestmentPurchase.findOne({ _id: investmentId, userId });
    if (!investment) return res.status(404).json({ message: 'Investment purchase not found.' });

    investment.proofData = proofData;
    investment.proofName = proofName || investment.proofName;
    await investment.save();

    res.json({ message: 'Proof of payment uploaded.', investment });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to upload proof.' });
  }
});

app.post('/api/investments/upload', requireUser, async (req, res) => {
  try {
    const { investmentId, proofData, proofName } = req.body;
    if (!investmentId || !proofData) {
      return res.status(400).json({ message: 'Investment ID and proof data are required.' });
    }
    const userId = req.user._id || req.user.id;
    const investment = await InvestmentPurchase.findOne({ _id: investmentId, userId });
    if (!investment) return res.status(404).json({ message: 'Investment purchase not found.' });

    investment.proofData = proofData;
    investment.proofName = proofName || investment.proofName;
    await investment.save();

    res.json({ message: 'Proof of payment uploaded.', investment });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to upload proof.' });
  }
});

app.post('/api/investments/confirm', requireUser, async (req, res) => {
  try {
    const { investmentId } = req.body;
    if (!investmentId) {
      return res.status(400).json({ message: 'Investment ID is required.' });
    }
    const userId = req.user._id || req.user.id;
    const investment = await InvestmentPurchase.findOne({ _id: investmentId, userId });
    if (!investment) return res.status(404).json({ message: 'Investment purchase not found.' });

    investment.status = 'pending';
    await investment.save();
    res.json({ message: 'Investment confirmed for review.', investment });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to confirm investment.' });
  }
});

app.post('/api/buy', requireUser, createInvestment);

app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
    }

    const token = signToken({ id: admin._id, role: 'admin', adminId: admin.adminId, email: admin.email });
    res.cookie('adminToken', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    return res.json({
      success: true,
      message: 'Admin access granted.',
      token,
      admin: { adminId: admin.adminId, refCode: admin.refCode, name: admin.name, email: admin.email, btcWalletAddress: admin.btcWalletAddress },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Admin login failed.' });
  }
});

app.post('/api/admin/logout', (_req, res) => {
  res.clearCookie('adminToken');
  res.json({ message: 'Admin logged out.' });
});

app.get('/api/admin/verify', requireAdmin, (_req, res) => {
  res.json({ message: 'Admin verified.' });
});

app.get('/api/admin/me', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findOne({ adminId: req.admin.adminId }).select('-passwordHash');
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found.' });
    }
    res.json({ admin });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch admin profile.' });
  }
});

app.patch('/api/admin/profile', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findOne({ adminId: req.admin.adminId });
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found.' });
    }

    const updates = {};
    if (req.body.btcWalletAddress !== undefined) updates.btcWalletAddress = req.body.btcWalletAddress;
    if (req.body.refCode !== undefined) updates.refCode = String(req.body.refCode || '').trim().toLowerCase();
    if (req.body.password) updates.passwordHash = await bcrypt.hash(req.body.password, 12);

    const updated = await Admin.findByIdAndUpdate(admin._id, { $set: updates }, { new: true, runValidators: true });
    if (updated && updated.passwordHash) {
      updated.passwordHash = undefined;
    }
    res.json({ message: 'Admin profile updated.', admin: updated });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to update admin profile.' });
  }
});

app.get('/api/admin/clients', requireAdmin, async (req, res) => {
  try {
    await connectToDatabase();
    const query = String(req.query.q || '').trim();
    const admin = await Admin.findOne({ adminId: req.admin.adminId }).select('adminId refCode');
    const clientFilter = { role: 'client' };

    if (req.admin.adminId !== 'super-admin') {
      clientFilter.$or = [
        { assignedAdmin: req.admin.adminId },
        { referredBy: admin?.refCode || '' },
        { referredBy: admin?.adminId || '' },
      ];
    }

    const searchConditions = query
      ? [{ email: new RegExp(query, 'i') }, { name: new RegExp(query, 'i') }]
      : [];
    if (query && /^[a-fA-F0-9]{24}$/.test(query)) {
      searchConditions.push({ _id: query });
    }

    const filter = searchConditions.length
      ? { $and: [clientFilter, { $or: searchConditions }] }
      : clientFilter;

    const clients = await User.find(filter).select('-passwordHash').sort({ createdAt: -1 });
    res.status(200).json(clients || []);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch clients.' });
  }
});

async function updateClientHandler(req, res) {
  try {
    const updates = {};
    if (req.body.profits !== undefined) updates.profits = Number(req.body.profits);
    if (req.body.totalInvestment !== undefined) updates.totalInvestment = Number(req.body.totalInvestment);
    if (req.body.payoutDate !== undefined) updates.payoutDate = req.body.payoutDate;

    const client = await User.findById(req.params.id || req.body.id || req.body.clientId);
    if (!client) {
      return res.status(404).json({ message: 'Client not found.' });
    }

    const admin = await Admin.findOne({ adminId: req.admin.adminId }).select('_id adminId refCode');
    const ownsClient = admin && (
      client.assignedAdmin === admin.adminId ||
      client.assignedAdmin === admin.refCode ||
      String(client.referredBy || '') === String(admin._id) ||
      String(client.referredBy || '') === String(admin.adminId) ||
      String(client.referredBy || '') === String(admin.refCode)
    );

    if (!ownsClient) {
      return res.status(403).json({ message: 'Client not found for this admin.' });
    }

    const updated = await User.findByIdAndUpdate(client._id, updates, { new: true });
    if (updated && updated.passwordHash) {
      updated.passwordHash = undefined;
    }
    res.json({ message: 'Client updated.', client: updated });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to update client.' });
  }
}

app.patch('/api/admin/clients/:id', requireAdmin, updateClientHandler);
app.put('/api/admin/client/:id', requireAdmin, updateClientHandler);
app.post('/api/admin/update-client', requireAdmin, updateClientHandler);

app.delete('/api/admin/clients/:id', requireAdmin, async (req, res) => {
  try {
    const client = await User.findById(req.params.id);
    if (!client || client.assignedAdmin !== req.admin.adminId) {
      return res.status(404).json({ message: 'Client not found.' });
    }

    await InvestmentPurchase.deleteMany({ userId: client._id });
    await Withdrawal.deleteMany({ userId: client._id });
    await SupportTicket.deleteMany({ userId: client._id });
    await User.findByIdAndDelete(req.params.id);

    res.json({ message: 'Client and associated records deleted.' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to delete client.' });
  }
});

app.get('/api/admin/investments', requireAdmin, async (req, res) => {
  try {
    const investments = await InvestmentPurchase.find({ assignedAdmin: req.admin.adminId }).populate('userId', 'name email').sort({ createdAt: -1 });
    res.json({ investments: investments || [] });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch investment purchases.' });
  }
});

app.post('/api/admin/investments/:id/confirm', requireAdmin, async (req, res) => {
  try {
    const investment = await InvestmentPurchase.findById(req.params.id);
    if (!investment) return res.status(404).json({ message: 'Investment purchase not found.' });
    if (investment.assignedAdmin !== req.admin.adminId) return res.status(404).json({ message: 'Investment purchase not found.' });

    const updatedInvestment = await InvestmentPurchase.findByIdAndUpdate(
      req.params.id,
      { status: 'completed' },
      { new: true }
    );

    await User.findByIdAndUpdate(investment.userId, { $inc: { totalInvestment: investment.amount } });
    res.json({ message: 'Investment confirmed.', investment: updatedInvestment });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to confirm investment.' });
  }
});

app.post('/api/admin/investments/:id/fail', requireAdmin, async (req, res) => {
  try {
    const investment = await InvestmentPurchase.findById(req.params.id);
    if (!investment) return res.status(404).json({ message: 'Investment purchase not found.' });
    if (investment.assignedAdmin !== req.admin.adminId) return res.status(404).json({ message: 'Investment purchase not found.' });

    const updatedInvestment = await InvestmentPurchase.findByIdAndUpdate(
      req.params.id,
      { status: 'failed' },
      { new: true }
    );
    res.json({ message: 'Investment marked as failed.', investment: updatedInvestment });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fail investment.' });
  }
});

app.post('/api/admin/investments/:id/pending', requireAdmin, async (req, res) => {
  try {
    const investment = await InvestmentPurchase.findById(req.params.id);
    if (!investment) return res.status(404).json({ message: 'Investment purchase not found.' });
    if (investment.assignedAdmin !== req.admin.adminId) return res.status(404).json({ message: 'Investment purchase not found.' });

    const updatedInvestment = await InvestmentPurchase.findByIdAndUpdate(
      req.params.id,
      { status: 'pending' },
      { new: true }
    );
    res.json({ message: 'Investment set to pending.', investment: updatedInvestment });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to set investment pending.' });
  }
});

app.post('/api/admin/investments/:id/approve', requireAdmin, async (req, res) => {
  try {
    const investment = await InvestmentPurchase.findById(req.params.id);
    if (!investment) return res.status(404).json({ message: 'Investment purchase not found.' });
    if (investment.assignedAdmin !== req.admin.adminId) return res.status(404).json({ message: 'Investment purchase not found.' });

    const updatedInvestment = await InvestmentPurchase.findByIdAndUpdate(
      req.params.id,
      { status: 'completed' },
      { new: true }
    );
    await User.findByIdAndUpdate(investment.userId, { $inc: { totalInvestment: investment.amount } });
    res.json({ message: 'Investment confirmed.', investment: updatedInvestment });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to confirm investment.' });
  }
});

app.post('/api/admin/investments/:id/reject', requireAdmin, async (req, res) => {
  try {
    const investment = await InvestmentPurchase.findById(req.params.id);
    if (!investment) return res.status(404).json({ message: 'Investment purchase not found.' });
    if (investment.assignedAdmin !== req.admin.adminId) return res.status(404).json({ message: 'Investment purchase not found.' });

    const updatedInvestment = await InvestmentPurchase.findByIdAndUpdate(
      req.params.id,
      { status: 'failed' },
      { new: true }
    );
    res.json({ message: 'Investment marked as failed.', investment: updatedInvestment });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fail investment.' });
  }
});

app.get('/api/admin/withdrawals', requireAdmin, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ assignedAdmin: req.admin.adminId }).populate('userId', 'name email').sort({ createdAt: -1 });
    res.json({ withdrawals: withdrawals || [] });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch withdrawals.' });
  }
});

app.post('/api/admin/withdrawals/:id/confirm', requireAdmin, async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal || withdrawal.assignedAdmin !== req.admin.adminId) return res.status(404).json({ message: 'Withdrawal not found.' });
    const updatedWithdrawal = await Withdrawal.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
    if (!updatedWithdrawal) return res.status(404).json({ message: 'Withdrawal not found.' });
    res.json({ message: 'Withdrawal confirmed.', withdrawal: updatedWithdrawal });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to confirm withdrawal.' });
  }
});

app.post('/api/admin/withdrawals/:id/fail', requireAdmin, async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal || withdrawal.assignedAdmin !== req.admin.adminId) return res.status(404).json({ message: 'Withdrawal not found.' });
    const updatedWithdrawal = await Withdrawal.findByIdAndUpdate(req.params.id, { status: 'failed' }, { new: true });
    if (!updatedWithdrawal) return res.status(404).json({ message: 'Withdrawal not found.' });
    res.json({ message: 'Withdrawal marked as failed.', withdrawal: updatedWithdrawal });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to mark withdrawal as failed.' });
  }
});

app.delete('/api/admin/withdrawals/:id', requireAdmin, async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal || withdrawal.assignedAdmin !== req.admin.adminId) return res.status(404).json({ message: 'Withdrawal not found.' });
    const removed = await Withdrawal.findByIdAndDelete(req.params.id);
    if (!removed) return res.status(404).json({ message: 'Withdrawal not found.' });
    res.json({ message: 'Withdrawal deleted.' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to delete withdrawal.' });
  }
});

app.get('/api/admin/messages', requireAdmin, async (req, res) => {
  try {
    await connectToDatabase();
    const tickets = await SupportTicket.find({ assignedAdmin: req.admin.adminId }).sort({ createdAt: -1 });
    res.json({ tickets });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch support tickets.' });
  }
});

app.post('/api/admin/reply', requireAdmin, async (req, res) => {
  try {
    const { ticketId, text } = req.body;
    if (!ticketId || !text) return res.status(400).json({ message: 'A ticket ID and reply text are required.' });

    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket || ticket.assignedAdmin !== req.admin.adminId) return res.status(404).json({ message: 'Ticket not found.' });

    ticket.messages.push({ sender: 'admin', text });
    ticket.status = 'resolved';
    await ticket.save();
    res.json({ message: 'Reply sent.', ticket });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to send reply.' });
  }
});

app.get('/api/admin/support', requireAdmin, async (req, res) => {
  try {
    await connectToDatabase();
    const tickets = await SupportTicket.find({ assignedAdmin: req.admin.adminId }).sort({ createdAt: -1 });
    res.json({ tickets });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch support tickets.' });
  }
});

app.post('/api/admin/support/:id/reply', requireAdmin, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'A reply is required.' });

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket || ticket.assignedAdmin !== req.admin.adminId) return res.status(404).json({ message: 'Ticket not found.' });

    ticket.messages.push({ sender: 'admin', text });
    ticket.status = 'resolved';
    await ticket.save();
    res.json({ message: 'Reply sent.', ticket });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to send reply.' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

module.exports = app;
module.exports.default = app;

if (!process.env.VERCEL) {
  connectToDatabase().catch((error) => console.error('Mongo connection error:', error));
}