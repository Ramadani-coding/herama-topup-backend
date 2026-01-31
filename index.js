const express = require("express");
const cors = require("cors");
const supabase = require("./config/supabase");
require("dotenv").config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes (Akan kita buat setelah ini)
// app.use('/api/v1/public', require('./routes/publicRoutes'));
// app.use('/api/v1/payment', require('./routes/paymentRoutes'));

// Endpoint untuk monitoring status server
app.get("/health", (req, res) => {
  res.json({
    status: "UP",
    timestamp: new Date().toISOString(),
    message: "Herama Topup API is running smoothly",
  });
});

app.get("/", (req, res) => {
  res.json({ message: "Game Topup API is ready!" });
});

app.use("/api/v1/public", require("./routes/publicRoutes"));
app.use("/api/v1/admin", require("./routes/adminRoutes"));

app.get("/test-db", async (req, res) => {
  try {
    // Mencoba mengambil 1 data dari tabel categories
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .limit(1);

    if (error) throw error;

    res.json({
      status: "Success",
      message: "Terkoneksi ke Supabase!",
      data: data,
    });
  } catch (err) {
    res.status(500).json({
      status: "Error",
      message: "Gagal konek ke Supabase",
      error: err.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
