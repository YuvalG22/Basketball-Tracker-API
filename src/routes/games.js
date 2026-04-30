import express from "express";
import { createGame, updateGameScore } from "../controllers/gamesController.js";

const router = express.Router();

router.post("/", createGame);
router.patch("/score", updateGameScore);

export default router;