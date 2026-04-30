import express from "express";
import { createGame, updateGameScore, getGames } from "../controllers/gamesController.js";

const router = express.Router();

router.post("/", createGame);
router.patch("/score", updateGameScore);
router.get("/", getGames);

export default router;