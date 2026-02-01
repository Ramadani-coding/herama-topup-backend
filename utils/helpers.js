const crypto = require("crypto");

const generateDigiflazzSig = (refId) => {
  const username = process.env.DIGIFLAZZ_USERNAME;
  const apiKey = process.env.DIGIFLAZZ_API_KEY;

  if (!username || !apiKey) {
    throw new Error("Username atau API Key tidak terbaca dari .env!");
  }

  const str = username + apiKey + refId;
  return crypto.createHash("md5").update(str).digest("hex");
};

const generateInvoice = () => {
  const randomDigits = Math.floor(100000 + Math.random() * 900000);
  return `HRM-${randomDigits}-INV`;
};

const verifyWebhookSig = (payload, signature) => {
  const secret = process.env.DIGIFLAZZ_WEBHOOK_SECRET; // [cite: 148]
  const hmac = crypto.createHmac("sha1", secret); //
  const expectedSig =
    "sha1=" + hmac.update(JSON.stringify(payload)).digest("hex"); // [cite: 152]
  return expectedSig === signature;
};

module.exports = { generateDigiflazzSig, generateInvoice, verifyWebhookSig };
