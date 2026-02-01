const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");

// Endpoint untuk mendapatkan Snap Token Midtrans
router.post("/checkout", paymentController.createPayment);
router.post("/notification", paymentController.handleNotification);

module.exports = router;
