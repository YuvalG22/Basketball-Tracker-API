import express from "express";
import { createRoster, getRoster } from "../controllers/rosterController.js";

const router = express.Router();

router.post("/", createRoster);
router.get("/", getRoster);

export default router;