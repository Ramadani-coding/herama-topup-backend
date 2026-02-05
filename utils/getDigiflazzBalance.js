const axios = require("axios");
const crypto = require("crypto");

async function getDigiflazzBalance() {
  const username = process.env.DIGIFLAZZ_USERNAME;
  const apiKey = process.env.DIGIFLAZZ_API_KEY;

  const sign = crypto
    .createHash("md5")
    .update(username + apiKey + "depo")
    .digest("hex");

  try {
    const response = await axios.post(
      "https://api.digiflazz.com/v1/cek-saldo",
      {
        cmd: "deposit",
        username: username,
        sign: sign,
      },
    );

    if (response.data && response.data.data) {
      return response.data.data.deposit;
    }

    return 0;
  } catch (error) {
    console.error(
      "Gagal ambil saldo Digiflazz:",
      error.response?.data || error.message,
    );
    return 0;
  }
}

// TAMBAHKAN INI:
module.exports = { getDigiflazzBalance };
