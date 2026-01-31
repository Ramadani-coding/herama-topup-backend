const axios = require("axios");
const crypto = require("crypto");

exports.fetchPriceList = async () => {
  try {
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;
    const sign = crypto
      .createHash("md5")
      .update(username + apiKey + "pricelist")
      .digest("hex");

    const response = await axios.post(
      "https://api.digiflazz.com/v1/price-list",
      {
        cmd: "prepaid",
        username: username,
        sign: sign,
      },
    );

    // HAPUS ATAU KOMENTAR BARIS DI BAWAH INI:
    // console.log("Respon Digiflazz:", JSON.stringify(response.data, null, 2));

    return response.data.data;
  } catch (error) {
    console.error("Gagal konek ke Digiflazz:", error.message);
    throw error;
  }
};
