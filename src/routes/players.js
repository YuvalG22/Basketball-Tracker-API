import express from "express";
import { createPlayer } from "../controllers/playersController.js";

const router = express.Router();

router.post("/", createPlayer);
router.get("/", getPlayers);

export default router;