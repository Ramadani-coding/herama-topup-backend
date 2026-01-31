const express = require("express");
const router = express.Router();
const publicCtrl = require("../controllers/publicController");

router.get("/categories", publicCtrl.getCategories);
router.get("/categories/:slug", publicCtrl.getCategoryDetail);
router.get("/search", publicCtrl.searchCategories);

module.exports = router;
