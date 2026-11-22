import express from 'express';
import cors from "cors";
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import Stripe from 'stripe';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const app = express();
const port = process.env.PORT;

// CLIENT_URL may hold several origins separated by commas (local + production)
const clientOrigins = (process.env.CLIENT_URL ?? "").split(",").map((url) => url.trim()).filter(Boolean);
const CLIENT_URL = clientOrigins[0];

app.use(cors({ origin: clientOrigins }));

app.use(express.json());

const client = new MongoClient(process.env.BETTER_AUTH_MONGO_DB_URL);
export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}

const mongoDBClient = await connectToMongoDB();
const db = mongoDBClient.db("fixmate");
const serviceCollection = db.collection("services");
const userCollection = db.collection("user");
const bookingCollection = db.collection("bookings");

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const isValidId = (id) => ObjectId.isValid(id) && String(new ObjectId(id)) === id;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ACTIVE_STATUSES = ["requested", "accepted", "in-progress"];

/* ------------------------------------------------------------------ */
/* Middlewares (Challenge 2)                                           */
/* ------------------------------------------------------------------ */

// Public keys of the BetterAuth JWT plugin (served by the Next.js app)
const JWKS = createRemoteJWKSet(new URL(`${CLIENT_URL}/api/auth/jwks`));

const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).send({ message: "Unauthorized access" });
    }

    try {
        const { payload } = await jwtVerify(token, JWKS);
        // Always read the latest role from the database (an admin may have changed it)
        const user = await userCollection.findOne({ email: payload.email });
        if (!user) {
            return res.status(401).send({ message: "Unauthorized access" });
        }
        req.user = user;
        next();
    } catch {
        return res.status(401).send({ message: "Unauthorized access" });
    }
};

const verifyRole = (role) => (req, res, next) => {
    if (req.user?.role !== role) {
        return res.status(403).send({ message: "Forbidden access" });
    }
    next();
};

const verifyCustomer = verifyRole("customer");
const verifyTechnician = verifyRole("technician");
const verifyAdmin = verifyRole("admin");

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

app.get('/', (req, res) => {
    res.send('FixMate server is running');
});

/* ---------- Users ---------- */

// Public technician profile — only safe fields, never email/phone
app.get("/user/:id", async (req, res) => {
    const { id } = req.params;
    if (!isValidId(id)) {
        return res.status(404).send({ message: "User not found" });
    }

    const result = await userCollection.findOne(
        { _id: new ObjectId(id) },
        { projection: { name: 1, image: 1, area: 1, location: 1, bio: 1 } }
    );
    if (!result) {
        return res.status(404).send({ message: "User not found" });
    }
    res.send(result);
});

// Update own profile only
app.patch("/user/:id", verifyToken, async (req, res) => {
    const { id } = req.params;
    if (String(req.user._id) !== id) {
        return res.status(403).send({ message: "Forbidden access" });
    }

    // Email and role can never be changed here
    const { name, image, phone, area, bio } = req.body;
    const update = Object.fromEntries(
        Object.entries({ name, image, phone, area, bio }).filter(([, value]) => value !== undefined)
    );

    const result = await userCollection.updateOne(
        { _id: req.user._id },
        { $set: { ...update, updatedAt: new Date() } }
    );
    res.send(result);
});

/* ---------- Services ---------- */

// Public list with server-side search, filter and sort (Challenge 1)
app.get("/services", async (req, res) => {
    const { search, category, mode, sort } = req.query;

    const query = {
        approvalStatus: "approved",
        isAvailable: true
    }

    if (search) {
        const regex = new RegExp(escapeRegex(search), "i");
        query.$or = [{ title: regex }, { category: regex }];
    }
    if (category) query.category = category;
    if (mode) query.serviceMode = mode;

    const sortBy =
        sort === "price-asc" ? { basePrice: 1 } :
            sort === "price-desc" ? { basePrice: -1 } :
                { createdAt: -1 };

    const result = await serviceCollection.find(query).sort(sortBy).toArray();
    res.send(result);
})

app.get("/service-limit", async (req, res) => {

    const query = {
        approvalStatus: "approved",
        isAvailable: true
    }

    const result = await serviceCollection.find(query).sort({ createdAt: -1 }).limit(6).toArray();
    res.send(result);

})

// Logged-in technician's own services (every status)
app.get("/services/technician", verifyToken, verifyTechnician, async (req, res) => {
    const result = await serviceCollection
        .find({ technicianEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();
    res.send(result);
})

app.get("/service/:id", async (req, res) => {
    const { id } = req.params;
    if (!isValidId(id)) {
        return res.send(null);
    }
    const query = { _id: new ObjectId(id) }
    const result = await serviceCollection.findOne(query);
    res.send(result);
})

app.post("/service", verifyToken, verifyTechnician, async (req, res) => {
    const { title, category, description, image, basePrice, estimatedDuration, serviceMode, serviceArea } = req.body;

    if (!title || !category || !description || !image || !estimatedDuration || !serviceMode || !serviceArea || !(Number(basePrice) > 0)) {
        return res.status(400).send({ message: "Please fill in every field with a valid value." });
    }

    const service = {
        title,
        category,
        description,
        image,
        basePrice: Number(basePrice),
        estimatedDuration,
        serviceMode,
        serviceArea,
        technicianName: req.user.name,
        technicianEmail: req.user.email,
        technicianId: String(req.user._id),
        approvalStatus: "pending",
        isAvailable: true,
        createdAt: new Date(),
    };

    const result = await serviceCollection.insertOne(service);
    res.send(result);
})

app.patch("/service/:id", verifyToken, verifyTechnician, async (req, res) => {
    const { id } = req.params;
    if (!isValidId(id)) {
        return res.status(404).send({ message: "Service not found" });
    }

    const service = await serviceCollection.findOne({ _id: new ObjectId(id) });
    if (!service) {
        return res.status(404).send({ message: "Service not found" });
    }
    if (service.technicianEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden access" });
    }

    const { title, category, description, image, basePrice, estimatedDuration, serviceMode, serviceArea, isAvailable } = req.body;
    const edits = Object.fromEntries(
        Object.entries({ title, category, description, image, estimatedDuration, serviceMode, serviceArea })
            .filter(([, value]) => value !== undefined)
    );
    if (basePrice !== undefined) {
        if (!(Number(basePrice) > 0)) {
            return res.status(400).send({ message: "Base price must be a positive number" });
        }
        edits.basePrice = Number(basePrice);
    }

    const UpdateData = { ...edits };
    if (typeof isAvailable === "boolean") UpdateData.isAvailable = isAvailable;
    // Any content edit sends the service back to admin review
    if (Object.keys(edits).length > 0) UpdateData.approvalStatus = "pending";

    const result = await serviceCollection.updateOne(
        { _id: service._id },
        {
            $set: {
                ...UpdateData
            }
        }
    )
    res.send(result);
})

app.delete("/service/:id", verifyToken, verifyTechnician, async (req, res) => {
    const { id } = req.params;
    if (!isValidId(id)) {
        return res.status(404).send({ message: "Service not found" });
    }
    const result = await serviceCollection.deleteOne({ _id: new ObjectId(id), technicianEmail: req.user.email });
    if (result.deletedCount === 0) {
        return res.status(403).send({ message: "Forbidden access" });
    }
    res.send(result);
})

/* ---------- Bookings (repair requests) ---------- */

// Customer sends a repair request
app.post("/booking-request", verifyToken, verifyCustomer, async (req, res) => {
    const { serviceId, customerPhone, address, preferredDate, problemDescription } = req.body;

    if (!isValidId(serviceId)) {
        return res.status(404).send({ message: "Service not found" });
    }

    const service = await serviceCollection.findOne({ _id: new ObjectId(serviceId) });
    if (!service || service.approvalStatus !== "approved" || !service.isAvailable) {
        return res.status(404).send({ message: "Service not found" });
    }
    if (service.technicianEmail === req.user.email) {
        return res.status(403).send({ message: "You cannot request your own service" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const date = new Date(preferredDate);

    if (!customerPhone || !address) {
        return res.status(400).send({ message: "Phone and address are required" });
    }
    if (Number.isNaN(date.getTime()) || date < today) {
        return res.status(400).send({ message: "Preferred date must be today or a future date" });
    }
    if (!problemDescription || problemDescription.trim().length < 20) {
        return res.status(400).send({ message: "Problem description must be at least 20 characters" });
    }

    // One active request per customer per service
    const activeRequest = await bookingCollection.findOne({
        serviceId,
        customerEmail: req.user.email,
        status: { $in: ACTIVE_STATUSES },
    });
    if (activeRequest) {
        return res.status(409).send({ message: "You already have an active request for this service" });
    }

    const booking = {
        serviceId,
        serviceTitle: service.title,
        serviceImage: service.image,
        category: service.category,
        basePrice: Number(service.basePrice),
        technicianName: service.technicianName,
        technicianEmail: service.technicianEmail,
        customerName: req.user.name,
        customerEmail: req.user.email,
        customerPhone,
        address,
        preferredDate: date,
        problemDescription: problemDescription.trim(),
        status: "requested",
        finalAmount: Number(service.basePrice),
        paymentStatus: "unpaid",
        createdAt: new Date(),
    };

    const result = await bookingCollection.insertOne(booking);
    res.send(result);
})

// Customer: own bookings
app.get("/booking-request/my", verifyToken, verifyCustomer, async (req, res) => {
    const result = await bookingCollection
        .find({ customerEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();
    res.send(result);
})

// Technician: jobs for own services
app.get("/booking-request/technician", verifyToken, verifyTechnician, async (req, res) => {
    const result = await bookingCollection
        .find({ technicianEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();
    res.send(result);
})

// Admin: every booking
app.get("/booking-request", verifyToken, verifyAdmin, async (req, res) => {
    const result = await bookingCollection.find().sort({ createdAt: -1 }).toArray();
    res.send(result);
})

// Customer cancels — only while still "requested"
app.patch("/booking-request/:id/cancel", verifyToken, verifyCustomer, async (req, res) => {
    const { id } = req.params;
    if (!isValidId(id)) {
        return res.status(404).send({ message: "Booking not found" });
    }

    const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) {
        return res.status(404).send({ message: "Booking not found" });
    }
    if (booking.customerEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden access" });
    }
    if (booking.status !== "requested") {
        return res.status(400).send({ message: "Only requested bookings can be cancelled" });
    }

    const result = await bookingCollection.updateOne(
        { _id: booking._id, status: "requested" },
        { $set: { status: "cancelled", updatedAt: new Date() } }
    );
    res.send(result);
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
