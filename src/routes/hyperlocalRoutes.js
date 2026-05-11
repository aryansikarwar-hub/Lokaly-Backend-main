const router = require("express").Router();
const ctrl = require("../controllers/hyperlocalController");

// All hyperlocal endpoints are public — buyers don't need to log in to see
// what's near them. Auth is only used downstream (cart, checkout).
router.get("/sellers/nearby", ctrl.nearbySellers);
router.get("/products/nearby", ctrl.nearbyProducts);
router.get("/products/trending", ctrl.trendingProducts);
router.post("/products/:id/view", ctrl.trackView);

module.exports = router;
