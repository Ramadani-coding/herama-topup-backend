const supabase = require("../config/supabase");

const verifyAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ message: "Token tidak ditemukan" });

    const token = authHeader.split(" ")[1];

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res
        .status(401)
        .json({ message: "Sesi tidak valid, silakan login ulang" });
    }

    const isAdmin = user.user_metadata?.role === "admin";

    if (!isAdmin) {
      return res
        .status(403)
        .json({ message: "Akses ditolak: Anda bukan admin" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

module.exports = { verifyAdmin };
