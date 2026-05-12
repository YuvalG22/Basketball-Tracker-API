import express from "express"
import {getSeasonStats, refreshSeasonStats} from "../controllers/statsController.js";

const router = express.Router();

router.get("/season", getSeasonStats);
router.post("/season/refresh", refreshSeasonStats); 

export default router;