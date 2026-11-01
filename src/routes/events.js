import express from "express";
import { createEvent, createEvents, deleteEvents, acknowledgeEvents, getEvents, deleteEvent } from "../controllers/eventsController.js";

const router = express.Router();

router.post("/", createEvent);
router.post("/batch", createEvents);
router.post("/delete", deleteEvents);
router.post("/acknowledgements", acknowledgeEvents);
router.get("/", getEvents);
router.delete("/:remoteId", deleteEvent);

export default router;
