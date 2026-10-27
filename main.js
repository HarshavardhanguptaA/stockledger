const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database/database');
const bcrypt = require('bcryptjs');

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception in main process:', error);
  try {
    dialog.showErrorBox(
      'Unexpected System Error',
      `An unexpected error occurred in the application:\n\n${error.stack || error.message || error}\n\nThe application will now relaunch to ensure stability.`
    );
    app.relaunch();
    app.exit(1);
  } catch (e) {
    console.error('Failed to show error box or relaunch:', e);
    process.exit(1);
  }
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  try {
    dialog.showErrorBox(
      'System Warning',
      `A background operation failed:\n\n${reason?.stack || reason?.message || reason}`
    );
  } catch (e) {
    console.error('Failed to show unhandled rejection error box:', e);
  }
});

// Helper: validate and sanitize finite number
function validateFiniteNumber(val, min = 0, name = 'Number') {
  const num = Number(val);
  if (!Number.isFinite(num)) {
    throw new Error(`${name} must be a valid finite number.`);
  }
  if (num < min) {
    throw new Error(`${name} cannot be less than ${min}.`);
  }
  return Math.round((num + Number.EPSILON) * 100) / 100;
}


let mainWindow;
let currentUserSession = null;

// Ensure receipts directory exists
const receiptsDir = path.join(app.getPath('userData'), 'receipts');
if (!fs.existsSync(receiptsDir)) {
  fs.mkdirSync(receiptsDir, { recursive: true });
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const isDev = !app.isPackaged || process.argv.includes('--debug');
  mainWindow = new BrowserWindow({
    title: 'StockLedger — Inventory Management System',
    width: 1366,
    height: 900,
    minWidth: 1100,
    minHeight: 768,
    icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'pages', 'login.html'));

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
 if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
 if (mainWindow === null) createWindow();
});

// Helper: today string YYYY-MM-DD
function getTodayString() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Helper: local ISO string YYYY-MM-DDTHH:MM:SS
function getLocalISOString(dateInput) {
  if (dateInput) {
    return dateInput.includes('T') ? dateInput : dateInput + 'T00:00:00';
  }
  return new Date().toLocaleString('sv').replace(' ', 'T');
}

// Helper: generate receipt number RCP-YYYY-NNNN
async function generateReceiptNumber() {
 const year = new Date().getFullYear();
 const prefix = `RCP-${year}-`;
 const last = await db.queryOne(
 `SELECT receipt_number FROM receipts WHERE receipt_number LIKE ? ORDER BY receipt_number DESC LIMIT 1`,
 [prefix + '%']
 );
 let seq = 1;
 if (last && last.receipt_number) {
 const parts = last.receipt_number.split('-');
 if (parts.length >= 3) {
 seq = (parseInt(parts[2]) || 0) + 1;
 }
 }
 return prefix + String(seq).padStart(4, '0');
}

// =============================================================
// IPC – AUTH
// =============================================================

ipcMain.handle('auth:login', async (event, { username, password }) => {
 try {
 const user = await db.queryOne('SELECT * FROM users WHERE username = ?', [username]);
 if (!user) return { success: false, error: 'User does not exist.' };

 const passwordMatch = bcrypt.compareSync(password, user.password);
 if (!passwordMatch) return { success: false, error: 'Incorrect password.' };

 if (user.role !== 'admin') {
 return { success: false, error: 'Access denied. Administrator role required.' };
 }

 currentUserSession = { id: user.id, name: user.name, username: user.username, role: user.role };
 return { success: true, user: currentUserSession };
 } catch (err) {
 return { success: false, error: err.message };
 }
});

ipcMain.handle('auth:logout', async () => {
 currentUserSession = null;
 return { success: true };
});

ipcMain.handle('auth:register', async (event, { name, username, password }) => {
  try {
    if (!name || !name.trim()) return { success: false, error: 'Full name is required.' };
    if (!username || !username.trim()) return { success: false, error: 'Username is required.' };
    if (!password || password.length < 4) return { success: false, error: 'Password must be at least 4 characters long.' };

    const trimmedUsername = username.trim().toLowerCase();
    const existing = await db.queryOne('SELECT id FROM users WHERE LOWER(username) = ?', [trimmedUsername]);
    if (existing) {
      return { success: false, error: 'Username already exists. Please choose another.' };
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = await db.run(
      'INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)',
      [name.trim(), trimmedUsername, hashedPassword, 'admin']
    );

    return { success: true, id: result.lastInsertRowid };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth:getSession', async () => currentUserSession);

// =============================================================
// IPC – MATERIALS
// =============================================================

ipcMain.handle('db:getMaterials', async () => {
 try {
 return await db.query('SELECT * FROM materials WHERE is_deleted IS NULL OR is_deleted = 0 ORDER BY name ASC');
 } catch (err) { console.error(err); return []; }
});

ipcMain.handle('db:getMaterialById', async (event, id) => {
 try {
 return await db.queryOne('SELECT * FROM materials WHERE id = ? AND (is_deleted IS NULL OR is_deleted = 0)', [id]);
 } catch (err) { return null; }
});

ipcMain.handle('db:deleteMaterial', async (event, id) => {
 try {
 const now = new Date().toISOString();
 await db.run('UPDATE materials SET is_deleted = 1, deleted_at = ? WHERE id = ?', [now, id]);
 return { success: true };
 } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('db:addMaterial', async (event, { name, category, unit, current_stock, minimum_stock, rate, sku, location }) => {
  try {
    if (!name || !name.trim() || !unit) return { success: false, error: 'Product name and unit are required.' };

    // Uniqueness check
    const duplicate = await db.queryOne(
      'SELECT id FROM materials WHERE LOWER(name) = ? AND (is_deleted IS NULL OR is_deleted = 0)',
      [name.toLowerCase().trim()]
    );
    if (duplicate) return { success: false, error: `A product named "${name}" already exists.` };

    // Validate numbers
    const validRate = validateFiniteNumber(rate || 0, 0, 'Rate');
    const validStock = validateFiniteNumber(current_stock || 0, 0, 'Current stock');
    const validMinStock = validateFiniteNumber(minimum_stock || 0, 0, 'Minimum stock');

    const allowedCategories = ['Electronics', 'Hardware', 'Raw Materials', 'Packaging', 'Consumables', 'Spare Parts', 'Cement', 'Other'];
    if (category && !allowedCategories.includes(category)) {
      category = 'Other';
    }

    const autoSku = sku && sku.trim() ? sku.trim() : ('SKU-' + (category ? category.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X') : 'ITM') + '-' + Date.now().toString().slice(-4));
    const now = new Date().toISOString();

    await db.run('BEGIN TRANSACTION');
    try {
      const result = await db.run(
        `INSERT INTO materials (name, category, unit, current_stock, minimum_stock, rate, sku, location, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name.trim(), category || 'Other', unit, validStock, validMinStock, validRate, autoSku, location || 'Main Warehouse', now]
      );
      const materialId = result.lastInsertRowid;
      if (validStock > 0) {
        await db.run(
          `INSERT INTO stock_movements (material_id, movement_type, quantity, remarks, created_by, created_at, stock_direction)
          VALUES (?, 'Adjustment', ?, 'Initial stock entry', ?, ?, 'IN')`,
          [materialId, validStock, currentUserSession ? currentUserSession.name : 'Admin', now]
        );
      }
      await db.run('COMMIT');
      return { success: true, id: materialId };
    } catch (e) { await db.run('ROLLBACK'); throw e; }
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('db:updateMaterial', async (event, { id, name, category, unit, minimum_stock, rate, sku, location }) => {
  try {
    if (!id || !name || !name.trim() || !unit) return { success: false, error: 'ID, name and unit are required.' };

    // Uniqueness check
    const duplicate = await db.queryOne(
      'SELECT id FROM materials WHERE LOWER(name) = ? AND id != ? AND (is_deleted IS NULL OR is_deleted = 0)',
      [name.toLowerCase().trim(), id]
    );
    if (duplicate) return { success: false, error: `A product named "${name}" already exists.` };

    // Validate numbers
    const validRate = validateFiniteNumber(rate || 0, 0, 'Rate');
    const validMinStock = validateFiniteNumber(minimum_stock || 0, 0, 'Minimum stock');

    const allowedCategories = ['Electronics', 'Hardware', 'Raw Materials', 'Packaging', 'Consumables', 'Spare Parts', 'Cement', 'Other'];
    if (category && !allowedCategories.includes(category)) {
      category = 'Other';
    }

    if (sku) {
      await db.run(
        'UPDATE materials SET name=?, category=?, unit=?, minimum_stock=?, rate=?, sku=?, location=? WHERE id=?',
        [name.trim(), category || 'Other', unit, validMinStock, validRate, sku.trim(), location || 'Main Warehouse', id]
      );
    } else {
      await db.run(
        'UPDATE materials SET name=?, category=?, unit=?, minimum_stock=?, rate=? WHERE id=?',
        [name.trim(), category || 'Other', unit, validMinStock, validRate, id]
      );
    }
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});
}

ipcMain.handle('db:backup', async () => {
  try {
    // Run full checkpoint
    await db.run('PRAGMA wal_checkpoint(FULL);').catch((err) => {
      console.error('WAL checkpoint failed:', err);
    });

    const d = new Date();
    const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
    const filename = `stockledger-backup-${ts}.db`;

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Backup Database',
      defaultPath: filename,
      filters: [{ name: 'Database Files', extensions: ['db', 'sqlite', 'sqlite3'] }]
    });
    if (canceled || !filePath) return { success: false, error: 'Backup cancelled.' };

    const srcPath = db.dbPath;
    fs.copyFileSync(srcPath, filePath);
    const backupSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

    return { 
      success: true, 
      filePath, 
      size: (backupSize / 1024).toFixed(2) + ' KB',
      date: new Date().toISOString()
    };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('db:restore', async () => {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: 'Restore Database',
      filters: [{ name: 'Database Files', extensions: ['db', 'sqlite', 'sqlite3'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths || filePaths.length === 0) return { success: false, error: 'Restore cancelled.' };

    const selectedFile = filePaths[0];

    // Validate extension
    const ext = path.extname(selectedFile).toLowerCase();
    if (!['.db', '.sqlite', '.sqlite3'].includes(ext)) {
      return { success: false, error: 'Invalid file extension. Please select a .db or .sqlite or .sqlite3 file.' };
    }

    // Verify integrity first
    const isValid = await verifyDatabaseIntegrity(selectedFile);
    if (!isValid) {
      return { success: false, error: 'Database integrity check failed. The file is corrupted or not a valid SQLite database.' };
    }

    // Create safety backup of current database
    const destPath = db.dbPath;
    const dbDir = path.dirname(destPath);
    const d = new Date();
    const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
    const safetyFilename = `stockledger-before-restore-${ts}.db`;
    const safetyPath = path.join(dbDir, safetyFilename);

    fs.copyFileSync(destPath, safetyPath);

    // Close db connection
    await db.closeDatabase();

    try {
      // Perform restore by copying selected file to active db path
      fs.copyFileSync(selectedFile, destPath);
    } catch (copyErr) {
      // Reopen DB even if copy failed
      await db.reopenDatabase();
      throw new Error('Failed to overwrite database file: ' + copyErr.message);
    }

    // Reopen connection
    await db.reopenDatabase();

    return { success: true, message: 'Database restored successfully.' };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('db:resetDemoData', async () => {
  try {
    await db.run('PRAGMA foreign_keys = OFF');
    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM receipt_items');
      await db.run('DELETE FROM payments');
      await db.run('DELETE FROM stock_movements');
      await db.run('DELETE FROM receipts');
      await db.run('DELETE FROM customers');
      await db.run('DELETE FROM pending_bulk_orders');
      await db.run('DELETE FROM retailer_orders');
      await db.run('DELETE FROM materials');
      await db.run('DELETE FROM expenses');

      const now = new Date().toISOString();
      const materials = [
        ['Industrial PLC Controller 24V', 'Electronics', 'Units', 45, 10, 14500.00, 'SKU-ELEC-1001', 'Bay A-1', now],
        ['Precision Optical Sensor Pro', 'Electronics', 'Units', 120, 25, 3200.00, 'SKU-ELEC-1002', 'Bay A-2', now],
        ['Brushless Servo Motor 750W', 'Hardware', 'Units', 35, 8, 8900.00, 'SKU-HDW-2001', 'Bay B-1', now],
        ['Heavy-Duty Linear Actuator 12V', 'Hardware', 'Units', 60, 15, 4750.00, 'SKU-HDW-2002', 'Bay B-2', now],
        ['Copper Core Multi-Strand Wire (100m)', 'Raw Materials', 'Spools', 85, 20, 2400.00, 'SKU-RAW-3001', 'Aisle C-1', now],
        ['High-Grade Aluminum Rail 2m', 'Raw Materials', 'Pcs', 150, 30, 1150.00, 'SKU-RAW-3002', 'Rack R-1', now],
        ['Reinforced Thermoplastic Sheet', 'Raw Materials', 'Sheets', 90, 20, 1850.00, 'SKU-RAW-3003', 'Rack R-2', now],
        ['Anti-Static ESD Safe Bags (500pk)', 'Packaging', 'Boxes', 220, 40, 680.00, 'SKU-PKG-4001', 'Storage S-1', now],
        ['High-Bond Industrial Tape', 'Consumables', 'Rolls', 310, 50, 420.00, 'SKU-CON-5001', 'Storage S-2', now],
        ['Microcontroller Dev Boards STM32', 'Electronics', 'Units', 5, 20, 950.00, 'SKU-ELEC-1005', 'Bay A-3', now],
        ['Thermal Interface Pads 100mm', 'Consumables', 'Packs', 4, 15, 340.00, 'SKU-CON-5008', 'Storage S-3', now]
      ];

      for (const m of materials) {
        await db.run(
          'INSERT INTO materials (name, category, unit, current_stock, minimum_stock, rate, sku, location, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          m
        );
      }

      // Synthetic demo customers
      const demoCustomers = [
        ['Apex Manufacturing Solutions', '+1-555-0144', '100 Innovation Way, Suite 200', 'Retailer', 45000, 5000, 'apex@solutions.demo', 'TAX-APX-901', 100000, now],
        ['Nexus Robotics Corp', '+1-555-0182', '45 Tech Boulevard, Silicon Park', 'Engineer', 78000, 12000, 'procure@nexusrobotics.demo', 'TAX-NEX-402', 150000, now],
        ['Quantum Dynamics Ltd.', '+1-555-0199', '88 Industrial Crescent', 'Retailer', 32000, 0, 'contact@quantumdyn.demo', 'TAX-QNT-103', 80000, now],
        ['Horizon BuildTech Industries', '+1-555-0123', '12 Construction Hub', 'Engineer', 54000, 8000, 'orders@horizonbuild.demo', 'TAX-HB-772', 120000, now]
      ];

      for (const c of demoCustomers) {
        await db.run(
          'INSERT INTO customers (name, phone, address, customer_type, total_purchases, balance_amount, email, tax_id, credit_limit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          c
        );
      }

      // Demo Company Settings
      await db.run('DELETE FROM company_settings');
      await db.run(
        `INSERT INTO company_settings (company_name, address, phone, email, gstin, logo_path, demo_seeded)
        VALUES (?, ?, ?, ?, ?, ?, 1)`,
        ['StockLedger Global Trade Ltd.', 'Suite 400, Commerce Boulevard, Tech District', '+1 (800) 555-0199', 'contact@stockledger.io', 'US-TAX-849201', 'assets/logo.png']
      );

      await db.run('COMMIT');
      await db.run('PRAGMA foreign_keys = ON');
      return { success: true };
    } catch (e) {
      await db.run('ROLLBACK');
      await db.run('PRAGMA foreign_keys = ON');
      throw e;
    }
  } catch (err) {
    await db.run('PRAGMA foreign_keys = ON');
    return { success: false, error: err.message };
  }
});

ipcMain.handle('db:clearDemoData', async () => {
 try {
 await db.run('PRAGMA foreign_keys = OFF');
 await db.run('BEGIN TRANSACTION');
 try {
 await db.run('DELETE FROM receipt_items');
 await db.run('DELETE FROM payments');
 await db.run('DELETE FROM stock_movements');
 await db.run('DELETE FROM receipts');
 await db.run('DELETE FROM customers');
 await db.run('DELETE FROM pending_bulk_orders');
 await db.run('DELETE FROM retailer_orders');
 await db.run('DELETE FROM materials');
 await db.run('COMMIT');
 await db.run('PRAGMA foreign_keys = ON');
 return { success: true };
 } catch (e) {
 await db.run('ROLLBACK');
 await db.run('PRAGMA foreign_keys = ON');
 throw e;
 }
 } catch (err) {
 await db.run('PRAGMA foreign_keys = ON');
 return { success: false, error: err.message };
 }
});

ipcMain.handle('db:clearBusinessData', async () => {
  try {
    await db.run('PRAGMA foreign_keys = OFF');
    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM receipt_items');
      await db.run('DELETE FROM payments');
      await db.run('DELETE FROM stock_movements');
      await db.run('DELETE FROM receipts');
      await db.run('DELETE FROM customers');
      await db.run('DELETE FROM expenses');
      await db.run('UPDATE materials SET current_stock = 0');
      await db.run('COMMIT');
      await db.run('PRAGMA foreign_keys = ON');
      return { success: true };
    } catch (e) {
      await db.run('ROLLBACK');
      await db.run('PRAGMA foreign_keys = ON');
      throw e;
    }
  } catch (err) {
    await db.run('PRAGMA foreign_keys = ON');
    return { success: false, error: err.message };
  }
});

// =============================================================
// LEGACY IPC (keep for backward compat - won't break existing DB)
// =============================================================

ipcMain.handle('db:submitBulkOrder', async () => ({ success: false, error: 'Feature disabled.' }));
ipcMain.handle('db:getPendingBulkOrders', async () => []);
ipcMain.handle('db:getEngineerBulkOrders', async () => []);
ipcMain.handle('db:approveBulkOrder', async () => ({ success: false, error: 'Feature disabled.' }));
ipcMain.handle('db:rejectBulkOrder', async () => ({ success: false, error: 'Feature disabled.' }));
ipcMain.handle('db:submitRetailerOrder', async () => ({ success: false, error: 'Feature disabled.' }));
ipcMain.handle('db:getPendingRetailerOrders', async () => []);
ipcMain.handle('db:getRetailerOrders', async () => []);
ipcMain.handle('db:approveRetailerOrder', async () => ({ success: false, error: 'Feature disabled.' }));
ipcMain.handle('db:rejectRetailerOrder', async () => ({ success: false, error: 'Feature disabled.' }));
ipcMain.handle('db:getUsers', async () => {
 try { return await db.query('SELECT id, name, username, role FROM users ORDER BY name ASC'); }
 catch (err) { return []; }
});
ipcMain.handle('db:addUser', async () => ({ success: false, error: 'User management disabled.' }));

// Legacy reduceStock for backward compat
ipcMain.handle('db:reduceStock', async (event, data) => {
 return ipcMain.emit('db:stockOut', event, data);
});

// =============================================================
// RECEIPT HTML BUILDER (for PDF)
// =============================================================

function buildReceiptHtml({ receipt, items, payments, settings }) {
 const s = settings || {};
 const companyName = s.company_name || 'StockLedger Global Trade Ltd.';
 const address = s.address || '';
 const phone = s.phone || '';
 const email = s.email || '';
 const gstin = s.gstin || '';
 const date = new Date(receipt.receipt_date || receipt.created_at).toLocaleString('en-IN');
 const updatedDate = receipt.updated_at ? new Date(receipt.updated_at).toLocaleString('en-IN') : null;

 // Load logo as base64
 let logoBase64 = '';
 try {
 const logoPath = path.join(__dirname, 'assets', 'logo.png');
 if (fs.existsSync(logoPath)) {
 logoBase64 = fs.readFileSync(logoPath).toString('base64');
 }
 } catch (err) {
 console.error('Failed to read logo image:', err);
 }

 const itemsHtml = (items || []).map(item => `
 <tr>
 <td>${item.material_name || ''}</td>
 <td style="text-align:center">${item.quantity} ${item.unit || ''}</td>
 <td style="text-align:right">₹${parseFloat(item.rate || 0).toFixed(2)}</td>
 <td style="text-align:right"><strong>₹${parseFloat(item.total || 0).toFixed(2)}</strong></td>
 </tr>
 `).join('');

 // Payment History Section
 let paymentsHtml = '';
 if (payments && payments.length > 0) {
 const rows = payments.map(p => `
 <tr>
 <td style="padding:6px 10px;">${new Date(p.payment_date).toLocaleDateString('en-IN')}</td>
 <td style="padding:6px 10px;text-align:right;">₹${parseFloat(p.amount).toFixed(2)}</td>
 <td style="padding:6px 10px;">${p.remarks ? escapeHtml(p.remarks) : '-'}</td>
 </tr>
 `).join('');

 paymentsHtml = `
 <div class="section-title" style="margin-top:16px;">Payment History</div>
 <table style="font-size:12px;margin-bottom:16px;width:100%;border:1px solid #eee;">
 <thead>
 <tr style="background:#e2e8f0;color:#1a1e24;">
 <th style="padding:6px 10px;font-size:11px;">Date</th>
 <th style="padding:6px 10px;text-align:right;font-size:11px;">Amount</th>
 <th style="padding:6px 10px;font-size:11px;">Remarks</th>
 </tr>
 </thead>
 <tbody>
 ${rows}
 </tbody>
 </table>
 `;
 }

 // Calculate payment status
 let statusText = 'Pending';
 const paid = parseFloat(receipt.paid_amount || 0);
 const total = parseFloat(receipt.total_amount || 0);
 const balance = parseFloat(receipt.balance_amount || 0);

 if (balance <= 0) {
 statusText = 'Fully Paid';
 } else if (paid > 0) {
 statusText = 'Partially Paid';
 }

 const balanceStyle = balance > 0 ? 'color:#c62828;font-weight:bold' : 'color:#2e7d32;font-weight:bold';

 function escapeHtml(str) {
 if (!str) return '';
 return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
 }

 return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
 * { margin:0; padding:0; box-sizing:border-box; }
 body { font-family: 'Arial', sans-serif; font-size: 13px; color: #222; background: #fff; padding: 30px; }
 .receipt-wrapper { max-width: 700px; margin: 0 auto; border: 2px solid #ff6f00; border-radius: 8px; overflow: hidden; }
 .receipt-header { background: linear-gradient(135deg, #1a1e24, #3a404a); color: #fff; padding: 24px 30px; }
 .company-name { font-size: 26px; font-weight: bold; letter-spacing: 1px; color: #ff6f00; }
 .company-sub { font-size: 12px; color: #aaa; margin-top: 4px; letter-spacing: 0.5px; text-transform: uppercase; }
 .company-contact { font-size: 11px; color: #ccc; margin-top: 8px; line-height: 1.6; }
 .receipt-meta { background: #fff3e0; padding: 14px 30px; display: flex; justify-content: space-between; border-bottom: 2px solid #ff6f00; }
 .receipt-meta .meta-label { font-size: 11px; text-transform: uppercase; color: #888; font-weight: 600; }
 .receipt-meta .meta-value { font-size: 14px; font-weight: bold; color: #1a1e24; margin-top: 2px; }
 .receipt-body { padding: 24px 30px; }
 .section-title { font-size: 11px; text-transform: uppercase; color: #888; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
 .customer-info { margin-bottom: 20px; }
 .customer-info p { margin: 3px 0; font-size: 13px; }
 table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
 thead tr { background: #1a1e24; color: #fff; }
 thead th { padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; text-align: left; }
 tbody tr:nth-child(even) { background: #f9f9f9; }
 tbody td { padding: 10px 12px; border-bottom: 1px solid #eee; }
 .totals-box { background: #f3f5f8; border-radius: 6px; padding: 16px; margin-bottom: 20px; }
 .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
 .totals-row.grand { font-size: 16px; font-weight: bold; border-top: 2px solid #ff6f00; padding-top: 10px; margin-top: 6px; color: #ff6f00; }
 .remarks-box { background: #fffde7; border: 1px solid #ffe082; border-radius: 4px; padding: 10px; font-size: 12px; margin-bottom: 20px; }
 .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px; padding-top: 20px; border-top: 1px dashed #ccc; }
 .footer .thank-you { font-size: 13px; color: #555; font-style: italic; }
 .footer .signature { text-align: right; font-size: 12px; color: #888; }
 .signature-line { width: 150px; border-top: 1px solid #222; margin: 40px 0 4px auto; }
 .whatsapp-tag { display: inline-block; background: #25D366; color: white; font-size: 10px; padding: 2px 6px; border-radius: 10px; margin-left: 8px; }
</style>
</head>
<body>
<div class="receipt-wrapper">
 <div class="receipt-header" style="display:flex;align-items:center;justify-content:space-between;">
 <div>
 <div class="company-name">${companyName}</div>
 <div class="company-sub">Cement &amp; Raw Materials Inventory</div>
 <div class="company-contact">
 ${address ? address + '<br>' : ''}
 ${phone ? ' ' + phone + ' ' : ''}
 ${email ? ' ' + email + ' ' : ''}
 ${gstin ? 'GSTIN: ' + gstin : ''}
 </div>
 </div>
 ${logoBase64 ? `
 <div>
 <img src="data:image/jpeg;base64,${logoBase64}" style="max-height:80px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.2);" onerror="this.style.display='none';">
 </div>
 ` : ''}
 </div>

 <div class="receipt-meta">
 <div>
 <div class="meta-label">Receipt Number</div>
 <div class="meta-value">${escapeHtml(receipt.receipt_number || 'RCP-MISSING')}</div>
 </div>
 <div>
 <div class="meta-label">Date &amp; Time</div>
 <div class="meta-value">${date}${updatedDate ? `<br><span style="font-size:10px;color:#c62828;font-weight:bold;">Updated: ${updatedDate}</span>` : ''}</div>
 </div>
 <div>
 <div class="meta-label">Status</div>
 <div class="meta-value" style="color:${balance <= 0 ? '#2e7d32' : '#ff6f00'};text-transform:uppercase;">${statusText}</div>
 </div>
 </div>

 <div class="receipt-body">
 <div class="customer-info">
 <div class="section-title">Customer Details</div>
 <p><strong>Name:</strong> ${receipt.customer_name || '-'}</p>
 ${receipt.customer_phone ? `<p><strong>Phone:</strong> ${receipt.customer_phone}</p>` : ''}
 ${receipt.customer_address ? `<p><strong>Address:</strong> ${receipt.customer_address}</p>` : ''}
 </div>

 <div class="section-title">Item Details</div>
 <table>
 <thead>
 <tr>
 <th>Material</th>
 <th style="text-align:center">Qty / Unit</th>
 <th style="text-align:right">Rate</th>
 <th style="text-align:right">Amount</th>
 </tr>
 </thead>
 <tbody>
 ${itemsHtml}
 </tbody>
 </table>

 ${paymentsHtml}

 <div class="totals-box">
 <div class="totals-row"><span>Total Amount</span><span>₹${parseFloat(receipt.total_amount || 0).toFixed(2)}</span></div>
 <div class="totals-row"><span>Total Received</span><span style="color:#2e7d32">₹${parseFloat(receipt.paid_amount || 0).toFixed(2)}</span></div>
 <div class="totals-row grand"><span>Balance Due</span><span style="${balanceStyle}">₹${parseFloat(receipt.balance_amount || 0).toFixed(2)}</span></div>
 </div>

 ${receipt.remarks ? `<div class="remarks-box"><strong>Remarks:</strong> ${receipt.remarks}</div>` : ''}

 <div class="footer">
 <div class="thank-you">Thank you for doing business with ${companyName}!<br>We value your trust.</div>
 <div class="signature">
 <div class="signature-line"></div>
 <div>Authorized Signature</div>
 <div style="font-size:10px;margin-top:2px;color:#aaa">${companyName}</div>
 </div>
 </div>
 </div>
</div>
</body>
</html>`;
}

ipcMain.handle("reports:get-data", async (event, reportType, filters) => {
  try {
    return await db.getReportData(reportType, filters);
  } catch (err) {
    console.error("reports:get-data error:", err);
    throw err;
  }
});

ipcMain.handle('open-notepad', async () => {
  if (process.platform !== 'win32') {
    return { success: false, error: 'Notepad is available only on Windows.' };
  }
  try {
    const { spawn } = require('child_process');
    spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
