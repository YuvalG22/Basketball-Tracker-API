import express from "express";
import { createGame, updateGameScore, getGames, deleteGame, getGameStats } from "../controllers/gamesController.js";

const router = express.Router();

router.post("/", createGame);
router.patch("/score", updateGameScore);
router.get("/", getGames);
router.get("/:gameId", getGameStats);
router.delete("/:remoteId", deleteGame);

export default router;