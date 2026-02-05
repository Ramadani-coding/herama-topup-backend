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

exports.getAllTransactions = async () => {
  // 1. Ambil semua transaksi dari Supabase
  const { data: transactions, error: txError } = await supabase
    .from("transactions")
    .select("*")
    .order("created_at", { ascending: false });

  if (txError) throw new Error(txError.message);

  // 2. Ambil data produk (berdasarkan image_c075be.png)
  const { data: products, error: prodError } = await supabase
    .from("products")
    .select("sku_code, product_name");

  if (prodError) throw new Error(prodError.message);

  // 3. Buat 'Map' untuk pencarian nama produk yang cepat
  const productLookup = {};
  products.forEach((p) => {
    productLookup[p.sku_code] = p.product_name;
  });

  // 4. Gabungkan: Tambahkan properti 'display_name' ke setiap transaksi
  return transactions.map((item) => ({
    ...item,
    display_name: productLookup[item.sku_code] || item.sku_code, // Jika nama tidak ada, balik ke SKU
  }));
};

exports.getAllProductsWithCategory = async (
  page = 1,
  limit = 10,
  category_id = null,
  status = null,
) => {
  const p = Number(page) || 1;
  const l = Number(limit) || 10;
  const from = (p - 1) * l;
  const to = from + l - 1;

  // Mulai inisialisasi query
  let query = supabase
    .from("products")
    .select(`*, categories (*)`, { count: "exact" });

  // Filter Kategori (Jika ada)
  if (category_id && category_id !== "all") {
    query = query.eq("category_id", category_id);
  }

  // BARU: Filter Status (Jika ada)
  if (status) {
    query = query.eq("status", status); // Contoh: status = 'inactive'
  }

  const { data, error, count } = await query
    .range(from, to)
    .order("product_name", { ascending: true });

  if (error) throw new Error(error.message);

  return {
    products: data.map((product) => ({
      ...product,
      category_name: product.categories?.name || "No Category",
    })),
    total: count,
    page: p,
    limit: l,
  };
};
