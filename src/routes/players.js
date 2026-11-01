import express from "express";
import { createPlayer, getPlayers, getPlayerStats, updatePlayer, deletePlayer } from "../controllers/playersController.js";

const router = express.Router();

router.post("/", createPlayer);
router.put("/:remoteId", updatePlayer);
router.delete("/:remoteId", deletePlayer);
router.get("/", getPlayers);
router.get("/:playerId", getPlayerStats);

export default router;