import express from "express";
import { createRoster } from "../controllers/rosterController.js";

const router = express.Router();

router.post("/", createRoster);

export default router;