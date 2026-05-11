const router = require("express").Router();

const ctrl = require("../controllers/wishlistController");
const { requireAuth } = require("../middleware/auth");

router.use(requireAuth);

router.get("/", ctrl.getWishlist);

router.post("/toggle", ctrl.toggleWishlist);

module.exports = router;
