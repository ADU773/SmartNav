
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const sceneRoutes = require("./routes/sceneRoutes");
const connectDB = require("./config/db");
const projectRoutes = require("./routes/projectRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const featureRoutes = require("./routes/featureRoutes");
const visionRoutes = require("./routes/visionRoutes");

const app = express();

const { processPendingFiles } = require("./services/fileCleanup");
let cleaningFiles = false;
const retryFileCleanup = async () => {
    if (cleaningFiles || mongoose.connection.readyState !== 1) return;
    cleaningFiles = true;
    try { await processPendingFiles(); }
    catch (error) { console.error("Upload cleanup deferred:", error.message); }
    finally { cleaningFiles = false; }
};
connectDB().then(retryFileCleanup);
setInterval(retryFileCleanup, 60000).unref();

app.use(cors());
app.use(express.json());
app.use("/api", (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
            success: false,
            message: "The database is reconnecting. Check MongoDB Atlas Network Access, then try again in a moment."
        });
    }
    next();
});
app.use("/api/projects", projectRoutes);
app.use("/api/scenes", sceneRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api", featureRoutes);
app.use("/api/vision", visionRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use((error, req, res, next) => {
    if (error instanceof require("multer").MulterError) {
        return res.status(400).json({ success: false, message: error.code === "LIMIT_FILE_SIZE" ? "Image must be 500 MB or smaller." : error.message });
    }
    if (error) return res.status(400).json({ success: false, message: error.message || "Upload failed." });
    next();
});

app.get("/", (req, res) => {
    res.send("SmartNav360 Backend Running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
