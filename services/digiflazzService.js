const axios = require("axios");
const crypto = require("crypto");
const { generateDigiflazzSig } = require("../utils/helpers");

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

exports.createDigiflazzTransaction = async (sku, customerNo, refId) => {
  try {
    const payload = {
      username: process.env.DIGIFLAZZ_USERNAME,
      buyer_sku_code: sku,
      customer_no: customerNo,
      ref_id: refId,
      sign: generateDigiflazzSig(refId),
    };

    const response = await axios.post(
      "https://api.digiflazz.com/v1/transaction", //
      payload,
    );

    // Response dibungkus oleh variabel 'data'
    return response.data.data;
  } catch (error) {
    console.error(
      "Gagal konek ke Digiflazz (Transaction):",
      error.response?.data || error.message,
    );
    throw error;
  }
};
