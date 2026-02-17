const adminService = require("../services/adminService");
const digiflazzService = require("../services/digiflazzService");
const supabase = require("../config/supabase");

exports.syncProducts = async (req, res) => {
  try {
    const digiflazzData = await digiflazzService.fetchPriceList();

    if (!Array.isArray(digiflazzData)) {
      console.error(
        "DEBUG - Digiflazz Error Response:",
        JSON.stringify(digiflazzData, null, 2),
      );
      if (digiflazzData?.rc === "83") {
        return res
          .status(429)
          .json({ success: false, rc: "83", message: digiflazzData.message });
      }
      throw new Error(digiflazzData?.message || "Data bukan berbentuk Array.");
    }

    // Ambil kategori dengan kolom terbaru
    const { data: currentCategories } = await supabase
      .from("categories")
      .select("id, name, markup_type, markup_percent, markup_flat");

    const categoryMap = new Map(
      currentCategories?.map((c) => [c.name, c]) || [],
    );

    let successCount = 0;
    let failCount = 0;

    for (const item of digiflazzData) {
      try {
        let category = categoryMap.get(item.brand);

        // Logic jika kategori baru ditemukan
        if (!category) {
          const { data: newCat, error: catErr } = await supabase
            .from("categories")
            .upsert(
              {
                name: item.brand,
                slug: item.brand.toLowerCase().replace(/[^a-z0-9]/g, "-"),
                input_type: "ID_ONLY",
                markup_type: "flat", // Default awal
                markup_percent: 0, // Kolom baru
                markup_flat: 1500, // Kolom baru
              },
              { onConflict: "name" },
            )
            .select()
            .single();

          if (catErr) throw catErr;
          category = newCat;
          categoryMap.set(item.brand, category);
        }

        // --- MULAI PERHITUNGAN HARGA JUAL (HYBRID LOGIC) ---
        const cost = Number(item.price);
        const mPercent = parseFloat(category.markup_percent || 0);
        const mFlat = parseFloat(category.markup_flat || 0);
        const type = category.markup_type;

        let priceSell = cost;

        if (type === "percent") {
          priceSell = cost * (1 + mPercent);
        } else if (type === "flat") {
          priceSell = cost + mFlat;
        } else if (type === "hybrid") {
          // Rumus Hybrid: Ambil yang tertinggi antara % dan Flat
          const priceByPercent = cost * (1 + mPercent);
          const priceByFlat = cost + mFlat;
          priceSell = Math.max(priceByPercent, priceByFlat);
        }
        // --- SELESAI PERHITUNGAN ---

        const { error: prodErr } = await supabase.from("products").upsert(
          {
            category_id: category.id,
            sku_code: item.buyer_sku_code,
            product_name: item.product_name,
            price_cost: cost,
            price_sell: Math.ceil(priceSell), // Pembulatan ke atas
            status:
              item.buyer_product_status && item.seller_product_status
                ? "active"
                : "inactive",
          },
          { onConflict: "sku_code" },
        );

        if (prodErr) throw prodErr;
        successCount++;
      } catch (err) {
        console.error(`Gagal sync SKU ${item.buyer_sku_code}: ${err.message}`);
        failCount++;
      }
    }

    res.json({
      success: true,
      message: `Sinkronisasi selesai. Sukses: ${successCount}, Gagal: ${failCount}`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 1. Ambil Semua Kategori (Termasuk yang tidak aktif untuk Admin)
// adminController.js

exports.getAllCategoriesAdmin = async (req, res) => {
  try {
    const { sort, range } = req.query;

    // 1. Parse parameter dari React Admin
    // Format range: "[0, 4]" (untuk 5 data pertama)
    const [from, to] = range ? JSON.parse(range) : [0, 9];
    // Format sort: "[\"name\", \"ASC\"]"
    const [field, order] = sort ? JSON.parse(sort) : ["name", "ASC"];

    // 2. Query ke Supabase dengan pagination dan sorting
    const { data, error, count } = await supabase
      .from("categories")
      .select("*", { count: "exact" }) // 'exact' untuk mendapatkan total baris di database
      .order(field, { ascending: order === "ASC" })
      .range(from, to);

    if (error) throw error;

    // 3. Penting: Expose Content-Range header agar frontend bisa membaca total data
    res.set("Access-Control-Expose-Headers", "Content-Range");
    res.set("Content-Range", `categories ${from}-${to}/${count}`);

    // Kirim response dengan total count di dalamnya
    res.json({ success: true, data, total: count });
  } catch (error) {
    console.error("Fetch Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("id", id)
      .single(); // Ambil hanya satu data

    if (error) throw error;

    // Pastikan format response konsisten dengan getAllCategoriesAdmin
    res.json({ success: true, data });
  } catch (error) {
    console.error("Get Category Error:", error.message);
    res
      .status(404)
      .json({ success: false, message: "Kategori tidak ditemukan" });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // 1. Hapus sampah kolom lama
    delete updateData.markup_value;

    // 2. FIX SERVER_LIST: JANGAN di-stringify
    // Biarkan tetap dalam bentuk Array/Object agar Supabase menyimpannya sebagai JSONB asli
    if (updateData.server_list && typeof updateData.server_list === "string") {
      try {
        updateData.server_list = JSON.parse(updateData.server_list);
      } catch (e) {
        // Jika gagal parse, biarkan apa adanya
      }
    }

    // 3. Pastikan markup_type lowercase agar tidak kena Constraint Error
    if (updateData.markup_type) {
      updateData.markup_type = updateData.markup_type.toLowerCase();
    }

    const { data, error } = await supabase
      .from("categories")
      .update(updateData)
      .eq("id", id)
      .select();

    if (error) throw error;

    // FIX: Kirim data[0] agar menjadi objek tunggal, bukan array
    res.json({
      success: true,
      message: "Pembaruan berhasil",
      data: data[0], // Ambil index ke-0
    });
  } catch (error) {
    console.error("Update Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Hapus Kategori (Jika brand sudah tidak ada di Digiflazz)
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from("categories").delete().eq("id", id);

    if (error) throw error;
    res.json({ success: true, message: "Kategori berhasil dihapus" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Menghapus produk tunggal berdasarkan ID
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase.from("products").delete().eq("id", id);

    if (error) throw error;

    res.json({
      success: true,
      message: "Produk berhasil dihapus secara permanen.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getStats = async (req, res) => {
  try {
    const stats = await adminService.getDashboardStats();
    return res.json(stats);
  } catch (error) {
    return res.status(500).json({
      message: "Gagal mengambil statistik",
      error: error.message,
    });
  }
};

exports.getProducts = async (req, res) => {
  try {
    // 1. Parse parameter standar React Admin
    const { filter, range, sort } = req.query;

    const filterObj = filter ? JSON.parse(filter) : {};
    const [from, to] = range ? JSON.parse(range) : [0, 9];
    const sortArr = sort ? JSON.parse(sort) : ["product_name", "ASC"];

    // 2. Panggil Service
    const { products, total } = await adminService.getAllProductsWithCategory(
      from,
      to,
      filterObj,
      sortArr,
    );

    // 3. SET HEADER CONTENT-RANGE (Kunci perbaikan pagination)
    res.set("Access-Control-Expose-Headers", "Content-Range");
    res.set("Content-Range", `products ${from}-${to}/${total}`);

    return res.json({
      success: true,
      products: products,
      total: total, // Tetap kirim di body sebagai cadangan
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getProductDetail = async (req, res) => {
  try {
    const { id } = req.params;

    // Ambil data produk dan join dengan kategori
    const { data, error } = await supabase
      .from("products")
      .select("*, categories(*)")
      .eq("id", id)
      .single();

    if (error) throw error;
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Produk tidak ditemukan" });

    // Format respons agar sesuai dengan yang diharapkan DataProvider
    return res.json({
      success: true,
      product: {
        ...data,
        category_name: data.categories?.name || "No Category",
      },
    });
  } catch (error) {
    console.error("Error Detail Produk:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const mapProductNames = async (transactions) => {
  if (!transactions || transactions.length === 0) return [];

  const { data: products } = await supabase
    .from("products")
    .select("sku_code, product_name");

  const lookup = {};
  products?.forEach((p) => (lookup[p.sku_code] = p.product_name));

  return transactions.map((item) => {
    // LOGIKA PENENTUAN STATUS BARU
    let displayStatus = item.status; // Default pakai status asli

    if (item.payment_status === "success" && item.status === "sukses") {
      displayStatus = "Success";
    } else if (item.payment_status === "pending" && item.status === "pending") {
      displayStatus = "Waiting Payment";
    } else if (item.payment_status === "expire" && item.status === "pending") {
      displayStatus = "Cancel";
    }

    return {
      ...item,
      display_name: lookup[item.sku_code] || item.sku_code,
      status_label: displayStatus,
    };
  });
};

exports.getList = async (req, res) => {
  try {
    // 1. Ambil filter, range, dan sort dari URL yang dikirim browser
    let { filter, range, sort } = req.query;

    // Parse JSON string menjadi Object agar bisa dibaca
    const filterObj = filter ? JSON.parse(filter) : {};
    const [from, to] = range ? JSON.parse(range) : [0, 9];
    const [field, order] = sort ? JSON.parse(sort) : ["created_at", "DESC"];

    // 2. Buat query dasar ke Supabase
    let query = supabase.from("transactions").select("*", { count: "exact" });

    // 3. LOGIKA SEARCH: Inilah kuncinya!
    if (filterObj.q) {
      // Mencari di kolom ref_id, customer_no, atau sku_code
      query = query.or(
        `ref_id.ilike.%${filterObj.q}%,customer_no.ilike.%${filterObj.q}%,sku_code.ilike.%${filterObj.q}%`,
      );
    }

    // 4. Jalankan Query dengan Pagination dan Sorting
    const { data, count, error } = await query
      .range(from, to)
      .order(field, { ascending: order === "ASC" });

    if (error) throw error;

    // Tambahkan nama produk (display_name) seperti yang sudah kita buat sebelumnya
    const result = await mapProductNames(data);

    // 5. Update Header Content-Range (Harus pakai 'count' asli dari hasil filter)
    res.set("Access-Control-Expose-Headers", "Content-Range");
    res.set("Content-Range", `transactions ${from}-${to}/${count}`);

    return res.json(result);
  } catch (err) {
    console.error("Error API:", err.message);
    return res.status(500).json({ message: err.message });
  }
};

// 2. TAMBAHKAN FUNGSI INI: Untuk mengambil satu data detail
exports.getTransactionById = async (req, res) => {
  try {
    const { id } = req.params;

    // Kamu bisa menggunakan service yang sudah ada lalu memfilternya,
    // atau buat fungsi baru di adminService yang pakai .maybeSingle() dari Supabase
    const allTransactions = await adminService.getAllTransactions();
    const transaction = allTransactions.find((t) => t.id === id);

    if (!transaction) {
      return res.status(404).json({ message: "Transaksi tidak ditemukan" });
    }

    // Pastikan mengembalikan OBJEK {}, bukan ARRAY []
    return res.json(transaction);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
