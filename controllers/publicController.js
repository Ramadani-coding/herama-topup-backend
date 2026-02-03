const supabase = require("../config/supabase");
const { createDigiflazzTransaction } = require("../services/digiflazzService");
const { generateInvoice, verifyWebhookSig } = require("../utils/helpers");

// 1. Ambil list game untuk Beranda
exports.getCategories = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, slug, image_url")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    // Jika data kosong
    if (!data || data.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Belum ada kategori game yang tersedia saat ini.",
        data: [],
      });
    }

    res.json({ success: true, message: "Kategori berhasil diambil", data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Ambil detail kategori & daftar produk (nominal)
exports.getCategoryDetail = async (req, res) => {
  try {
    const { slug } = req.params;

    // Ambil data kategori berdasarkan slug
    const { data: category, error: catErr } = await supabase
      .from("categories")
      .select("*")
      .eq("slug", slug)
      .single();

    if (catErr || !category)
      return res.status(404).json({ message: "Game tidak ditemukan" });

    // Ambil semua produk (nominal) yang aktif untuk kategori ini
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id, sku_code, product_name, price_sell")
      .eq("category_id", category.id)
      .eq("status", "active")
      .order("price_sell", { ascending: true });

    if (prodErr) throw prodErr;

    res.json({
      success: true,
      category, // Berisi info input_type, server_list, placeholder
      products, // Berisi list nominal/diamond
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Ambil pencarian kategori game
exports.searchCategories = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res
        .status(400)
        .json({ success: false, message: "Masukkan kata kunci pencarian" });
    }

    const { data, error } = await supabase
      .from("categories")
      .select("id, name, slug, image_url")
      .ilike("name", `%${q}%`)
      .eq("is_active", true)
      .limit(5);

    if (error) throw error;

    // Penanganan khusus jika hasil pencarian nihil
    if (data.length === 0) {
      return res.status(200).json({
        success: true,
        message: `Tidak ada game yang cocok dengan "${q}".`,
        data: [],
      });
    }

    res.json({ success: true, message: "Hasil pencarian ditemukan", data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Topup
exports.processTopup = async (req, res) => {
  const { sku_code, customer_no, phone_number, server_id } = req.body;

  if (!sku_code || !customer_no || !phone_number) {
    return res
      .status(400)
      .json({ success: false, message: "Data tidak lengkap" });
  }

  try {
    const { data: product, error: pError } = await supabase
      .from("products")
      .select("price_sell")
      .eq("sku_code", sku_code)
      .single();

    if (pError || !product) {
      return res
        .status(404)
        .json({ success: false, message: "Produk tidak ditemukan" });
    }

    const invoice = generateInvoice();

    // 1. Simpan Transaksi Awal (Pending)
    const { error: dbError } = await supabase.from("transactions").insert([
      {
        ref_id: invoice,
        customer_no,
        server_id: server_id || null,
        sku_code,
        amount_sell: product.price_sell,
        phone_number,
        status: "pending",
      },
    ]);

    if (dbError) throw dbError;

    // 2. Tembak API Digiflazz
    const digiResponse = await createDigiflazzTransaction(
      sku_code,
      customer_no,
      invoice,
    );

    // 3. Update Database dengan data lengkap dari Digiflazz
    await supabase
      .from("transactions")
      .update({
        status: digiResponse.status.toLowerCase(),
        sn: digiResponse.sn || null,
        message: digiResponse.message,
        amount_cost: digiResponse.price,
        digiflazz_ref_id: digiResponse.ref_id,
      })
      .eq("ref_id", invoice);

    // 4. Kirim Respon Lengkap (Sesuai Gambar Referensi)
    return res.status(200).json({
      success: true,
      data: {
        ref_id: invoice, // Nomor Invoice Internal
        customer_no: digiResponse.customer_no, // Nomor Pelanggan
        buyer_sku_code: digiResponse.buyer_sku_code, // Kode Produk
        message: digiResponse.message, // Pesan Status
        status: digiResponse.status, // Status Transaksi
        rc: digiResponse.rc, // Response Code
        sn: digiResponse.sn || "", // Serial Number
        buyer_last_saldo: digiResponse.buyer_last_saldo, // Sisa Saldo
        price: product.price_sell, // Harga Jual ke User
      },
    });
  } catch (error) {
    const errorMessage = error.response?.data?.data?.message || error.message;
    return res.status(500).json({ success: false, message: errorMessage });
  }
};

// Fungsi untuk mengecek status transaksi berdasarkan Ref ID (Invoice)
exports.checkStatus = async (req, res) => {
  const { ref_id } = req.params;

  try {
    // 1. Ambil data utama dari tabel transactions
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("ref_id", ref_id)
      .single();

    if (txError || !transaction) {
      return res.status(404).json({
        success: false,
        message: "Nomor invoice tidak ditemukan.",
      });
    }

    // 2. Ambil detail produk dari tabel products
    const { data: product } = await supabase
      .from("products")
      .select("product_name, category_id, price_sell")
      .eq("sku_code", transaction.sku_code)
      .single();

    // 3. Ambil detail kategori dari tabel categories
    const { data: category } = await supabase
      .from("categories")
      .select("name, image_url")
      .eq("id", product?.category_id)
      .single();

    // 4. Logika Perhitungan Fee
    const basePrice = product?.price_sell || transaction.amount_sell;
    let fee = 0;
    const method = transaction.payment_method.toLowerCase();

    if (method === "qris") {
      fee = 0; // Fee QRIS 0.7%
    } else if (method === "gopay") {
      fee = Math.ceil(basePrice * 0.02); // Fee E-Wallet 0.2%
    } else if (method.includes("va") || method.includes("bank")) {
      fee = 4000; // Fee Virtual Bank Flat 4.000
    }

    const totalPrice = basePrice + fee;

    // 5. Mengembalikan respon lengkap sesuai referensi Postman
    return res.status(200).json({
      success: true,
      data: {
        invoice_id: transaction.ref_id,
        customer_no: transaction.customer_no,
        product_name: product?.product_name || transaction.sku_code,
        category_name: category?.name || "Game",
        category_image: category?.image_url,
        payment_method: transaction.payment_method,
        price: basePrice,
        fee: fee,
        total_price: totalPrice,
        status: transaction.status,
        payment_status: transaction.payment_status,
        sn: transaction.sn || "-",
        message: transaction.status || "-",
        desc: transaction.message || "-",
        snap_token: transaction.snap_token,
        created_at: transaction.created_at,
      },
    });
  } catch (error) {
    console.error("Internal Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan sistem.",
    });
  }
};

exports.digiflazzWebhook = async (req, res) => {
  const signature = req.headers["x-hub-signature"]; // [cite: 66]
  const eventType = req.headers["x-digiflazz-event"]; // [cite: 66, 70]
  const payload = req.body; // [cite: 60, 87]

  try {
    // 1. Validasi Signature (Keamanan Utama)
    if (
      process.env.DIGIFLAZZ_WEBHOOK_SECRET &&
      !verifyWebhookSig(payload, signature)
    ) {
      console.error("Webhook Error: Invalid Signature");
      return res.status(401).send("Unauthorized"); // Tolak jika signature salah [cite: 152]
    }

    const { data } = payload; // [cite: 88, 112]
    if (!data) return res.status(400).send("No Data");

    console.log(`Menerima Event ${eventType} untuk Invoice: ${data.ref_id}`);

    // 2. Update status transaksi di Supabase secara Realtime [cite: 61]
    // Kita update berdasarkan ref_id yang dikirim Digiflazz [cite: 89, 113]
    const { error } = await supabase
      .from("transactions")
      .update({
        status: data.status.toLowerCase(), // Sukses, Pending, atau Gagal [cite: 93, 119]
        sn: data.sn || "", // Serial Number sebagai bukti [cite: 96, 121]
        message: data.message, // Pesan status [cite: 92, 118]
        amount_cost: data.price, // Harga modal asli [cite: 97, 124]
        updated_at: new Date().toISOString(), //
      })
      .eq("ref_id", data.ref_id); //

    if (error) {
      console.error("Database Update Error:", error.message);
      return res.status(500).send("Database Error");
    }

    // 3. Respon ke Digiflazz bahwa webhook berhasil diterima
    return res.status(200).send("Webhook Processed Successfully");
  } catch (error) {
    console.error("Webhook Processing Error:", error.message);
    return res.status(500).send("Internal Server Error");
  }
};

// Fungsi untuk menyensor Order ID (Contoh: HRM-804104-INV -> HRM-80****NV)
const maskInvoiceId = (id) => {
  if (!id) return "";
  const firstPart = id.substring(0, 3);
  const lastPart = id.substring(id.length - 1);
  return `${firstPart}********${lastPart}`; // Hasil akhir mirip referensi
};

exports.getRecentTransactions = async (req, res) => {
  try {
    // 1. Ambil 10 transaksi terakhir dari tabel
    const { data: transactions, error: txError } = await supabase
      .from("transactions")
      .select("created_at, ref_id, amount_sell, status, sku_code")
      .order("created_at", { ascending: false })
      .limit(10);

    if (txError) throw txError;

    // 2. Kumpulkan semua sku_code unik yang ada di 10 transaksi tersebut
    const uniqueSkuCodes = [...new Set(transactions.map((t) => t.sku_code))];

    // 3. Cari data produk berdasarkan sku_code tersebut (Tanpa Relasi Formal)
    const { data: products, error: prodError } = await supabase
      .from("products")
      .select("sku_code, product_name")
      .in("sku_code", uniqueSkuCodes);

    if (prodError) throw prodError;

    // 4. Buat objek pencarian (Map) agar proses pencocokan lebih cepat
    const productLookup = {};
    products.forEach((p) => {
      productLookup[p.sku_code] = p.product_name;
    });

    // 5. Gabungkan data dan lakukan sensor
    const formattedData = transactions.map((item) => ({
      tanggal: item.created_at,
      order_id: maskInvoiceId(item.ref_id), // Sensor diaktifkan
      produk: productLookup[item.sku_code] || item.sku_code, // Pakai sku_code jika nama tidak ketemu
      harga: item.amount_sell,
      status: item.status,
    }));

    return res.status(200).json({
      success: true,
      data: formattedData,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPriceList = async (req, res) => {
  try {
    const { category_id } = req.query;

    let query = supabase
      .from("products")
      .select(
        `
        sku_code,
        product_name,
        price_sell,
        status,
        categories (name)
      `,
      )
      // MENGURUTKAN HARGA: termurah ke termahal
      .order("price_sell", { ascending: true });

    if (category_id && category_id !== "all") {
      query = query.eq("category_id", category_id);
    }

    const { data, error } = await query;
    if (error) throw error;

    const formattedData = data.map((item, index) => ({
      no: index + 1,
      id: item.sku_code,
      produk: item.categories?.name || "Game",
      varian: item.product_name,
      harga: item.price_sell,
      status: item.status === "active" ? "Aktif" : "Nonaktif",
    }));

    return res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
