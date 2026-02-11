const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Proses login ke Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return res.status(401).json({ message: error.message });

    // 2. Cek metadata 'role' yang tadi kamu buat di Dashboard Supabase
    const isAdmin = data.user.user_metadata?.role === "admin";

    if (!isAdmin) {
      await supabase.auth.signOut();
      return res
        .status(403)
        .json({ message: "Akses ditolak: Anda bukan admin" });
    }

    // 3. Kirim data sukses ke React Admin
    res.json({
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata.full_name || "Admin",
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan pada server" });
  }
};

module.exports = { loginAdmin };
