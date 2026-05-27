import express from "express";
import { createEvent, getEvents } from "../controllers/eventsController.js";

const router = express.Router();

router.post("/", createEvent);
router.get("/", getEvents);
router.delete("/:remoteId", deleteEvent);

export default router;