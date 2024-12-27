import dotenv from "dotenv";
import express from "express";
import path from "path";
import bodyParser from "body-parser";
import bcrypt from "bcryptjs";
import session from "express-session";
import multer from "multer";
import pkg from "pg";
const app = express();

const { Pool } = pkg;

import { dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "./.env") });

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

const port = process.env.PORT;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

pool.connect();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));
app.use(
  "fanhub/public/assets/img/uploads",
  express.static(path.join(__dirname, "fanhub/public/assets/img/uploads"))
);

app.get("/", (req, res) => {
  try {
    res.render("main", { errorMessage: null });
  } catch (err) {
    console.log(err);
    return err;
  }
});

app.get("/signup", (req, res) => {
  try {
    res.render("register", { errorMessage: null });
  } catch (err) {
    console.log(err);
    return err;
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const userQuery = "SELECT * FROM users WHERE username = $1";
    const result = await pool.query(userQuery, [username]);

    if (result.rows.length > 0) {
      const user = result.rows[0];

      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (isPasswordValid) {
        req.session.username = user.username;
        req.session.userId = user.id;
        return res.redirect("/profile");
      } else {
        return res.render("main", { errorMessage: "Invalid password" });
      }
    } else {
      return res.render("main", { errorMessage: "User not found" });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send("Server error");
  }
});

app.get("/profile", async (req, res) => {
  try {
    const userId = req.session.userId;

    if (!userId) {
      return res.redirect("/login");
    }

    const ratingQuery =
      "SELECT AVG(rating) as avg_rating FROM ratings WHERE target_user_id = $1";
    const ratingResult = await pool.query(ratingQuery, [userId]);

    const averageRating =
      ratingResult.rows.length > 0 && ratingResult.rows[0].avg_rating
        ? Math.round(ratingResult.rows[0].avg_rating)
        : 0;

    const query = "SELECT * FROM users WHERE id = $1";
    const result = await pool.query(query, [userId]);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      return res.render("profile", { user, isOwnProfile: true, averageRating });
    } else {
      return res.status(404).send("User not found");
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send("Server error");
  }
});

app.post("/signup", async (req, res) => {
  const { username, password, email } = req.body;

  if (!username || !password || !email) {
    return res.render("register", {
      errorMessage: "Username, password, and email are required.",
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const insertUserQuery = `
      INSERT INTO users (username, password, email) 
      VALUES ($1, $2, $3) 
      RETURNING *`;
    const insertUserResult = await pool.query(insertUserQuery, [
      username,
      hashedPassword,
      email,
    ]);

    const newUser = insertUserResult.rows[0];

    req.session.username = newUser.username;
    req.session.userId = newUser.id;

    return res.status(201).redirect("/profile");
  } catch (err) {
    console.error(err);
    return res.status(500).render("register", {
      errorMessage: "Server error. Please try again later.",
    });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "fanhub/public/assets/img/uploads");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage: storage });

app.post("/upload_photo", upload.single("profile_photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("Please upload a photo.");
    }

    const photoPath = `/assets/img/uploads/${req.file.filename}`;

    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).send("You must be logged in.");
    }

    const query = "UPDATE users SET profile_photo = $1 WHERE id = $2";
    await pool.query(query, [photoPath, userId]);

    const result = await pool.query("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    const user = result.rows[0];

    const ratingQuery =
      "SELECT AVG(rating) as avg_rating FROM ratings WHERE target_user_id = $1";
    const ratingResult = await pool.query(ratingQuery, [userId]);

    const averageRating =
      ratingResult.rows.length > 0 && ratingResult.rows[0].avg_rating
        ? Math.round(ratingResult.rows[0].avg_rating)
        : 0;

    return res.render("profile", {
      user,
      isOwnProfile: true,
      averageRating,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send("An error occurred while uploading.");
  }
});

app.post("/update_profile", async (req, res) => {
  try {
    const userId = req.session.userId;
    const { description } = req.body;

    if (!userId) {
      return res.status(401).send("You must be logged in.");
    }

    const query = "UPDATE users SET description = $1 WHERE id = $2";
    await pool.query(query, [description, userId]);

    const result = await pool.query("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    const user = result.rows[0];

    const ratingQuery =
      "SELECT AVG(rating) as avg_rating FROM ratings WHERE target_user_id = $1";
    const ratingResult = await pool.query(ratingQuery, [userId]);

    const averageRating =
      ratingResult.rows.length > 0 && ratingResult.rows[0].avg_rating
        ? Math.round(ratingResult.rows[0].avg_rating)
        : 0;

    return res.render("profile", {
      user: { ...user, description },
      isOwnProfile: true,
      averageRating,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .send("An error occurred while updating the profile.");
  }
});

app.get("/search", async (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.render("search", {
      errorMessage: "Please enter a username",
      users: [],
    });
  }

  try {
    const searchQuery = `
      SELECT id, username, profile_photo 
      FROM users 
      WHERE username ILIKE $1
    `;
    const values = [`%${username}%`];

    const result = await pool.query(searchQuery, values);
    const users = result.rows;

    if (users.length > 0) {
      return res.render("search", { users, errorMessage: null });
    } else {
      return res.render("search", {
        users: [],
        errorMessage: "No users found",
      });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send("Server error");
  }
});

app.get("/profile/:id", async (req, res) => {
  const { id } = req.params;
  const currentUserId = req.session.userId;

  try {
    const userQuery = "SELECT * FROM users WHERE id = $1";
    const userResult = await pool.query(userQuery, [id]);

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      const isOwnProfile = user.id === currentUserId;

      const ratingQuery =
        "SELECT AVG(rating) as avg_rating FROM ratings WHERE target_user_id = $1";
      const ratingResult = await pool.query(ratingQuery, [id]);

      const averageRating =
        ratingResult.rows.length > 0 && ratingResult.rows[0].avg_rating
          ? Math.round(ratingResult.rows[0].avg_rating)
          : 0;

      return res.render("profile", { averageRating, user, isOwnProfile });
    } else {
      return res.status(404).send("User not found");
    }
  } catch (err) {
    return res.status(500).send("Server error");
  }
});

app.post("/submit_rating", async (req, res) => {
  const userId = req.session.userId;
  const targetUserId = req.query.userId;
  const rating = parseInt(req.body.rating);

  if (!userId) {
    return res
      .status(401)
      .json({ success: false, message: "You must be logged in to rate." });
  }

  if (userId === parseInt(targetUserId)) {
    return res
      .status(400)
      .json({ success: false, message: "You cannot rate yourself" });
  }

  if (!rating || isNaN(rating) || rating < 1 || rating > 10) {
    return res.status(400).json({
      success: false,
      message: "Invalid input. Rating must be between 1 and 10.",
    });
  }

  try {
    await pool.query(
      "INSERT INTO ratings (user_id, target_user_id, rating) VALUES ($1, $2, $3) ON CONFLICT (user_id, target_user_id) DO UPDATE SET rating = $3",
      [userId, targetUserId, rating]
    );

    const avgRatingResult = await pool.query(
      "SELECT AVG(rating) as avg_rating FROM ratings WHERE target_user_id = $1",
      [targetUserId]
    );

    const newAverage = avgRatingResult.rows[0].avg_rating
      ? parseFloat(avgRatingResult.rows[0].avg_rating).toFixed(1)
      : 0;

    return res.json({ success: true, newAverage });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/update-nickname", async (req, res) => {
  const userId = req.session.userId;
  const { nickname } = req.body;

  if (!userId) {
    return res.status(401).send("You must be logged in.");
  }

  try {
    const query = "UPDATE users SET username = $1 WHERE id = $2 RETURNING *";
    const result = await pool.query(query, [nickname, userId]);

    if (result.rows.length > 0) {
      const updatedUser = result.rows[0];
      req.session.username = updatedUser.username; // Update session with new username
      res
        .status(200)
        .json({ success: true, newUsername: updatedUser.username });
    } else {
      res.status(404).json({ success: false, message: "User not found." });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "An error occurred." });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
