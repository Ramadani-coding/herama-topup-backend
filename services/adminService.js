const supabase = require("../config/supabase"); // Pastikan pathnya benar
const { getDigiflazzBalance } = require("../utils/getDigiflazzBalance");

exports.getDashboardStats = async () => {
  // 1. Ambil Saldo
  const balance = await getDigiflazzBalance();

  // 2. Ambil Count Transaksi dari Supabase
  const { count, error } = await supabase
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .eq("status", "success");

  if (error) throw new Error(error.message);

  return {
    balance: balance,
    success_count: count || 0,
    server_status: "online",
  };
};

exports.getAllProductsWithCategory = async (
  from = 0,
  to = 9,
  filter = {},
  sort = ["product_name", "ASC"],
) => {
  const [field, order] = sort;

  // 1. Inisialisasi query dengan count: 'exact' untuk mendapatkan angka 151
  let query = supabase
    .from("products")
    .select(`*, categories (*)`, { count: "exact" });

  // 2. Logika Filter (Pencarian & Kategori)
  if (filter.q) {
    query = query.ilike("product_name", `%${filter.q}%`);
  }
  if (filter.category_id && filter.category_id !== "all") {
    query = query.eq("category_id", filter.category_id);
  }
  if (filter.status) {
    query = query.eq("status", filter.status);
  }

  // 3. Eksekusi dengan Range dan Sort
  const { data, error, count } = await query
    .range(from, to)
    .order(field, { ascending: order === "ASC" });

  if (error) throw new Error(error.message);

  return {
    products: data.map((product) => ({
      ...product,
      category_name: product.categories?.name || "No Category",
    })),
    total: count,
  };
};

const mapProductNames = async (transactions) => {
  if (!transactions || transactions.length === 0) return [];
  const { data: products } = await supabase
    .from("products")
    .select("sku_code, product_name");

  const lookup = {};
  products?.forEach((p) => (lookup[p.sku_code] = p.product_name));

  return transactions.map((item) => ({
    ...item,
    display_name: lookup[item.sku_code] || item.sku_code,
  }));
};

exports.getList = async (req, res) => {
  try {
    // 1. Ambil query dari URL
    const { filter, range, sort } = req.query;

    // 2. Debugging: Cek terminal Node.js kamu, pastikan filter.q muncul di sana!
    console.log("Filter masuk:", filter);

    // Parse string JSON dari React Admin
    const filterObj = filter ? JSON.parse(filter) : {};
    const [from, to] = range ? JSON.parse(range) : [0, 9];
    const [field, order] = sort ? JSON.parse(sort) : ["created_at", "DESC"];

    // 3. Inisialisasi Query ke Supabase
    let query = supabase.from("transactions").select("*", { count: "exact" });

    // 4. LOGIKA SEARCH: Jika ada input di kotak 'Cari Transaksi' (source='q')
    if (filterObj.q) {
      // Mencari di Ref ID, No HP, atau Kode Produk sesuai kolom di DB
      query = query.or(
        `ref_id.ilike.%${filterObj.q}%,customer_no.ilike.%${filterObj.q}%,sku_code.ilike.%${filterObj.q}%`,
      );
    }

    // 5. Jalankan Query dengan Pagination & Sorting
    const { data, count, error } = await query
      .range(from, to)
      .order(field, { ascending: order === "ASC" });

    if (error) throw error;

    // Mapping nama produk (display_name)
    const result = await mapProductNames(data);

    // 6. Header Content-Range yang AKURAT
    // Jika data difilter, 'count' akan berkurang (misal jadi 1)
    res.set("Access-Control-Expose-Headers", "Content-Range");
    res.set("Content-Range", `transactions ${from}-${to}/${count}`);

    res.json(result);
  } catch (err) {
    console.error("Kesalahan API:", err.message);
    res.status(500).json({ message: err.message });
  }
};

/**
 * 2. DETAIL TRANSAKSI (GET ONE)
 */
exports.getOne = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: "Data tidak ditemukan" });

    const result = await mapProductNames([data]);
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * 3. DASHBOARD STATS & LAINNYA
 */
exports.getDashboardStats = async () => {
  const balance = await getDigiflazzBalance();
  const { count, error } = await supabase
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .eq("status", "success");

  if (error) throw new Error(error.message);
  return { balance, success_count: count || 0, server_status: "online" };
};

exports.getAllTransactions = async () => {
  const { data: transactions, error: txError } = await supabase
    .from("transactions")
    .select("*")
    .order("created_at", { ascending: false });

  if (txError) throw new Error(txError.message);
  return await mapProductNames(transactions);
};
