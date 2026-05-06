import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import eventsRoutes from "./routes/events.js";
import gamesRoutes from "./routes/games.js";
import playersRoutes from "./routes/players.js";
import rosterRoutes from "./routes/roster.js";


dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Basketball backend is running");
});

app.use("/events", eventsRoutes);
app.use("/games", gamesRoutes);
app.use("/players", playersRoutes);
app.use("/roster", rosterRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});