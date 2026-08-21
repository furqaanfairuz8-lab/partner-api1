const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY || "rahasia123";
const PORT = process.env.PORT || 3000;

// Koneksi PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Buat tabel otomatis kalau belum ada
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      partner_id VARCHAR(100) NOT NULL,
      reference_id VARCHAR(100) UNIQUE NOT NULL,
      type VARCHAR(20) DEFAULT 'debit',
      amount NUMERIC NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'pending'
    )
  `);
  console.log("Database siap!");
}
initDB();

// GET - cek API aktif
app.get('/', (req, res) => {
  res.json({ success: true, message: "API aktif dan siap menerima request POST" });
});

// POST - catat transaksi
app.post('/api/partnerintegration/transactions', async (req, res) => {
  try {
    const { api_key, partner_id, reference_id, amount, type, description } = req.body;

    // Validasi API key
    if (api_key !== API_KEY) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Validasi field wajib
    if (!partner_id || !reference_id || !amount) {
      return res.status(400).json({ success: false, message: "Field tidak lengkap" });
    }

    // Simpan ke database
    const result = await pool.query(
      `INSERT INTO transactions (partner_id, reference_id, type, amount, description)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [partner_id, reference_id, type || 'debit', amount, description || '']
    );

    const data = result.rows[0];
    res.json({
      success: true,
      message: "Transaksi berhasil dicatat",
      data: {
        id: data.id,
        reference_id: data.reference_id,
        partner_id: data.partner_id,
        amount: data.amount,
        type: data.type,
        status: data.status,
        timestamp: data.timestamp
      }
    });

  } catch (err) {
    // Kalau reference_id duplikat
    if (err.code === '23505') {
      return res.status(400).json({ success: false, message: "reference_id sudah digunakan" });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET - ambil semua transaksi per partner
app.get('/api/partnerintegration/transactions/:partner_id', async (req, res) => {
  try {
    const { api_key } = req.query;
    if (api_key !== API_KEY) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await pool.query(
      `SELECT * FROM transactions WHERE partner_id = $1 ORDER BY timestamp DESC`,
      [req.params.partner_id]
    );

    res.json({ success: true, data: result.rows });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`Server jalan di port ${PORT}`));
