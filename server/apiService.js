const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../database/database');

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

// HTML escape helper
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Build Receipt HTML
function buildReceiptHtml({ receipt, items, payments, settings }) {
  const s = settings || {};
  const companyName = s.company_name || 'StockLedger Global Trade Ltd.';
  const address = s.address || '';
  const phone = s.phone || '';
  const email = s.email || '';
  const gstin = s.gstin || '';
  const date = new Date(receipt.receipt_date || receipt.created_at).toLocaleString('en-IN');
  const updatedDate = receipt.updated_at ? new Date(receipt.updated_at).toLocaleString('en-IN') : null;

  let logoBase64 = '';
  try {
    const logoPath = path.join(__dirname, '..', 'assets', 'logo.png');
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

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt ${receipt.receipt_number}</title>
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; margin: 0; padding: 24px; font-size: 13px; line-height: 1.5; }
    .receipt-box { max-width: 800px; margin: auto; padding: 30px; border: 1px solid #eee; box-shadow: 0 0 10px rgba(0, 0, 0, 0.05); }
    .header-table { width: 100%; margin-bottom: 24px; border-bottom: 2px solid #2563eb; padding-bottom: 16px; }
    .header-table td { vertical-align: top; }
    .company-name { font-size: 24px; font-weight: bold; color: #1e293b; margin: 0 0 4px 0; }
    .company-details { font-size: 12px; color: #64748b; margin: 0; }
    .receipt-title { font-size: 20px; font-weight: bold; color: #2563eb; text-align: right; margin: 0 0 4px 0; text-transform: uppercase; }
    .receipt-meta { font-size: 12px; text-align: right; color: #475569; }
    .bill-to-table { width: 100%; margin-bottom: 24px; }
    .bill-to-table td { vertical-align: top; }
    .section-title { font-size: 12px; font-weight: bold; text-transform: uppercase; color: #64748b; margin-bottom: 6px; letter-spacing: 0.5px; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .items-table th { background: #f8fafc; color: #475569; font-weight: 600; text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
    .items-table td { padding: 10px; border-bottom: 1px solid #f1f5f9; }
    .totals-table { width: 100%; margin-bottom: 24px; }
    .totals-table td { vertical-align: top; }
    .summary-box { width: 280px; margin-left: auto; border-collapse: collapse; }
    .summary-box td { padding: 6px 10px; }
    .summary-box .label { color: #64748b; }
    .summary-box .val { text-align: right; font-weight: 600; }
    .summary-box .total-row { border-top: 1px solid #e2e8f0; border-bottom: 2px solid #2563eb; font-size: 15px; color: #1e293b; }
    .status-badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; background: #e2e8f0; }
    .status-Fully.Paid { background: #dcfce7; color: #15803d; }
    .status-Partially.Paid { background: #fef9c3; color: #854d0e; }
    .status-Pending { background: #fee2e2; color: #b91c1c; }
    .footer { text-align: center; color: #94a3b8; font-size: 11px; margin-top: 36px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
    @media print {
      body { padding: 0; }
      .receipt-box { border: none; box-shadow: none; padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="max-width:800px;margin:0 auto 16px auto;text-align:right;">
    <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;">Print Receipt</button>
  </div>
  <div class="receipt-box">
    <table class="header-table">
      <tr>
        <td>
          ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" style="max-height: 48px; margin-bottom: 8px;" />` : ''}
          <div class="company-name">${escapeHtml(companyName)}</div>
          <div class="company-details">
            ${address ? `${escapeHtml(address)}<br>` : ''}
            ${phone ? `Phone: ${escapeHtml(phone)} | ` : ''}${email ? `Email: ${escapeHtml(email)}` : ''}
            ${gstin ? `<br>GSTIN/Tax ID: ${escapeHtml(gstin)}` : ''}
          </div>
        </td>
        <td>
          <div class="receipt-title">Sales Receipt</div>
          <div class="receipt-meta">
            <strong>Receipt #:</strong> ${escapeHtml(receipt.receipt_number)}<br>
            <strong>Date:</strong> ${date}<br>
            ${updatedDate ? `<strong>Updated:</strong> ${updatedDate}<br>` : ''}
            <div style="margin-top: 6px;">
              <span class="status-badge status-${statusText.replace(/\s+/g, '.')}">${statusText}</span>
            </div>
          </div>
        </td>
      </tr>
    </table>

    <table class="bill-to-table">
      <tr>
        <td style="width: 50%;">
          <div class="section-title">Billed To</div>
          <strong style="font-size: 14px; color: #1e293b;">${escapeHtml(receipt.customer_name || 'Counter Customer')}</strong><br>
          ${receipt.customer_phone ? `Phone: ${escapeHtml(receipt.customer_phone)}<br>` : ''}
          ${receipt.customer_address ? `Address: ${escapeHtml(receipt.customer_address)}<br>` : ''}
        </td>
        <td style="width: 50%;">
          <div class="section-title">Order Info</div>
          Type: ${escapeHtml(receipt.movement_type || 'Stock Out')}<br>
          Customer Type: ${escapeHtml(receipt.customer_type || 'Retailer')}
        </td>
      </tr>
    </table>

    <div class="section-title">Items Purchased</div>
    <table class="items-table">
      <thead>
        <tr>
          <th>Description / Product</th>
          <th style="text-align: center;">Quantity</th>
          <th style="text-align: right;">Unit Rate</th>
          <th style="text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <table class="totals-table">
      <tr>
        <td style="width: 50%;">
          ${receipt.remarks ? `
            <div class="section-title">Remarks</div>
            <div style="font-size: 12px; color: #475569; background: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
              ${escapeHtml(receipt.remarks)}
            </div>
          ` : ''}
          ${paymentsHtml}
        </td>
        <td style="width: 50%;">
          <table class="summary-box">
            <tr>
              <td class="label">Subtotal:</td>
              <td class="val">₹${total.toFixed(2)}</td>
            </tr>
            <tr class="total-row">
              <td class="label" style="font-weight: bold; color: #1e293b;">Total Amount:</td>
              <td class="val" style="color: #2563eb;">₹${total.toFixed(2)}</td>
            </tr>
            <tr>
              <td class="label">Amount Paid:</td>
              <td class="val" style="color: #15803d;">₹${paid.toFixed(2)}</td>
            </tr>
            <tr>
              <td class="label">Outstanding Balance:</td>
              <td class="val" style="${balanceStyle}">₹${balance.toFixed(2)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <div class="footer">
      Thank you for your business! This is a system-generated document.
    </div>
  </div>
</body>
</html>
  `;
}

// Service Object
const apiService = {
  // Database reference
  db,

  // Auth
  async login({ username, password }) {
    if (!username || !password) return { success: false, error: 'Username and password required.' };
    const user = await db.queryOne('SELECT * FROM users WHERE username = ?', [username.trim()]);
    if (!user) return { success: false, error: 'User does not exist.' };

    const passwordMatch = bcrypt.compareSync(password, user.password);
    if (!passwordMatch) return { success: false, error: 'Incorrect password.' };

    if (user.role !== 'admin') {
      return { success: false, error: 'Access denied. Administrator role required.' };
    }

    return {
      success: true,
      user: { id: user.id, name: user.name, username: user.username, role: user.role }
    };
  },

  async register({ name, username, password }) {
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
  },

  // Materials
  async getMaterials() {
    return await db.query('SELECT * FROM materials WHERE is_deleted IS NULL OR is_deleted = 0 ORDER BY name ASC');
  },

  async getMaterialById(id) {
    return await db.queryOne('SELECT * FROM materials WHERE id = ? AND (is_deleted IS NULL OR is_deleted = 0)', [id]);
  },

  async addMaterial({ name, category, unit, current_stock, minimum_stock, rate, sku, location }, currentUser = null) {
    if (!name || !name.trim() || !unit) return { success: false, error: 'Material name and unit are required.' };

    const duplicate = await db.queryOne(
      'SELECT id FROM materials WHERE LOWER(name) = ? AND (is_deleted IS NULL OR is_deleted = 0)',
      [name.toLowerCase().trim()]
    );
    if (duplicate) return { success: false, error: `A material named "${name}" already exists.` };

    const validRate = validateFiniteNumber(rate || 0, 0, 'Rate');
    const validStock = validateFiniteNumber(current_stock || 0, 0, 'Current stock');
    const validMinStock = validateFiniteNumber(minimum_stock || 0, 0, 'Minimum stock');

    const allowedCategories = ['Electronics', 'Hardware', 'Raw Materials', 'Packaging', 'Consumables', 'Spare Parts', 'Cement', 'Other'];
    if (category && !allowedCategories.includes(category)) {
      category = 'Other';
    }
    const now = new Date().toISOString();
    await db.run('BEGIN TRANSACTION');
    try {
      const result = sku ? await db.run(
        `INSERT INTO materials (name, category, unit, current_stock, minimum_stock, rate, sku, location, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name.trim(), category || 'Other', unit, validStock, validMinStock, validRate, sku.trim(), location || 'Main Warehouse', now]
      ) : await db.run(
        `INSERT INTO materials (name, category, unit, current_stock, minimum_stock, rate, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name.trim(), category || 'Other', unit, validStock, validMinStock, validRate, now]
      );
      const materialId = result.lastInsertRowid;
      if (validStock > 0) {
        await db.run(
          `INSERT INTO stock_movements (material_id, movement_type, quantity, remarks, created_by, created_at, stock_direction)
           VALUES (?, 'Adjustment', ?, 'Initial stock entry', ?, ?, 'IN')`,
          [materialId, validStock, currentUser ? currentUser.name : 'Admin', now]
        );
      }
      await db.run('COMMIT');
      return { success: true, id: materialId };
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  },

  async updateMaterial({ id, name, category, unit, minimum_stock, rate, sku, location }) {
    if (!id || !name || !name.trim() || !unit) return { success: false, error: 'ID, name and unit are required.' };

    const duplicate = await db.queryOne(
      'SELECT id FROM materials WHERE LOWER(name) = ? AND id != ? AND (is_deleted IS NULL OR is_deleted = 0)',
      [name.toLowerCase().trim(), id]
    );
    if (duplicate) return { success: false, error: `A material named "${name}" already exists.` };

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
  },

  async deleteMaterial(id) {
    const now = new Date().toISOString();
    await db.run('UPDATE materials SET is_deleted = 1, deleted_at = ? WHERE id = ?', [now, id]);
    return { success: true };
  },

  // Stock
  async addStock({ material_id, quantity, supplier_name, invoice_number, vehicle_number, remarks, date }, currentUser = null) {
    if (!material_id) return { success: false, error: 'Select a valid material.' };

    const validQty = validateFiniteNumber(quantity, 0.00001, 'Quantity');
    const material = await db.queryOne('SELECT name FROM materials WHERE id = ?', [material_id]);
    if (!material) return { success: false, error: 'Material not found.' };

    const timestamp = getLocalISOString(date);
    const addedBy = currentUser ? currentUser.name : 'Admin';

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('UPDATE materials SET current_stock = current_stock + ? WHERE id = ?', [validQty, material_id]);
      await db.run(
        `INSERT INTO stock_movements (material_id, movement_type, quantity, supplier_name, invoice_number, vehicle_number, remarks, created_by, created_at, stock_direction)
         VALUES (?, 'Stock In', ?, ?, ?, ?, ?, ?, ?, 'IN')`,
        [material_id, validQty, supplier_name || '', invoice_number || '', vehicle_number || '', remarks || '', addedBy, timestamp]
      );
      await db.run('COMMIT');
      return { success: true };
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  },

  async stockOut({
    material_id, quantity, customer_name, customer_phone, customer_address,
    customer_type, rate, total_amount, paid_amount, balance_amount, remarks, date
  }, currentUser = null) {
    if (!material_id) return { success: false, error: 'Select a valid material.' };
    if (!customer_name || !customer_name.trim()) return { success: false, error: 'Customer name is required.' };

    const validQty = validateFiniteNumber(quantity, 0.00001, 'Quantity');
    const validRate = validateFiniteNumber(rate, 0, 'Rate');
    const validTotal = validateFiniteNumber(total_amount, 0, 'Total Amount');
    const validPaid = validateFiniteNumber(paid_amount, 0, 'Paid Amount');
    const validBalance = validateFiniteNumber(balance_amount, 0, 'Balance Amount');

    if (validPaid > validTotal && validTotal > 0) {
      return { success: false, error: 'Paid amount cannot exceed total amount.' };
    }

    const material = await db.queryOne('SELECT * FROM materials WHERE id = ?', [material_id]);
    if (!material) return { success: false, error: 'Material not found.' };
    if (material.current_stock < validQty) {
      return { success: false, error: `Insufficient stock! ${material.name} only has ${material.current_stock} ${material.unit} available (requested: ${validQty}).` };
    }

    const timestamp = getLocalISOString(date);
    const doneBy = currentUser ? currentUser.name : 'Admin';
    const now = getLocalISOString();

    await db.run('BEGIN TRANSACTION');
    try {
      let customerId = null;
      let existingCust = null;
      if (customer_phone && customer_phone.trim() !== '') {
        existingCust = await db.queryOne(
          'SELECT id, customer_type FROM customers WHERE phone = ? AND (is_deleted IS NULL OR is_deleted = 0)',
          [customer_phone.trim()]
        );
      } else if (customer_name) {
        const addr = customer_address ? customer_address.trim() : '';
        existingCust = await db.queryOne(
          'SELECT id, customer_type FROM customers WHERE name = ? AND COALESCE(address, "") = ? AND (phone IS NULL OR phone = "") AND (is_deleted IS NULL OR is_deleted = 0)',
          [customer_name.trim(), addr]
        );
      }

      if (existingCust) {
        customerId = existingCust.id;
        await db.run(
          'UPDATE customers SET total_purchases = total_purchases + ?, balance_amount = balance_amount + ?, customer_type = ? WHERE id = ?',
          [validTotal, validBalance, customer_type || 'Retailer', customerId]
        );
      } else {
        const custResult = await db.run(
          `INSERT INTO customers (name, phone, address, total_purchases, balance_amount, customer_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [customer_name.trim(), customer_phone || '', customer_address || '', validTotal, validBalance, customer_type || 'Retailer', now]
        );
        customerId = custResult.lastInsertRowid;
      }

      await db.run('UPDATE materials SET current_stock = current_stock - ? WHERE id = ?', [validQty, material_id]);

      const receiptNumber = await generateReceiptNumber();

      const receiptResult = await db.run(
        `INSERT INTO receipts (receipt_number, customer_id, customer_name, customer_phone, customer_address, receipt_date, total_amount, paid_amount, balance_amount, remarks, movement_type, customer_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [receiptNumber, customerId, customer_name.trim(), customer_phone || '', customer_address || '',
        timestamp, validTotal, validPaid, validBalance, remarks || '', customer_type || 'Stock Out', customer_type || 'Retailer', now]
      );
      const receiptId = receiptResult.lastInsertRowid;

      if (validPaid > 0) {
        await db.run(
          `INSERT INTO payments (receipt_id, payment_date, amount, remarks, created_at)
           VALUES (?, ?, ?, 'Initial payment', ?)`,
          [receiptId, timestamp, validPaid, now]
        );
      }

      await db.run(
        `INSERT INTO receipt_items (receipt_id, material_id, material_name, quantity, unit, rate, total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [receiptId, material_id, material.name, validQty, material.unit, validRate, validTotal]
      );

      await db.run(
        `INSERT INTO stock_movements (material_id, movement_type, quantity, customer_id, customer_name, receipt_id, rate, total_amount, paid_amount, balance_amount, remarks, created_by, created_at, stock_direction, customer_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OUT', ?)`,
        [material_id, customer_type || 'Stock Out', validQty, customerId, customer_name.trim(),
        receiptId, validRate, validTotal, validPaid, validBalance,
        remarks || '', doneBy, timestamp, customer_type || 'Retailer']
      );

      await db.run('COMMIT');
      return { success: true, receiptId, receiptNumber };
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  },

  async getStockMovements(filters = {}) {
    let sql = `
      SELECT sm.*, m.name as material_name, m.unit as material_unit
      FROM stock_movements sm
      JOIN materials m ON sm.material_id = m.id
      WHERE (sm.is_deleted IS NULL OR sm.is_deleted = 0)
    `;
    const params = [];
    if (filters) {
      if (filters.material_id) { sql += ' AND sm.material_id = ?'; params.push(filters.material_id); }
      if (filters.movement_type && filters.movement_type !== 'All') { sql += ' AND sm.movement_type = ?'; params.push(filters.movement_type); }
      if (filters.from_date) { sql += ' AND date(sm.created_at) >= date(?)'; params.push(filters.from_date); }
      if (filters.to_date) { sql += ' AND date(sm.created_at) <= date(?)'; params.push(filters.to_date); }
    }
    sql += ' ORDER BY sm.created_at DESC, sm.id DESC';
    return await db.query(sql, params);
  },

  async deleteStockMovement(id) {
    const sm = await db.queryOne('SELECT * FROM stock_movements WHERE id = ?', [id]);
    if (!sm) return { success: false, error: 'Stock movement not found.' };

    if (sm.receipt_id) {
      return { success: false, error: 'This stock movement is linked to a receipt. Please delete the receipt instead.' };
    }

    await db.run('BEGIN TRANSACTION');
    try {
      const now = getLocalISOString();
      await db.run('UPDATE stock_movements SET is_deleted = 1, deleted_at = ? WHERE id = ?', [now, id]);

      let dir = sm.stock_direction;
      if (!dir) {
        if (sm.movement_type === 'Stock In') {
          dir = 'IN';
        } else if (['Customer Sale', 'Direct Sale', 'Stock Out', 'Site Usage', 'Damaged Stock'].includes(sm.movement_type)) {
          dir = 'OUT';
        } else if (sm.movement_type === 'Adjustment') {
          dir = 'IN';
        }
      }

      if (dir === 'IN') {
        const mat = await db.queryOne('SELECT current_stock, name FROM materials WHERE id = ?', [sm.material_id]);
        if (mat && (mat.current_stock - sm.quantity < 0)) {
          throw new Error(`Cannot reverse stock. Reversing this entry would make stock for '${mat.name}' negative.`);
        }
        await db.run('UPDATE materials SET current_stock = current_stock - ? WHERE id = ?', [sm.quantity, sm.material_id]);
      } else if (dir === 'OUT') {
        await db.run('UPDATE materials SET current_stock = current_stock + ? WHERE id = ?', [sm.quantity, sm.material_id]);
      }

      await db.run('COMMIT');
      return { success: true };
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  },

  // Customers
  async getCustomers() {
    return await db.query(`
      SELECT c.*, 
             (SELECT MAX(COALESCE(receipt_date, created_at)) 
              FROM receipts 
              WHERE customer_id = c.id AND (is_deleted IS NULL OR is_deleted = 0)) as last_sale_date
      FROM customers c
      WHERE (c.is_deleted IS NULL OR c.is_deleted = 0)
      ORDER BY c.name ASC
    `);
  },

  async getCustomerById(id) {
    return await db.queryOne(`
      SELECT c.*, 
             (SELECT MAX(COALESCE(receipt_date, created_at)) 
              FROM receipts 
              WHERE customer_id = c.id AND (is_deleted IS NULL OR is_deleted = 0)) as last_sale_date
      FROM customers c
      WHERE c.id = ? AND (c.is_deleted IS NULL OR c.is_deleted = 0)
    `, [id]);
  },

  async addCustomer({ name, phone, address, customer_type }) {
    if (!name) return { success: false, error: 'Customer name is required.' };
    const now = getLocalISOString();
    const result = await db.run(
      'INSERT INTO customers (name, phone, address, total_purchases, balance_amount, customer_type, created_at) VALUES (?, ?, ?, 0, 0, ?, ?)',
      [name, phone || '', address || '', customer_type || 'Retailer', now]
    );
    return { success: true, id: result.lastInsertRowid };
  },

  async updateCustomer({ id, name, phone, address, customer_type }) {
    if (!id || !name) return { success: false, error: 'ID and name required.' };
    await db.run('UPDATE customers SET name=?, phone=?, address=?, customer_type=? WHERE id=?', [name, phone || '', address || '', customer_type || 'Retailer', id]);
    return { success: true };
  },

  async deleteCustomer(id) {
    const now = getLocalISOString();
    await db.run('UPDATE customers SET is_deleted = 1, deleted_at = ? WHERE id = ?', [now, id]);
    return { success: true };
  },

  async getCustomerHistory(customerId) {
    return await db.query(
      `SELECT r.id as receipt_id, r.receipt_number, COALESCE(r.receipt_date, r.created_at) as receipt_date,
              r.total_amount, r.paid_amount, r.balance_amount, r.pdf_path,
              ri.material_name, ri.quantity, ri.unit
       FROM receipts r
       LEFT JOIN receipt_items ri ON ri.receipt_id = r.id
       WHERE r.customer_id = ? AND (r.is_deleted IS NULL OR r.is_deleted = 0)
       ORDER BY COALESCE(r.receipt_date, r.created_at) DESC, r.id DESC`,
      [customerId]
    );
  },

  // Receipts
  async getReceipts(filters = {}) {
    let sql = `
      SELECT r.*, c.phone as cust_phone,
      (SELECT GROUP_CONCAT(ri.material_name || ' ×' || ri.quantity || ' ' || COALESCE(ri.unit, '')) 
       FROM receipt_items ri WHERE ri.receipt_id = r.id) as products_purchased
      FROM receipts r
      LEFT JOIN customers c ON r.customer_id = c.id
      WHERE (r.is_deleted IS NULL OR r.is_deleted = 0)
    `;
    const params = [];
    if (filters) {
      if (filters.customer_name) { sql += ' AND r.customer_name LIKE ?'; params.push(`%${filters.customer_name}%`); }
      if (filters.from_date) { sql += ' AND date(COALESCE(r.receipt_date, r.created_at)) >= date(?)'; params.push(filters.from_date); }
      if (filters.to_date) { sql += ' AND date(COALESCE(r.receipt_date, r.created_at)) <= date(?)'; params.push(filters.to_date); }
    }
    sql += ' ORDER BY COALESCE(r.receipt_date, r.created_at) DESC';
    return await db.query(sql, params);
  },

  async getReceiptById(id) {
    const receipt = await db.queryOne('SELECT * FROM receipts WHERE id = ? AND (is_deleted IS NULL OR is_deleted = 0)', [id]);
    if (!receipt) return null;
    const items = await db.query('SELECT * FROM receipt_items WHERE receipt_id = ?', [id]);
    const payments = await db.query('SELECT * FROM payments WHERE receipt_id = ? ORDER BY id ASC', [id]);
    return { ...receipt, items, payments };
  },

  async getReceiptByNumber(receiptNumber) {
    const receipt = await db.queryOne('SELECT * FROM receipts WHERE receipt_number = ? AND (is_deleted IS NULL OR is_deleted = 0)', [receiptNumber]);
    if (!receipt) return null;
    const items = await db.query('SELECT * FROM receipt_items WHERE receipt_id = ?', [receipt.id]);
    return { ...receipt, items };
  },

  async deleteReceipt(id) {
    const receipt = await db.queryOne('SELECT * FROM receipts WHERE id = ?', [id]);
    if (!receipt) return { success: false, error: 'Receipt not found.' };

    await db.run('BEGIN TRANSACTION');
    try {
      const now = getLocalISOString();
      await db.run('UPDATE receipts SET is_deleted = 1, deleted_at = ? WHERE id = ?', [now, id]);
      await db.run('DELETE FROM payments WHERE receipt_id = ?', [id]);

      const movements = await db.query('SELECT * FROM stock_movements WHERE receipt_id = ? AND (is_deleted IS NULL OR is_deleted = 0)', [id]);
      for (const sm of movements) {
        await db.run('UPDATE stock_movements SET is_deleted = 1, deleted_at = ? WHERE id = ?', [now, sm.id]);

        let dir = sm.stock_direction;
        if (!dir) {
          if (sm.movement_type === 'Stock In') {
            dir = 'IN';
          } else if (['Customer Sale', 'Direct Sale', 'Stock Out', 'Site Usage', 'Damaged Stock'].includes(sm.movement_type)) {
            dir = 'OUT';
          } else if (sm.movement_type === 'Adjustment') {
            dir = 'IN';
          }
        }

        if (dir === 'IN') {
          const mat = await db.queryOne('SELECT current_stock, name FROM materials WHERE id = ?', [sm.material_id]);
          if (mat && (mat.current_stock - sm.quantity < 0)) {
            throw new Error(`Cannot delete receipt. Reversing stock movement for '${mat.name}' would make stock negative.`);
          }
          await db.run('UPDATE materials SET current_stock = current_stock - ? WHERE id = ?', [sm.quantity, sm.material_id]);
        } else if (dir === 'OUT') {
          await db.run('UPDATE materials SET current_stock = current_stock + ? WHERE id = ?', [sm.quantity, sm.material_id]);
        }
      }

      if (receipt.customer_id) {
        const cust = await db.queryOne('SELECT total_purchases, balance_amount FROM customers WHERE id = ?', [receipt.customer_id]);
        if (cust) {
          const newPurchases = Math.max(0, (cust.total_purchases || 0) - (receipt.total_amount || 0));
          const newBalance = Math.max(0, (cust.balance_amount || 0) - (receipt.balance_amount || 0));
          await db.run(
            'UPDATE customers SET total_purchases = ?, balance_amount = ? WHERE id = ?',
            [newPurchases, newBalance, receipt.customer_id]
          );
        }
      }

      await db.run('COMMIT');
      return { success: true };
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  },

  async updateReceiptPdfPath({ id, pdf_path }) {
    await db.run('UPDATE receipts SET pdf_path = ? WHERE id = ?', [pdf_path, id]);
    return { success: true };
  },

  async markWhatsappSent(id) {
    await db.run('UPDATE receipts SET whatsapp_sent = 1 WHERE id = ?', [id]);
    return { success: true };
  },

  async addPayment({ receipt_id, amount, remarks, date }) {
    if (!receipt_id) return { success: false, error: 'Invalid receipt ID.' };
    const validAmount = validateFiniteNumber(amount, 0.01, 'Payment amount');

    const receipt = await db.queryOne('SELECT * FROM receipts WHERE id = ? AND (is_deleted IS NULL OR is_deleted = 0)', [receipt_id]);
    if (!receipt) return { success: false, error: 'Receipt not found.' };

    const remaining = Math.round(((receipt.total_amount - receipt.paid_amount) + Number.EPSILON) * 100) / 100;
    if (validAmount > remaining) {
      return { success: false, error: `Payment amount (₹${validAmount.toFixed(2)}) exceeds remaining balance (₹${remaining.toFixed(2)}).` };
    }

    const timestamp = getLocalISOString(date);
    const now = getLocalISOString();

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run(
        `INSERT INTO payments (receipt_id, payment_date, amount, remarks, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [receipt_id, timestamp, validAmount, remarks || '', now]
      );

      const newPaid = Math.round(((receipt.paid_amount + validAmount) + Number.EPSILON) * 100) / 100;
      const newBalance = Math.round(((receipt.total_amount - newPaid) + Number.EPSILON) * 100) / 100;
      await db.run(
        'UPDATE receipts SET paid_amount = ?, balance_amount = ?, updated_at = ? WHERE id = ?',
        [newPaid, newBalance, now, receipt_id]
      );

      if (receipt.customer_id) {
        const custReceipts = await db.query(
          'SELECT SUM(balance_amount) as total_balance FROM receipts WHERE customer_id = ? AND (is_deleted IS NULL OR is_deleted = 0)',
          [receipt.customer_id]
        );
        const newCustBalance = custReceipts[0]?.total_balance || 0;
        await db.run('UPDATE customers SET balance_amount = ? WHERE id = ?', [newCustBalance, receipt.customer_id]);
      }

      await db.run('COMMIT');
      return { success: true };
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  },

  async addCustomerPayment({ customer_id, amount, remarks, date }) {
    if (!customer_id) return { success: false, error: 'Invalid customer ID.' };
    const validAmount = validateFiniteNumber(amount, 0.01, 'Payment amount');

    const customer = await db.queryOne('SELECT * FROM customers WHERE id = ? AND (is_deleted IS NULL OR is_deleted = 0)', [customer_id]);
    if (!customer) return { success: false, error: 'Customer not found.' };

    const currentBalance = Math.round(((customer.balance_amount || 0) + Number.EPSILON) * 100) / 100;
    if (currentBalance <= 0) {
      return { success: false, error: 'Customer has no outstanding balance to pay.' };
    }
    if (validAmount > currentBalance) {
      return { success: false, error: `Payment amount (₹${validAmount.toFixed(2)}) exceeds outstanding balance (₹${currentBalance.toFixed(2)}).` };
    }

    const timestamp = getLocalISOString(date);
    const now = getLocalISOString();

    const unpaidReceipts = await db.query(
      `SELECT * FROM receipts 
       WHERE customer_id = ? AND balance_amount > 0 AND (is_deleted IS NULL OR is_deleted = 0)
       ORDER BY COALESCE(receipt_date, created_at) ASC, id ASC`,
      [customer_id]
    );

    await db.run('BEGIN TRANSACTION');
    try {
      let remainingPayment = validAmount;

      for (const r of unpaidReceipts) {
        if (remainingPayment <= 0) break;
        const recBalance = Math.round(((r.balance_amount || 0) + Number.EPSILON) * 100) / 100;
        const toApply = Math.round((Math.min(remainingPayment, recBalance) + Number.EPSILON) * 100) / 100;

        await db.run(
          `INSERT INTO payments (receipt_id, payment_date, amount, remarks, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [r.id, timestamp, toApply, remarks || 'Customer outstanding payment', now]
        );

        const newPaid = Math.round(((r.paid_amount + toApply) + Number.EPSILON) * 100) / 100;
        const newBalance = Math.round(((r.total_amount - newPaid) + Number.EPSILON) * 100) / 100;
        await db.run(
          'UPDATE receipts SET paid_amount = ?, balance_amount = ?, updated_at = ? WHERE id = ?',
          [newPaid, newBalance, now, r.id]
        );

        remainingPayment = Math.round(((remainingPayment - toApply) + Number.EPSILON) * 100) / 100;
      }

      const custReceipts = await db.query(
        'SELECT SUM(balance_amount) as total_balance FROM receipts WHERE customer_id = ? AND (is_deleted IS NULL OR is_deleted = 0)',
        [customer_id]
      );
      let newCustBalance = custReceipts[0]?.total_balance;
      if (newCustBalance === null || newCustBalance === undefined) {
        newCustBalance = Math.max(0, currentBalance - validAmount);
      } else {
        newCustBalance = Math.round(((newCustBalance) + Number.EPSILON) * 100) / 100;
      }
      await db.run('UPDATE customers SET balance_amount = ? WHERE id = ?', [newCustBalance, customer_id]);

      await db.run('COMMIT');
      return { success: true };
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  },

  // Company Settings
  async getCompanySettings() {
    const settings = await db.queryOne('SELECT * FROM company_settings LIMIT 1');
    return settings || {
      company_name: 'StockLedger Global Trade Ltd.',
      address: 'Tech Park, Suite 400, Innovation Way',
      phone: '+1 555-019-2834',
      email: 'contact@stockledger.io',
      gstin: 'TAX-US-98234-X',
      logo_path: 'assets/logo.png'
    };
  },

  async saveCompanySettings({ company_name, address, phone, email, gstin, logo_path }) {
    if (!company_name || company_name.trim() === '') {
      return { success: false, error: 'Company Name is required.' };
    }
    const existing = await db.queryOne('SELECT id FROM company_settings LIMIT 1');
    if (existing) {
      await db.run(
        'UPDATE company_settings SET company_name=?, address=?, phone=?, email=?, gstin=?, logo_path=? WHERE id=?',
        [company_name.trim(), address, phone, email, gstin, logo_path, existing.id]
      );
    } else {
      await db.run(
        'INSERT INTO company_settings (company_name, address, phone, email, gstin, logo_path) VALUES (?,?,?,?,?,?)',
        [company_name.trim(), address, phone, email, gstin, logo_path]
      );
    }
    return { success: true };
  },

  // Dashboard Stats
  async getDashboardStats() {
    const today = getTodayString();
    const todayPrefix = today + '%';
    const [
      cementBagsAvailable,
      lowCementStockCount,
      todaySalesAmount,
      totalOutstanding,
      totalReceipts,
      todayExpenseVal
    ] = await Promise.all([
      db.queryOne("SELECT SUM(current_stock) as t FROM materials WHERE (is_deleted IS NULL OR is_deleted = 0) AND category = 'Cement'"),
      db.queryOne("SELECT COUNT(*) as c FROM materials WHERE (is_deleted IS NULL OR is_deleted = 0) AND category = 'Cement' AND current_stock <= minimum_stock"),
      db.queryOne("SELECT SUM(total_amount) as t FROM receipts WHERE (is_deleted IS NULL OR is_deleted = 0) AND created_at LIKE ?", [todayPrefix]),
      db.queryOne("SELECT SUM(balance_amount) as t FROM receipts WHERE (is_deleted IS NULL OR is_deleted = 0)"),
      db.queryOne("SELECT COUNT(*) as c FROM receipts WHERE (is_deleted IS NULL OR is_deleted = 0)"),
      db.queryOne("SELECT SUM(amount) as t FROM expenses WHERE (is_deleted = 0 OR is_deleted IS NULL) AND DATE(COALESCE(expense_date, created_at)) = DATE('now', 'localtime')")
    ]);

    const [recentSales, cementStockSummary, lowStockMaterials] = await Promise.all([
      db.query("SELECT r.* FROM receipts r WHERE (r.is_deleted IS NULL OR r.is_deleted = 0) ORDER BY COALESCE(r.receipt_date, r.created_at) DESC LIMIT 5"),
      db.query("SELECT name, current_stock, unit FROM materials WHERE (is_deleted IS NULL OR is_deleted = 0) AND category = 'Cement' ORDER BY name ASC"),
      db.query("SELECT name, current_stock, minimum_stock, unit FROM materials WHERE (is_deleted IS NULL OR is_deleted = 0) AND current_stock <= minimum_stock ORDER BY name ASC LIMIT 10")
    ]);

    return {
      cementBagsAvailable: cementBagsAvailable?.t || 0,
      lowCementStockCount: lowCementStockCount?.c || 0,
      todaySalesAmount: todaySalesAmount?.t || 0,
      totalOutstanding: totalOutstanding?.t || 0,
      totalReceipts: totalReceipts?.c || 0,
      todayExpenses: todayExpenseVal?.t || 0,
      recentSales: recentSales || [],
      cementStockSummary: cementStockSummary || [],
      lowStockMaterials: lowStockMaterials || []
    };
  },

  // Reports
  async getReports(filters = {}) {
    let sql = 'SELECT * FROM receipts WHERE (is_deleted IS NULL OR is_deleted = 0)';
    const params = [];
    if (filters) {
      if (filters.from_date) { sql += ' AND date(COALESCE(receipt_date, created_at)) >= date(?)'; params.push(filters.from_date); }
      if (filters.to_date) { sql += ' AND date(COALESCE(receipt_date, created_at)) <= date(?)'; params.push(filters.to_date); }
      if (filters.customer_type && filters.customer_type !== 'All') { sql += ' AND customer_type = ?'; params.push(filters.customer_type); }
    }
    sql += ' ORDER BY COALESCE(receipt_date, created_at) DESC';
    return await db.query(sql, params);
  },

  async getReportsData({ from_date, to_date }) {
    const fromISO = from_date;
    const toISO = to_date;

    const [salesTotal, salesPaid, salesBalance, salesCount, salesRows] = await Promise.all([
      db.queryOne('SELECT SUM(total_amount) as t FROM receipts WHERE (is_deleted IS NULL OR is_deleted = 0) AND date(COALESCE(receipt_date, created_at)) >= date(?) AND date(COALESCE(receipt_date, created_at)) <= date(?)', [fromISO, toISO]),
      db.queryOne('SELECT SUM(paid_amount) as t FROM receipts WHERE (is_deleted IS NULL OR is_deleted = 0) AND date(COALESCE(receipt_date, created_at)) >= date(?) AND date(COALESCE(receipt_date, created_at)) <= date(?)', [fromISO, toISO]),
      db.queryOne('SELECT SUM(balance_amount) as t FROM receipts WHERE (is_deleted IS NULL OR is_deleted = 0) AND date(COALESCE(receipt_date, created_at)) >= date(?) AND date(COALESCE(receipt_date, created_at)) <= date(?)', [fromISO, toISO]),
      db.queryOne('SELECT COUNT(*) as c FROM receipts WHERE (is_deleted IS NULL OR is_deleted = 0) AND date(COALESCE(receipt_date, created_at)) >= date(?) AND date(COALESCE(receipt_date, created_at)) <= date(?)', [fromISO, toISO]),
      db.query('SELECT * FROM receipts WHERE (is_deleted IS NULL OR is_deleted = 0) AND date(COALESCE(receipt_date, created_at)) >= date(?) AND date(COALESCE(receipt_date, created_at)) <= date(?) ORDER BY COALESCE(receipt_date, created_at) DESC', [fromISO, toISO])
    ]);

    const [stockMovements, lowStockMaterials] = await Promise.all([
      db.query(
        `SELECT sm.*, m.name as material_name, m.unit as material_unit 
         FROM stock_movements sm 
         JOIN materials m ON sm.material_id = m.id 
         WHERE (sm.is_deleted IS NULL OR sm.is_deleted = 0) 
           AND date(sm.created_at) >= date(?) AND date(sm.created_at) <= date(?) 
         ORDER BY sm.created_at DESC`,
        [fromISO, toISO]
      ),
      db.query('SELECT * FROM materials WHERE (is_deleted IS NULL OR is_deleted = 0) AND current_stock <= minimum_stock ORDER BY name ASC')
    ]);

    const customerSummary = await db.query(
      `SELECT c.id, c.name, c.phone, c.customer_type, c.total_purchases, c.balance_amount,
              COUNT(r.id) as orders_count,
              MAX(COALESCE(r.receipt_date, r.created_at)) as last_purchase_date
       FROM customers c
       LEFT JOIN receipts r ON r.customer_id = c.id AND (r.is_deleted IS NULL OR r.is_deleted = 0)
       WHERE (c.is_deleted IS NULL OR c.is_deleted = 0)
       GROUP BY c.id
       ORDER BY c.total_purchases DESC`
    );

    return {
      sales: {
        totalAmount: salesTotal?.t || 0,
        paidAmount: salesPaid?.t || 0,
        balanceAmount: salesBalance?.t || 0,
        receiptCount: salesCount?.c || 0,
        rows: salesRows || []
      },
      stock: {
        movements: stockMovements || [],
        lowStock: lowStockMaterials || []
      },
      customers: customerSummary || []
    };
  },

  async getReportData(reportType, filters = {}) {
    return await db.getReportData(reportType, filters);
  },

  // Categories & Units
  async getCategories() {
    const rows = await db.query("SELECT DISTINCT category FROM materials WHERE category IS NOT NULL AND category != '' AND (is_deleted IS NULL OR is_deleted = 0) ORDER BY category ASC");
    return rows.map(r => r.category);
  },

  async getUnits() {
    const rows = await db.query("SELECT DISTINCT unit FROM materials WHERE unit IS NOT NULL AND unit != '' AND (is_deleted IS NULL OR is_deleted = 0) ORDER BY unit ASC");
    return rows.map(r => r.unit);
  },

  // System Health
  async getSystemHealth() {
    const dbFilePath = db.dbPath;
    let dbSize = 0;
    if (fs.existsSync(dbFilePath)) {
      dbSize = fs.statSync(dbFilePath).size;
    }

    const [cust, mat, rcp, vExp, pExp] = await Promise.all([
      db.queryOne('SELECT COUNT(*) as c FROM customers WHERE is_deleted IS NULL OR is_deleted = 0'),
      db.queryOne('SELECT COUNT(*) as c FROM materials WHERE is_deleted IS NULL OR is_deleted = 0'),
      db.queryOne('SELECT COUNT(*) as c FROM receipts WHERE is_deleted IS NULL OR is_deleted = 0'),
      db.queryOne('SELECT COUNT(*) as c FROM vehicle_expenses'),
      db.queryOne('SELECT COUNT(*) as c FROM personal_expenses')
    ]);

    return {
      dbSize: (dbSize / 1024).toFixed(2) + ' KB',
      customerCount: cust?.c || 0,
      productCount: mat?.c || 0,
      salesCount: rcp?.c || 0,
      receiptsCount: rcp?.c || 0,
      expensesCount: (vExp?.c || 0) + (pExp?.c || 0)
    };
  },

  // Reset / Clear Data
  async resetDemoData() {
    await db.run('PRAGMA foreign_keys = OFF');
    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM receipt_items');
      await db.run('DELETE FROM payments');
      await db.run('DELETE FROM stock_movements');
      await db.run('DELETE FROM receipts');
      await db.run('DELETE FROM customers');
      await db.run('DELETE FROM materials');

      const now = new Date().toISOString();
      const materials = [
        ['UltraTech Cement OPC 53', 'Cement', 'Bags', 500, 100, 380, now],
        ['Ramco Supergrade PPC', 'Cement', 'Bags', 400, 100, 360, now],
        ['Crushed Limestone Coarse', 'Raw Materials', 'Tons', 50, 10, 1200, now],
        ['Natural Gypsum Granules', 'Raw Materials', 'Tons', 15, 3, 800, now],
        ['Fine River Sand', 'Raw Materials', 'Tons', 80, 20, 600, now],
        ['PP Woven Cement Bags', 'Packing Materials', 'Pcs', 2500, 500, 8, now],
        ['Industrial Fly Ash', 'Additives', 'Tons', 30, 5, 900, now],
        ['High Speed Diesel (HSD)', 'Fuel', 'Liters', 1000, 200, 95, now],
        ['Heavy Machine Conveyor Belt', 'Spare Parts', 'Pcs', 5, 2, 15000, now]
      ];
      for (const m of materials) {
        await db.run(
          'INSERT INTO materials (name, category, unit, current_stock, minimum_stock, rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          m
        );
      }

      await db.run('DELETE FROM company_settings');
      await db.run(
        `INSERT INTO company_settings (company_name, address, phone, email, gstin, logo_path, demo_seeded)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        ['StockLedger Global Trade Ltd.', 'Tech Park, Suite 400, Innovation Way', '+1 555-019-2834', 'contact@stockledger.io', 'TAX-US-98234-X', 'assets/logo.png']
      );

      await db.run('COMMIT');
      await db.run('PRAGMA foreign_keys = ON');
      return { success: true };
    } catch (e) {
      await db.run('ROLLBACK');
      await db.run('PRAGMA foreign_keys = ON');
      throw e;
    }
  },

  async clearDemoData() {
    await db.run('PRAGMA foreign_keys = OFF');
    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM receipt_items');
      await db.run('DELETE FROM payments');
      await db.run('DELETE FROM stock_movements');
      await db.run('DELETE FROM receipts');
      await db.run('DELETE FROM customers');
      await db.run('DELETE FROM materials');
      await db.run('COMMIT');
      await db.run('PRAGMA foreign_keys = ON');
      return { success: true };
    } catch (e) {
      await db.run('ROLLBACK');
      await db.run('PRAGMA foreign_keys = ON');
      throw e;
    }
  },

  async clearBusinessData() {
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
  },

  // Expenses
  async getEmployees() {
    return await db.query('SELECT * FROM employees ORDER BY name ASC');
  },

  async getExpenses(filters) {
    return await db.getExpenses(filters);
  },

  async addExpense(data) {
    if (!data.expense_category || !data.expense_date || !data.expense_type || data.amount === undefined) {
      return { success: false, error: 'Required fields are missing.' };
    }
    if (parseFloat(data.amount) < 0) {
      return { success: false, error: 'Amount cannot be negative.' };
    }
    await db.addExpense(data);
    return { success: true };
  },

  async updateExpense(id, data) {
    if (!id || !data.expense_category || !data.expense_date || !data.expense_type || data.amount === undefined) {
      return { success: false, error: 'Required fields are missing.' };
    }
    if (parseFloat(data.amount) < 0) {
      return { success: false, error: 'Amount cannot be negative.' };
    }
    await db.updateExpense(id, data);
    return { success: true };
  },

  async deleteExpense(id) {
    if (!id) return { success: false, error: 'ID is required.' };
    await db.deleteExpense(id);
    return { success: true };
  },

  async getExpenseSummary(filters) {
    return await db.getExpenseSummary(filters);
  },

  async getVehicleExpenseBreakdown(filters) {
    return await db.getVehicleExpenseBreakdown(filters);
  },

  async getPersonalExpenseBreakdown(filters) {
    return await db.getPersonalExpenseBreakdown(filters);
  },

  async getDailyExpenseSummary(filters) {
    return await db.getDailyExpenseSummary(filters);
  },

  async getMonthlyExpenseTrend(filters) {
    return await db.getMonthlyExpenseTrend(filters);
  },

  // Legacy vehicle/personal expense helpers
  async getVehicleExpenses(filters) {
    let sql = 'SELECT *, (fuel_expense + tn_snacks_expense + other_expense) as total FROM vehicle_expenses WHERE 1=1';
    const params = [];
    if (filters) {
      if (filters.search) {
        sql += ' AND (vehicle_number LIKE ? OR remarks LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`);
      }
      if (filters.from_date) {
        sql += ' AND date(date) >= date(?)';
        params.push(filters.from_date);
      }
      if (filters.to_date) {
        sql += ' AND date(date) <= date(?)';
        params.push(filters.to_date);
      }
    }
    sql += ' ORDER BY date DESC, id DESC';
    return await db.query(sql, params);
  },

  async addVehicleExpense({ date, vehicle_number, fuel_expense, tn_snacks_expense, other_expense, remarks }) {
    if (!date || !vehicle_number) return { success: false, error: 'Date and Vehicle Number are required.' };
    const now = getLocalISOString();
    const result = await db.run(
      'INSERT INTO vehicle_expenses (date, vehicle_number, fuel_expense, tn_snacks_expense, other_expense, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [date, vehicle_number, fuel_expense || 0, tn_snacks_expense || 0, other_expense || 0, remarks || '', now]
    );
    return { success: true, id: result.lastInsertRowid };
  },

  async updateVehicleExpense({ id, date, vehicle_number, fuel_expense, tn_snacks_expense, other_expense, remarks }) {
    if (!id || !date || !vehicle_number) return { success: false, error: 'ID, Date, and Vehicle Number are required.' };
    await db.run(
      'UPDATE vehicle_expenses SET date=?, vehicle_number=?, fuel_expense=?, tn_snacks_expense=?, other_expense=?, remarks=? WHERE id=?',
      [date, vehicle_number, fuel_expense || 0, tn_snacks_expense || 0, other_expense || 0, remarks || '', id]
    );
    return { success: true };
  },

  async deleteVehicleExpense(id) {
    await db.run('DELETE FROM vehicle_expenses WHERE id = ?', [id]);
    return { success: true };
  },

  async getPersonalExpenses(filters) {
    let sql = `
      SELECT pe.*, e.name as employee_name, e.designation as employee_designation
      FROM personal_expenses pe
      LEFT JOIN employees e ON pe.employee_id = e.id
      WHERE 1=1
    `;
    const params = [];
    if (filters) {
      if (filters.employee_id) {
        sql += ' AND pe.employee_id = ?';
        params.push(filters.employee_id);
      }
      if (filters.search) {
        sql += ' AND (pe.description LIKE ? OR pe.remarks LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`);
      }
      if (filters.from_date) {
        sql += ' AND date(pe.date) >= date(?)';
        params.push(filters.from_date);
      }
      if (filters.to_date) {
        sql += ' AND date(pe.date) <= date(?)';
        params.push(filters.to_date);
      }
    }
    sql += ' ORDER BY pe.date DESC, pe.id DESC';
    return await db.query(sql, params);
  },

  async addPersonalExpense({ employee_id, date, description, amount, remarks }) {
    if (!date || !amount) return { success: false, error: 'Date and Amount are required.' };
    const now = getLocalISOString();
    const result = await db.run(
      'INSERT INTO personal_expenses (employee_id, date, description, amount, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [employee_id || null, date, description || '', amount || 0, remarks || '', now]
    );
    return { success: true, id: result.lastInsertRowid };
  },

  async updatePersonalExpense({ id, employee_id, date, description, amount, remarks }) {
    if (!id || !date || !amount) return { success: false, error: 'ID, Date, and Amount are required.' };
    await db.run(
      'UPDATE personal_expenses SET employee_id=?, date=?, description=?, amount=?, remarks=? WHERE id=?',
      [employee_id || null, date, description || '', amount || 0, remarks || '', id]
    );
    return { success: true };
  },

  async deletePersonalExpense(id) {
    await db.run('DELETE FROM personal_expenses WHERE id = ?', [id]);
    return { success: true };
  },

  async getExpensesSummary() {
    const [vExp, pExp] = await Promise.all([
      db.queryOne('SELECT SUM(fuel_expense + tn_snacks_expense + other_expense) as t FROM vehicle_expenses'),
      db.queryOne('SELECT SUM(amount) as t FROM personal_expenses')
    ]);
    return {
      vehicle_total: vExp?.t || 0,
      personal_total: pExp?.t || 0,
      grand_total: (vExp?.t || 0) + (pExp?.t || 0)
    };
  },

  // Receipt HTML representation
  buildReceiptHtml
};

module.exports = apiService;

