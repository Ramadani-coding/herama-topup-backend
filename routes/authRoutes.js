const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// URL: /api/v1/auth/login
router.post("/login", authController.loginAdmin);

module.exports = router;
