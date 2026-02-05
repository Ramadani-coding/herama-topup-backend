const express = require("express");
const router = express.Router();
const adminCtrl = require("../controllers/adminController");

// Integrasi Digiflazz
router.post("/sync-products", adminCtrl.syncProducts);

// Manajemen Kategori Manual
router.get("/categories", adminCtrl.getAllCategoriesAdmin);
router.patch("/categories/:id", adminCtrl.updateCategory);
router.delete("/products/:id", adminCtrl.deleteProduct);
router.delete("/categories/:id", adminCtrl.deleteCategory);

router.get("/stats", adminCtrl.getStats);
router.get("/transactions", adminCtrl.getTransactions);
router.get("/products", adminCtrl.getProducts);

module.exports = router;
