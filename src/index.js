import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import eventsRoutes from "./routes/events.js";
import gamesRoutes from "./routes/games.js";
import playersRoutes from "./routes/players.js";
import rosterRoutes from "./routes/roster.js";
import path from "path";
import { fileURLToPath } from "url";


dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// app.get("/", (req, res) => {
//   res.send("Basketball backend is running");
// });

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use("/events", eventsRoutes);
app.use("/games", gamesRoutes);
app.use("/players", playersRoutes);
app.use("/roster", rosterRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});