const digiflazzService = require("../services/digiflazzService");
const supabase = require("../config/supabase");

exports.syncProducts = async (req, res) => {
  try {
    const digiflazzData = await digiflazzService.fetchPriceList();

    // Log jika ada error respon dari Digiflazz (Bukan Array)
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

    const { data: currentCategories } = await supabase
      .from("categories")
      .select("*");
    const categoryMap = new Map(
      currentCategories?.map((c) => [c.name, c]) || [],
    );

    let successCount = 0;
    let failCount = 0;

    for (const item of digiflazzData) {
      try {
        let category = categoryMap.get(item.brand);

        if (!category) {
          const { data: newCat, error: catErr } = await supabase
            .from("categories")
            .upsert(
              {
                name: item.brand,
                slug: item.brand.toLowerCase().replace(/[^a-z0-9]/g, "-"),
                input_type: "ID_ONLY",
                markup_type: "flat",
                markup_value: 2000,
              },
              { onConflict: "name" },
            )
            .select()
            .single();

          if (catErr) throw catErr;
          category = newCat;
          categoryMap.set(item.brand, category);
        }

        // Kalkulasi Harga Jual
        const cost = item.price;
        const markupVal = parseFloat(category.markup_value);
        let priceSell =
          category.markup_type === "percent"
            ? cost + cost * (markupVal / 100)
            : cost + markupVal;

        const { error: prodErr } = await supabase.from("products").upsert(
          {
            category_id: category.id,
            sku_code: item.buyer_sku_code,
            product_name: item.product_name,
            price_cost: cost,
            price_sell: Math.ceil(priceSell),
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
        // HANYA LOG JIKA TERJADI ERROR PADA PRODUK SPESIFIK
        console.error(`Gagal sync SKU ${item.buyer_sku_code}: ${err.message}`);
        failCount++;
      }
    }

    // Response Ringkas
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

// 2. Update Detail Kategori (Gambar, Input Type, Markup)
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;

    // Mengambil data apa pun yang dikirim di body tanpa mendefinisikan satu per satu
    const updateData = req.body;

    const { data, error } = await supabase
      .from("categories")
      .update(updateData) // Hanya kolom yang ada di req.body yang di-update
      .eq("id", id)
      .select();

    if (error) throw error;
    res.json({ success: true, message: "Pembaruan berhasil", data });
  } catch (error) {
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
