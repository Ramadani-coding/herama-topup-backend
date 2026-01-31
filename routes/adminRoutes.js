const express = require("express");
const router = express.Router();
const adminCtrl = require("../controllers/adminController");

// Integrasi Digiflazz
router.post("/sync-products", adminCtrl.syncProducts);

// Manajemen Kategori Manual
router.get("/categories", adminCtrl.getAllCategoriesAdmin);
router.patch("/categories/:id", adminCtrl.updateCategory);
router.delete("/categories/:id", adminCtrl.deleteCategory);

module.exports = router;
