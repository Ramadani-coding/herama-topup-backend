const supabase = require("../config/supabase");

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
