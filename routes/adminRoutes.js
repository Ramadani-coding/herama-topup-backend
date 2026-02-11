const express = require("express");
const router = express.Router();
const adminCtrl = require("../controllers/adminController");
const { verifyAdmin } = require("../middleware/authMiddleware");

router.post("/products/sync", verifyAdmin, adminCtrl.syncProducts);

router.get("/categories", adminCtrl.getAllCategoriesAdmin);
router.patch("/categories/:id", adminCtrl.updateCategory);
router.delete("/categories/:id", adminCtrl.deleteCategory);

router.get("/products", verifyAdmin, adminCtrl.getProducts);
router.get("/products/:id", verifyAdmin, adminCtrl.getProductDetail);
router.delete("/products/:id", verifyAdmin, adminCtrl.deleteProduct);

router.get("/transactions", verifyAdmin, adminCtrl.getList);
router.get("/transactions/:id", verifyAdmin, adminCtrl.getTransactionById);

module.exports = router;
