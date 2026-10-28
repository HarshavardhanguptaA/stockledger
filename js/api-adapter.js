/**
 * StockLedger — Web API Adapter
 * Replaces Electron's window.api (preload.js IPC) with REST fetch() calls.
 * Include this script BEFORE common.js / page scripts in every HTML page.
 */
(function () {
  'use strict';

  const API_BASE = '';          // same origin
  let authToken = localStorage.getItem('sl_token');

  // ── Helper: authenticated RPC call ───────────────────────
  async function rpc(method, ...args) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;

    const res = await fetch(API_BASE + '/api/rpc', {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, args })
    });

    if (res.status === 401) {
      // Session expired → redirect to login
      authToken = null;
      localStorage.removeItem('sl_token');
      if (!window.location.pathname.endsWith('login.html')) {
        window.location.href = 'login.html';
      }
      return null;
    }
    return res.json();
  }

  // ── Build the window.api object ──────────────────────────
  window.api = {
    // ─── Auth ──────────────────────────────────────────────
    login: async (username, password) => {
      const res = await fetch(API_BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success && data.token) {
        authToken = data.token;
        localStorage.setItem('sl_token', data.token);
      }
      return data;
    },

    register: async (name, username, password) => {
      const res = await fetch(API_BASE + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, password })
      });
      const data = await res.json();
      if (data.success && data.token) {
        authToken = data.token;
        localStorage.setItem('sl_token', data.token);
      }
      return data;
    },

    logout: async () => {
      const token = authToken;
      authToken = null;
      localStorage.removeItem('sl_token');
      try {
        await fetch(API_BASE + '/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + (token || '') }
        });
      } catch (_) { /* ignore */ }
      return { success: true };
    },

    getSession: async () => {
      if (!authToken) return null;
      try {
        const res = await fetch(API_BASE + '/api/auth/session', {
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (!res.ok) return null;
        return await res.json();
      } catch (_) {
        return null;
      }
    },

    // ─── Materials ─────────────────────────────────────────
    getMaterials:       ()     => rpc('getMaterials'),
    getMaterialById:    (id)   => rpc('getMaterialById', id),
    addMaterial:        (data) => rpc('addMaterial', data),
    updateMaterial:     (data) => rpc('updateMaterial', data),
    deleteMaterial:     (id)   => rpc('deleteMaterial', id),

    // ─── Stock ─────────────────────────────────────────────
    addStock:           (data)    => rpc('addStock', data),
    stockOut:           (data)    => rpc('stockOut', data),
    getStockMovements:  (filters) => rpc('getStockMovements', filters),
    deleteStockMovement:(id)      => rpc('deleteStockMovement', id),

    // ─── Customers ─────────────────────────────────────────
    getCustomers:       ()     => rpc('getCustomers'),
    getCustomerById:    (id)   => rpc('getCustomerById', id),
    addCustomer:        (data) => rpc('addCustomer', data),
    updateCustomer:     (data) => rpc('updateCustomer', data),
    deleteCustomer:     (id)   => rpc('deleteCustomer', id),
    getCustomerHistory: (id)   => rpc('getCustomerHistory', id),
    addCustomerPayment: (data) => rpc('addCustomerPayment', data),

    // ─── Receipts ──────────────────────────────────────────
    getReceipts:         (filters) => rpc('getReceipts', filters),
    getReceiptById:      (id)      => rpc('getReceiptById', id),
    getReceiptByNumber:  (num)     => rpc('getReceiptByNumber', num),
    deleteReceipt:       (id)      => rpc('deleteReceipt', id),
    updateReceiptPdfPath:(data)    => rpc('updateReceiptPdfPath', data),
    markWhatsappSent:    (id)      => rpc('markWhatsappSent', id),
    addPayment:          (data)    => rpc('addPayment', data),

    // ─── PDF (browser print) ───────────────────────────────
    generatePDF: async ({ receiptId }) => {
      window.open('/api/receipts/' + receiptId + '/print', '_blank');
      return { success: true, filePath: null, fileName: null };
    },

    // ─── Desktop-only stubs (no-op in browser) ─────────────
    openExternal:     (url)  => { window.open(url, '_blank'); return Promise.resolve({ success: true }); },
    showItemInFolder: ()     => Promise.resolve({ success: false, error: 'Not available in web version.' }),
    openPath:         ()     => Promise.resolve({ success: false, error: 'Not available in web version.' }),
    fileExists:       ()     => Promise.resolve(false),
    writeClipboardFile:()    => Promise.resolve({ success: false }),
    openNotepad:      ()     => Promise.resolve({ success: false, error: 'Not available in web version.' }),

    // ─── WhatsApp (browser fallback) ───────────────────────
    whatsappSendPDF: async ({ phone }) => {
      if (phone) {
        const cleaned = phone.replace(/\D/g, '');
        window.open('https://wa.me/' + cleaned, '_blank');
      }
      return { success: true };
    },

    // ─── Dashboard & Reports ───────────────────────────────
    getDashboardStats: () => rpc('getDashboardStats'),
    getReports:        (filters) => rpc('getReports', filters),
    getReportsData:    (range)   => rpc('getReportsData', range),
    getReportData:     (reportType, filters) => rpc('getReportData', reportType, filters),

    // ─── Company Settings ──────────────────────────────────
    getCompanySettings:  () => rpc('getCompanySettings'),
    saveCompanySettings: (data) => rpc('saveCompanySettings', data),

    // ─── Backup / Restore (limited in web) ─────────────────
    backupDatabase:  () => Promise.resolve({ success: false, error: 'Backup is not available in the web version. Use the desktop app for database backup/restore.' }),
    restoreDatabase: () => Promise.resolve({ success: false, error: 'Restore is not available in the web version.' }),
    getSystemHealth: () => rpc('getSystemHealth'),

    // ─── Data Management ───────────────────────────────────
    resetDemoData:    () => rpc('resetDemoData'),
    clearDemoData:    () => rpc('clearDemoData'),
    clearBusinessData:() => rpc('clearBusinessData'),

    // ─── Categories & Units ────────────────────────────────
    getCategories: () => rpc('getCategories'),
    getUnits:      () => rpc('getUnits'),

    // ─── Expenses (Unified) ────────────────────────────────
    addExpense:    (data) => rpc('addExpense', data),
    updateExpense: (id, data) => rpc('updateExpense', id, data),
    deleteExpense: (id)   => rpc('deleteExpense', id),
    getExpenses:   (filters) => rpc('getExpenses', filters),
    getExpenseSummary:          (filters) => rpc('getExpenseSummary', filters),
    getVehicleExpenseBreakdown: (filters) => rpc('getVehicleExpenseBreakdown', filters),
    getPersonalExpenseBreakdown:(filters) => rpc('getPersonalExpenseBreakdown', filters),
    getDailyExpenseSummary:     (filters) => rpc('getDailyExpenseSummary', filters),
    getMonthlyExpenseTrend:     (filters) => rpc('getMonthlyExpenseTrend', filters),

    // ─── Employees & Legacy Expenses ───────────────────────
    getEmployees:          ()     => rpc('getEmployees'),
    getVehicleExpenses:    (f)    => rpc('getVehicleExpenses', f),
    addVehicleExpense:     (data) => rpc('addVehicleExpense', data),
    updateVehicleExpense:  (data) => rpc('updateVehicleExpense', data),
    deleteVehicleExpense:  (id)   => rpc('deleteVehicleExpense', id),
    getPersonalExpenses:   (f)    => rpc('getPersonalExpenses', f),
    addPersonalExpense:    (data) => rpc('addPersonalExpense', data),
    updatePersonalExpense: (data) => rpc('updatePersonalExpense', data),
    deletePersonalExpense: (id)   => rpc('deletePersonalExpense', id),
    getExpensesSummary:    ()     => rpc('getExpensesSummary'),

    // ─── Legacy stubs (disabled features) ──────────────────
    getPendingBulkOrders:     () => Promise.resolve([]),
    getPendingRetailerOrders: () => Promise.resolve([]),
    getUsers: async () => {
      try { return await rpc('getUsers') || []; } catch (_) { return []; }
    },
    addUser: () => Promise.resolve({ success: false, error: 'User management disabled.' }),
  };
})();

