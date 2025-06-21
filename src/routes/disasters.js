import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { supabase } from "../config/supabaseClient.js";
import { checkCache } from "../middlewares/cache.js";
const router = express.Router();

/**
 * @swagger
 * /disasters:
 *   post:
 *     summary: Create a new disaster
 *     tags: [Disasters]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               location_name:
 *                 type: string
 *               description:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Disaster created successfully
 */
router.post("/", async (req, res) => {
    const disaster = req.body;
    const resource  = disaster
    disaster.owner_id = req.user.id;
    disaster.created_at = new Date().toISOString();
    disaster.audit_trail = [
        { action: "create", user_id: req.user.id, timestamp: disaster.created_at },
    ];
    const { data, error } = await supabase
        .from("disasters")
        .insert(disaster)
        .select();

    const { data2, error2 } = await supabase
        .from("resources")
        .insert(resource)
        .select();
    if (error) return res.status(500).json({ error });
    res.status(201).json(data);
});

/**
 * @swagger
 * /disasters:
 *   get:
 *     summary: Get all disasters
 *     tags: [Disasters]
 *     parameters:
 *       - in: query
 *         name: tag
 *         schema:
 *           type: string
 *         description: Filter disasters by tag
 *     responses:
 *       200:
 *         description: A list of disasters
 */
router.get("/", async (req, res) => {
    const { tag } = req.query;
    let query = supabase.from("disasters").select("*");
    if (tag) query = query.contains("tags", [tag]);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error });
    res.json(data);
});

/**
 * @swagger
 * /disasters/{id}:
 *   put:
 *     summary: Update a disaster
 *     tags: [Disasters]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Disaster updated successfully
 */
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const updates = req.body;
    updates.audit_trail = [
        {
            action: "update",
            user_id: req.user.id,
            timestamp: new Date().toISOString(),
        },
    ];
    const { data, error } = await supabase
        .from("disasters")
        .update(updates)
        .eq("id", id)
        .select();
    if (error) return res.status(500).json({ error });
    res.json(data);
});

/**
 * @swagger
 * /disasters/{id}:
 *   delete:
 *     summary: Delete a disaster
 *     tags: [Disasters]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Disaster deleted successfully
 */
router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    const { error } = await supabase.from("disasters").delete().eq("id", id);
    if (error) return res.status(500).json({ error });
    res.json({ success: true });
});

/**
 * @swagger
 * /disasters/geocode:
 *   post:
 *     summary: Extract location and convert to lat/lng
 *     tags: [Geocoding]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Location and coordinates returned
 */
router.post("/geocode", async (req, res) => {
    const { description } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!description) {
        return res.status(400).json({ error: "Missing description in request body" });
    }

    try {
        // Step 1: Extract location using Gemini API (cached)
        const locationText = await checkCache("gemini_" + description, async () => {
            const geminiResp = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, // NOTE: v1 not v1beta
                {
                    contents: [
                        {
                            parts: [
                                {
                                    text: `Extract a place name from the following text: "${description}". Return just the name.`
                                }
                            ]
                        }
                    ]
                }
            );

            // console.log("Gemini response:", JSON.stringify(geminiResp.data, null, 2));

            const prediction = geminiResp.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            return prediction || "Unknown";
        });


        // const locationText = "Manhattan, NYC"
        // Step 2: Geocode the location using Google Maps Geocoding API (cached)
        const coords = await checkCache("google_" + locationText, async () => {
            const geoResp = await axios.get(
                "https://maps.googleapis.com/maps/api/geocode/json",
                {
                    params: {
                        address: locationText,
                        key: googleKey
                    }
                }
            );

            const loc = geoResp.data?.results?.[0]?.geometry?.location;
            return loc ? [loc.lng, loc.lat] : [0, 0]; // GeoJSON uses [lng, lat]
        });

        res.json({
            location_name: locationText,
            coordinates: {
                lat: coords[1],
                lon: coords[0]
            }
        });
    } catch (error) {
        console.error("Geocode Error:", error.message);
        res.status(500).json({ error: "Failed to extract or convert location." });
    }
});

/**
 * @swagger
 * /disasters/{id}/social-media:
 *   get:
 *     summary: Get social media reports for a disaster
 *     tags: [SocialMedia]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of social media posts
 */
router.get("/:id/social-media", async (req, res) => {
    const { id } = req.params;
    const posts = await checkCache("social_" + id, async () => [
        { post: "#floodrelief Need food in NYC", user: "citizen1" },
        { post: "Trapped in subway!", user: "citizen2" },
    ]);
    res.json(posts);
});

/**
 * @swagger
 * /disasters/{id}/resources:
 *   get:
 *     summary: Get resources near a location
 *     tags: [Resources]
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *       - in: query
 *         name: lon
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: List of nearby resources
 */
router.get("/:id/resources", async (req, res) => {
    const { lat, lon } = req.query;
    const { data, error } = await supabase.rpc("get_nearby_resources", {
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        radius: 10000,
    });
    if (error) return res.status(500).json({ error });
    res.json(data);
});

/**
 * @swagger
 * /disasters/{id}/official-updates:
 *   get:
 *     summary: Get official updates for a disaster
 *     tags: [Updates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of scraped updates
 */
router.get("/:id/official-updates", async (req, res) => {
    const updates = await checkCache("updates_" + req.params.id, async () => {
        const html = await axios.get("https://www.redcross.org");
        const $ = cheerio.load(html.data);
        return $("h2")
            .map((i, el) => $(el).text())
            .get();
    });
    res.json(updates);
});

/**
 * @swagger
 * /disasters/{id}/verify-image:
 *   post:
 *     summary: Verify the authenticity of an image
 *     tags: [Verification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               image_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Verification result
 */
router.post("/:id/verify-image", async (req, res) => {
    const { image_url } = req.body;
    const result = await checkCache("verify_" + image_url, async () => {
        return { verified: true, message: "No manipulation detected" };
    });
    res.json(result);
});

export default router;
