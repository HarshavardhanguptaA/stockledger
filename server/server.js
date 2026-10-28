/**
 * StockLedger — Express Web Server
 * Replaces Electron IPC with REST API while keeping all business logic intact.
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Static file serving (project root) ───────────────────────
const ROOT = path.join(__dirname, '..');
app.use('/css',    express.static(path.join(ROOT, 'css')));
app.use('/js',     express.static(path.join(ROOT, 'js')));
app.use('/assets', express.static(path.join(ROOT, 'assets')));
app.use('/pages',  express.static(path.join(ROOT, 'pages')));

// Redirect root → login page
app.get('/', (_req, res) => res.redirect('/pages/login.html'));

// ── Import API Service ───────────────────────────────────────
const api = require('./apiService');

// ── Session Management ───────────────────────────────────────
const sessions = new Map();

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token && sessions.has(token)) {
    req.user = sessions.get(token);
    next();
  } else {
    res.status(401).json({ success: false, error: 'Not authenticated. Please log in.' });
  }
}

// ── Auth Routes (no auth required) ───────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await api.login(req.body);
    if (result.success) {
      const token = crypto.randomUUID();
      sessions.set(token, result.user);
      res.json({ ...result, token });
    } else {
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const result = await api.register(req.body);
    if (result.success) {
      // Auto-login after registration
      const user = { id: result.id, name: req.body.name, username: req.body.username, role: 'admin' };
      const token = crypto.randomUUID();
      sessions.set(token, user);
      res.json({ ...result, user, token });
    } else {
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) sessions.delete(token);
  res.json({ success: true });
});

app.get('/api/auth/session', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token && sessions.has(token)) {
    res.json(sessions.get(token));
  } else {
    res.json(null);
  }
});

// ── Receipt HTML for browser printing ────────────────────────
app.get('/api/receipts/:id/print', authMiddleware, async (req, res) => {
  try {
    const receipt = await api.getReceiptById(Number(req.params.id));
    if (!receipt) return res.status(404).send('Receipt not found');
    const settings = await api.getCompanySettings();
    const html = api.buildReceiptHtml({
      receipt,
      items: receipt.items || [],
      payments: receipt.payments || [],
      settings
    });
    res.type('html').send(html);
  } catch (err) {
    res.status(500).send('Error generating receipt: ' + err.message);
  }
});

// ── Generic RPC Endpoint ─────────────────────────────────────
// Maps frontend window.api calls directly to apiService methods
const ALLOWED_METHODS = new Set([
  // Materials
  'getMaterials', 'getMaterialById', 'addMaterial', 'updateMaterial', 'deleteMaterial',
  // Stock
  'addStock', 'stockOut', 'getStockMovements', 'deleteStockMovement',
  // Customers
  'getCustomers', 'getCustomerById', 'addCustomer', 'updateCustomer', 'deleteCustomer',
  'getCustomerHistory', 'addCustomerPayment',
  // Receipts
  'getReceipts', 'getReceiptById', 'getReceiptByNumber', 'deleteReceipt',
  'updateReceiptPdfPath', 'markWhatsappSent', 'addPayment',
  // Dashboard & Reports
  'getDashboardStats', 'getReports', 'getReportsData', 'getReportData',
  // Company Settings
  'getCompanySettings', 'saveCompanySettings',
  // Expenses
  'addExpense', 'updateExpense', 'deleteExpense', 'getExpenses',
  'getExpenseSummary', 'getVehicleExpenseBreakdown', 'getPersonalExpenseBreakdown',
  'getDailyExpenseSummary', 'getMonthlyExpenseTrend',
  // Legacy Expenses
  'getEmployees', 'getVehicleExpenses', 'addVehicleExpense', 'updateVehicleExpense', 'deleteVehicleExpense',
  'getPersonalExpenses', 'addPersonalExpense', 'updatePersonalExpense', 'deletePersonalExpense',
  'getExpensesSummary',
  // Categories & Units
  'getCategories', 'getUnits',
  // System
  'getSystemHealth', 'resetDemoData', 'clearDemoData', 'clearBusinessData',
]);

// Methods that need the current user session injected as the last argument
const NEEDS_USER = new Set(['addMaterial', 'addStock', 'stockOut']);

app.post('/api/rpc', authMiddleware, async (req, res) => {
  const { method, args: rawArgs } = req.body;

  if (!method || !ALLOWED_METHODS.has(method)) {
    return res.status(400).json({ success: false, error: `Unknown or disallowed method: ${method}` });
  }

  try {
    const args = Array.isArray(rawArgs) ? [...rawArgs] : [];

    // Inject current user for methods that need it
    if (NEEDS_USER.has(method)) {
      args.push(req.user);
    }

    const fn = api[method];
    if (typeof fn !== 'function') {
      return res.status(400).json({ success: false, error: `Method not implemented: ${method}` });
    }

    const result = await fn.call(api, ...args);
    res.json(result !== undefined ? result : { success: true });
  } catch (err) {
    console.error(`[RPC ${method}] Error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Start Server ─────────────────────────────────────────────
async function start() {
  // Wait for database initialisation
  if (api.db && api.db.initPromise) {
    await api.db.initPromise;
    console.log('Database initialized.');
  }

  app.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║  StockLedger Web Server is running!      ║`);
    console.log(`  ║  → http://localhost:${PORT}                 ║`);
    console.log(`  ╚══════════════════════════════════════════╝\n`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

