const snap = require("../config/midtrans");
const supabase = require("../config/supabase");
const { createDigiflazzTransaction } = require("../services/digiflazzService");
const { generateInvoice } = require("../utils/helpers");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.createPayment = async (req, res) => {
  const { sku_code, customer_no, phone_number, payment_method, amount } =
    req.body;

  try {
    const invoice = generateInvoice();

    let parameter = {
      transaction_details: {
        order_id: invoice,
        gross_amount: amount, // Gunakan amount yang sudah termasuk fee dari frontend
      },
      customer_details: {
        phone: phone_number,
      },
      // INI KUNCINYA: Membatasi agar langsung ke metode yang dipilih
      enabled_payments: [payment_method],
      item_details: [
        {
          id: sku_code,
          price: amount,
          quantity: 1,
          name: `Top Up ${sku_code}`,
        },
      ],
    };

    const transaction = await snap.createTransaction(parameter);

    // Simpan ke DB
    await supabase.from("transactions").insert([
      {
        ref_id: invoice,
        customer_no,
        sku_code,
        amount_sell: amount,
        phone_number,
        payment_method, // Simpan metode pembayaran
        status: "pending",
        payment_status: "pending",
        snap_token: transaction.token,
      },
    ]);

    return res.status(200).json({
      success: true,
      data: { invoice, snap_token: transaction.token },
    });
  } catch (error) {
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
  const ref_id = `CHK-${Date.now()}`; // Gunakan satu ref_id yang sama untuk pengecekan ini

  try {
    let nickname = "Transaksi Pending";
    let isFinished = false;
    let attempts = 0;

    // Lakukan pengulangan (Polling) maksimal 5 kali
    while (!isFinished && attempts < 5) {
      const response = await createDigiflazzTransaction(
        sku_code,
        customer_no,
        ref_id,
      );

      if (response.status.toLowerCase() === "sukses") {
        // Jika sukses, ambil Nickname dari SN dan hentikan loop
        nickname = parseNickname(response.sn);
        isFinished = true;
      } else if (response.status.toLowerCase() === "gagal") {
        return res
          .status(400)
          .json({ success: false, message: response.message });
      } else {
        // Jika masih pending, tunggu 2 detik sebelum coba lagi
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
