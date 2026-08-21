const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY || "rahasia123";
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || ""; // isi dari bagibagi.co
const PORT = process.env.PORT || 3000;

// Koneksi PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Buat tabel otomatis
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      donator_name VARCHAR(200),
      amount NUMERIC NOT NULL,
      message TEXT,
      reference_id VARCHAR(200) UNIQUE,
      status VARCHAR(20) DEFAULT 'success'
    )
  `);
  console.log("Database siap!");
}
initDB();

// =============================================
// GET - cek API aktif
// =============================================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: "API aktif",
    endpoints: {
      webhook: "POST /bagibagi",
      transactions: "GET /api/partnerintegration/transactions",
      top_donator: "GET /api/partnerintegration/top-donator"
    }
  });
});

// =============================================
// WEBHOOK - terima notifikasi dari bagibagi.co
// =============================================
app.post('/bagibagi', async (req, res) => {
  try {
    // Validasi signature dari bagibagi
    if (WEBHOOK_TOKEN) {
      const signature = req.headers['x-bagibagi-signature'];
      const body = JSON.stringify(req.body);
      const expectedSig = crypto
        .createHmac('sha256', WEBHOOK_TOKEN)
        .update(body)
        .digest('hex');

      if (signature !== expectedSig) {
        return res.status(401).json({ success: false, message: "Invalid signature" });
      }
    }

    const { amount, donator_name, message, id } = req.body;

    console.log(`💰 Donasi masuk! ${donator_name} - Rp${amount} - "${message}"`);

    // Simpan ke database
    const referenceId = id || `BB-${Date.now()}`;
    await pool.query(
      `INSERT INTO transactions (donator_name, amount, message, reference_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (reference_id) DO NOTHING`,
      [donator_name || "Anonymous", amount || 0, message || "", referenceId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================================
// GET transactions - untuk Roblox fetch donasi
// =============================================
app.get('/api/partnerintegration/transactions', async (req, res) => {
  try {
    const { merchantCode, token, page = 1, pageSize = 10 } = req.query;

    const offset = (page - 1) * pageSize;
    const result = await pool.query(
      `SELECT * FROM transactions 
       ORDER BY timestamp DESC 
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    const items = result.rows.map(row => ({
      id: row.id,
      userName: row.donator_name,
      amount: row.amount,
      message: row.message,
      createdAt: row.timestamp,
      isVerified: true
    }));

    res.json({
      success: true,
      data: {
        items: items,
        total: items.length,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      }
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================================
// GET top-donator - untuk leaderboard Roblox
// =============================================
app.get('/api/partnerintegration/top-donator', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT donator_name, SUM(amount) as total_amount
       FROM transactions
       GROUP BY donator_name
       ORDER BY total_amount DESC
       LIMIT 10`
    );

    const items = result.rows.map(row => ({
      donatorName: row.donator_name,
      totalAmount: parseFloat(row.total_amount)
    }));

    res.json({ success: true, data: { items } });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`Server jalan di port ${PORT}`));
