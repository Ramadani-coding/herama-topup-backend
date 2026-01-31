const crypto = require("crypto");

const generateDigiflazzSig = (refId) => {
  const str =
    process.env.DIGIFLAZZ_USERNAME + process.env.DIGIFLAZZ_API_KEY + refId;
  return crypto.createHash("md5").update(str).digest("hex");
};

module.exports = { generateDigiflazzSig };
