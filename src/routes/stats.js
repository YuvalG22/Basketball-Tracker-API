const express = require("express");
const router = express.Router();

const {
  getSeasonStats,
  refreshSeasonStats
} = require("../controllers/statsController");

router.get("/season", getSeasonStats);
router.post("/season/refresh", refreshSeasonStats);

export default router;