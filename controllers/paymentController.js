const axios = require("axios");
const snap = require("../config/midtrans");
const crypto = require("crypto");
const supabase = require("../config/supabase");
const { createDigiflazzTransaction } = require("../services/digiflazzService");
const { generateInvoice } = require("../utils/helpers");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.createPayment = async (req, res) => {
  const { sku_code, customer_no, phone_number, payment_method, amount } =
    req.body;

  // 1. DETEKSI PERANGKAT VIA HEADER
  const userAgent = req.headers["user-agent"] || "";
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      userAgent,
    );

  const username = process.env.DIGIFLAZZ_USERNAME;
  const apiKey = process.env.DIGIFLAZZ_API_KEY;
  const sign = crypto
    .createHash("md5")
    .update(username + apiKey + "depo")
    .digest("hex");

  try {
    // 1. AMBIL DATA PRODUK DARI DATABASE
    const { data: product, error: prodError } = await supabase
      .from("products")
      .select("price_cost, price_sell, product_name")
      .eq("sku_code", sku_code)
      .single();

    if (prodError || !product) {
      return res
        .status(404)
        .json({ success: false, message: "Produk tidak ditemukan." });
    }

    const costPrice = product.price_cost;
    const basePrice = product.price_sell;

    // 2. LOGIKA PERHITUNGAN FEE DINAMIS
    let fee = 0;
    const method = payment_method.toLowerCase();

    if (method === "gopay") {
      fee = isMobile ? Math.ceil(basePrice * 0.02) : 0;
    }
    // TAMBAHAN: Logika Fee DANA 1.5%
    else if (method === "dana") {
      fee = Math.ceil(basePrice * 0.015);
    } else if (
      method.includes("va") ||
      method.includes("bank") ||
      method.includes("echannel")
    ) {
      fee = 4000;
    }

    const totalAmount = basePrice + fee;

    // 3. CEK SALDO DIGIFLAZZ
    const digiRes = await axios.post("https://api.digiflazz.com/v1/cek-saldo", {
      cmd: "deposit",
      username: username,
      sign: sign,
    });

    if (digiRes.data.data.deposit < costPrice) {
      return res.status(400).json({
        success: false,
        message:
          "Maaf, stok produk sedang habis atau sistem sedang maintenance. Mohon coba lagi nanti.",
      });
    }

    const invoice = generateInvoice();

    const frontendUrl = "https://store.herama.my.id";

    // 4. KONFIGURASI MIDTRANS
    let parameter = {
      transaction_details: { order_id: invoice, gross_amount: totalAmount },
      customer_details: { phone: phone_number },
      enabled_payments: [payment_method],

      // --- INI ADALAH KODE YANG DITAMBAHKAN ---
      // Midtrans akan otomatis menggabungkan URL ini dengan Order ID yang sedang diproses
      callbacks: {
        finish: `${frontendUrl}/transaction/${invoice}`,
        error: `${frontendUrl}/transaction/${invoice}`,
        pending: `${frontendUrl}/transaction/${invoice}`,
      },
      // ----------------------------------------

      item_details: [
        {
          id: sku_code,
          price: totalAmount,
          quantity: 1,
          name: product.product_name,
        },
      ],
    };

    const transaction = await snap.createTransaction(parameter);

    // 5. SIMPAN KE DATABASE (FIX: Tangkap variabel insertError di sini)
    const { error: insertError } = await supabase.from("transactions").insert([
      {
        ref_id: invoice,
        customer_no,
        sku_code,
        amount_sell: basePrice,
        amount_cost: costPrice,
        fee: fee,
        phone_number,
        payment_method,
        status: "pending",
        payment_status: "pending",
        snap_token: transaction.token,
      },
    ]);

    // Sekarang variabel insertError sudah terdefinisi
    if (insertError) {
      console.error("Database Insert Error:", insertError);
      throw new Error("Gagal menyimpan data transaksi ke database.");
    }

    return res.status(200).json({
      success: true,
      data: { invoice, snap_token: transaction.token },
    });
  } catch (error) {
    console.error("Internal Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.handleNotification = async (req, res) => {
  const notification = req.body;

  try {
    const orderId = notification.order_id; // Ini adalah ref_id kita
    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;

    console.log(
      `Menerima Webhook Midtrans untuk Invoice: ${orderId} [Status: ${transactionStatus}]`,
    );

    // 1. Ambil data transaksi dari database untuk mendapatkan detail produk
    const { data: trx, error: fetchError } = await supabase
      .from("transactions")
      .select("*")
      .eq("ref_id", orderId)
      .single();

    if (fetchError || !trx) {
      return res
        .status(404)
        .json({ message: "Transaksi tidak ditemukan di database" });
    }

    // 2. Tentukan status pembayaran (Settlement/Capture berarti Sukses)
    let isPaymentSuccess = false;
    if (transactionStatus === "capture" || transactionStatus === "settlement") {
      if (fraudStatus === "accept" || !fraudStatus) {
        isPaymentSuccess = true;
      }
    }

    // 3. Update status pembayaran di database kita
    // Kita gunakan kolom status untuk melacak alur keseluruhan
    const currentPaymentStatus = isPaymentSuccess
      ? "success"
      : transactionStatus;

    await supabase
      .from("transactions")
      .update({
        payment_status: currentPaymentStatus, // Pastikan kolom ini sudah kamu tambahkan di SQL
        payment_method: notification.payment_type,
      })
      .eq("ref_id", orderId);

    // 4. JALANKAN TOPUP OTOMATIS: Hanya jika pembayaran sukses dan belum pernah di-topup
    if (isPaymentSuccess && trx.status === "pending") {
      console.log(
        `Pembayaran Terverifikasi! Memulai transaksi Digiflazz untuk ${orderId}...`,
      );

      try {
        // Parameter WAJIB: sku_code, customer_no, ref_id
        const digiResponse = await createDigiflazzTransaction(
          trx.sku_code,
          trx.customer_no,
          orderId,
        );

        // Update hasil dari Digiflazz ke database
        await supabase
          .from("transactions")
          .update({
            status: digiResponse.status.toLowerCase(), // Sukses/Pending/Gagal
            sn: digiResponse.sn || "", // Nomor SN
            message: digiResponse.message, // Pesan dari Digiflazz
            amount_cost: digiResponse.price, // Harga modal asli
            digiflazz_ref_id: digiResponse.ref_id, // Ref ID Digiflazz
          })
          .eq("ref_id", orderId);

        console.log(`Topup Otomatis Berhasil untuk Invoice: ${orderId}`);
      } catch (digiError) {
        console.error(
          "Gagal menembak Digiflazz setelah pembayaran:",
          digiError.message,
        );
        // Tetap catat error di database agar admin bisa cek manual
        await supabase
          .from("transactions")
          .update({
            message:
              "Pembayaran Berhasil, tapi Gagal kirim ke Digiflazz: " +
              digiError.message,
          })
          .eq("ref_id", orderId);
      }
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook Payment Error:", error.message);
    return res.status(500).send("Internal Server Error");
  }
};

exports.checkNickname = async (req, res) => {
  const { sku_code, customer_no } = req.body;
  const ref_id = `CHK-${Date.now()}`;

  try {
    let nickname = "Pastikan ID sudah benar";
    let isFinished = false;
    let attempts = 0;

    while (!isFinished && attempts < 5) {
      const response = await createDigiflazzTransaction(
        sku_code,
        customer_no,
        ref_id,
      );

      const status = response.status.toLowerCase();

      if (status === "sukses") {
        nickname = parseNickname(response.sn);
        isFinished = true;
      } else if (status === "gagal") {
        // --- LOGIKA PESAN ERROR INFORMATIF ---
        let msg = response.message || "Transaksi Gagal";

        // Cek jika pesan dari Digiflazz mengindikasikan ID salah
        // Biasanya berisi "Tujuan Salah", "Data tidak ditemukan", atau "RC 42"
        if (
          msg.toLowerCase().includes("tujuan salah") ||
          msg.toLowerCase().includes("tidak ditemukan") ||
          msg.toLowerCase().includes("invalid")
        ) {
          msg =
            "ID atau Server tidak ditemukan. Silakan periksa kembali data akun Anda agar tidak terjadi kesalahan pengiriman.";
        }

        return res.status(400).json({
          success: false,
          message: msg,
        });
      } else {
        attempts++;
        await sleep(2000);
      }
    }

    return res.status(200).json({ success: true, nickname });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const parseNickname = (sn) => {
  if (!sn) return "Nickname tidak ditemukan";
  const parts = sn.split("Username ");
  if (parts.length > 1) {
    return parts[1].split(" /")[0];
  }
  return sn;
};
