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
exports.getAllCategoriesAdmin = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
    res.json({ success: true, message: "Pembaruan berhasil", data });
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

exports.getTransactions = async (req, res) => {
  try {
    const transactions = await adminService.getAllTransactions();
    return res.json(transactions);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.getProducts = async (req, res) => {
  try {
    // Ambil status dari URL (?status=inactive)
    const { page, limit, category_id, status } = req.query;

    const result = await adminService.getAllProductsWithCategory(
      page,
      limit,
      category_id,
      status,
    );

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
