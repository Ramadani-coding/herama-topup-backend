const express = require("express");
const router = express.Router();
const publicCtrl = require("../controllers/publicController");

router.get("/categories", publicCtrl.getCategories);
router.get("/categories/:slug", publicCtrl.getCategoryDetail);
router.get("/search", publicCtrl.searchCategories);

router.post("/transaction", publicCtrl.processTopup);
router.get("/transaction/:ref_id", publicCtrl.checkStatus);
router.post("/webhook/digiflazz", publicCtrl.digiflazzWebhook);

module.exports = router;
