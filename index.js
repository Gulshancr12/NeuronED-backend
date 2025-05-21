import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import connectDB from "./database/db.js";
import userRoute from "./routes/user.route.js";
import courseRoute from "./routes/course.route.js";
import mediaRoute from "./routes/media.route.js";
import purchaseRoute from "./routes/purchaseCourse.route.js";
import courseProgressRoute from "./routes/courseProgress.route.js";

// Load ENV Variables
dotenv.config();

// Database Connection
connectDB();

// Initialize Express App
const app = express();
const PORT = process.env.PORT || 8080; // Using your .env PORT

// Middleware
app.use(express.json({ limit: "50mb" })); // For large media uploads
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Enhanced CORS Setup
const allowedOrigins = [
  process.env.CLIENT_URL, // From .env
  "http://localhost:5173"
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      const msg = `CORS policy blocked ${origin}`;
      console.warn(msg);
      return callback(new Error(msg), false);
    }
  },
  credentials: true,
  exposedHeaders: ["set-cookie"] // For cookie-based auth
}));

// Security Headers
app.use((req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  next();
});

// API Routes
app.use("/api/v1/media", mediaRoute);
app.use("/api/v1/user", userRoute);
app.use("/api/v1/course", courseRoute);
app.use("/api/v1/purchase", purchaseRoute);
app.use("/api/v1/progress", courseProgressRoute);

// Health Check
app.get("/ping", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// Start Server
app.listen(PORT, () => {
  console.log(`
  🚀 Server running on port ${PORT}
  📡 Connected to MongoDB
  🌐 Allowed Origins: ${allowedOrigins.join(", ")}
  `);
});