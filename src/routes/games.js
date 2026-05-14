import express from "express";
import { createGame, updateGameScore, getGames, deleteGame, getGameStats, getHomeGame, updateGame } from "../controllers/gamesController.js";

const router = express.Router();

router.post("/", createGame);
router.patch("/score", updateGameScore);
router.get("/home", getHomeGame);
router.get("/", getGames);
router.get("/:gameId", getGameStats);
router.put("/:remoteId", updateGame);
router.delete("/:remoteId", deleteGame);

export default router;