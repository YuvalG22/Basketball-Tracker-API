import express from "express";
import { createPlayer, getPlayers, getPlayerStats } from "../controllers/playersController.js";

const router = express.Router();

router.post("/", createPlayer);
router.get("/", getPlayers);
router.get("/:playerId", getPlayerStats);

export default router;