import express from 'express';
import cors from "cors";
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import Stripe from 'stripe';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const app = express();
const port = process.env.PORT;

// Frontend URL — used for the BetterAuth JWKS (token check) and the Stripe redirect pages
const CLIENT_URL = (process.env.CLIENT_URL ?? "").trim().replace(/\/$/, "");

app.use(cors());

// Stripe webhook needs the raw body, so it is registered before express.json()
app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
        return res.status(400).send({ message: "Webhook secret not configured" });
    }

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send({ message: `Webhook error: ${err.message}` });
    }

    if (event.type === "checkout.session.completed" && event.data.object.payment_status === "paid") {
        await savePayment(event.data.object);
    }
    res.send({ received: true });
});

app.use(express.json());

if (!process.env.BETTER_AUTH_MONGO_DB_URL) {
    throw new Error("BETTER_AUTH_MONGO_DB_URL is not set. Add it to .env locally or to the Vercel project's Environment Variables.");
}

const client = new MongoClient(process.env.BETTER_AUTH_MONGO_DB_URL);
export async function connectToMongoDB() {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
}

const mongoDBClient = await connectToMongoDB();
const db = mongoDBClient.db("fixmate");
const serviceCollection = db.collection("services");
const userCollection = db.collection("user");
const bookingCollection = db.collection("bookings");
const paymentCollection = db.collection("payments");

// The same Stripe session can never be saved twice (success page + webhook + retries)
await paymentCollection.createIndex({ stripeSessionId: 1 }, { unique: true });

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const isValidId = (id) => ObjectId.isValid(id) && String(new ObjectId(id)) === id;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ACTIVE_STATUSES = ["requested", "accepted", "in-progress"];

// Allowed job status moves for the technician (Challenge 3)
const TECHNICIAN_NEXT_STATUS = {
    requested: ["accepted", "rejected"],
    accepted: ["in-progress"],
    "in-progress": ["completed"],
};

/** Insert the payment once and mark the booking paid. Safe to call many times. */
async function savePayment(session) {
    const bookingId = session.metadata?.bookingId;
    if (!bookingId || !isValidId(bookingId)) return null;

    const booking = await bookingCollection.findOne({ _id: new ObjectId(bookingId) });
    if (!booking) return null;

    const payment = {
        bookingId,
        serviceTitle: booking.serviceTitle,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        technicianName: booking.technicianName,
        technicianEmail: booking.technicianEmail,
        amount: session.amount_total / 100,
        currency: session.currency,
        transactionId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
        stripeSessionId: session.id,
        paymentStatus: "paid",
        paidAt: new Date(),
    };

    try {
        await paymentCollection.updateOne(
            { stripeSessionId: session.id },
            { $setOnInsert: payment },
            { upsert: true }
        );
    } catch (err) {
        // Duplicate key from a parallel request: the payment already exists
        if (err.code !== 11000) throw err;
    }

    // Only the first save marks it paid and adds the "paid" step to the timeline
    await bookingCollection.updateOne(
        { _id: booking._id, paymentStatus: { $ne: "paid" } },
        {
            $set: { paymentStatus: "paid", paidAt: payment.paidAt },
            $push: { statusHistory: { status: "paid", changedAt: payment.paidAt } },
        }
    );

    return paymentCollection.findOne({ stripeSessionId: session.id });
}

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

    // Server-side pagination with skip/limit, together with search, filter and sort
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 8, 1), 48);
    const total = await serviceCollection.countDocuments(query);
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const page = Math.min(Math.max(parseInt(req.query.page) || 1, 1), totalPages);

    const services = await serviceCollection
        .find(query)
        .sort({ ...sortBy, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray();

    res.send({ services, total, page, totalPages });
})

// Public reviews for a service (newest first)
app.get("/service/:id/reviews", async (req, res) => {
    const result = await bookingCollection
        .find(
            { serviceId: req.params.id, rating: { $exists: true } },
            { projection: { customerName: 1, rating: 1, review: 1, reviewedAt: 1 } }
        )
        .sort({ reviewedAt: -1 })
        .limit(10)
        .toArray();
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
        // Job timeline: every status change is recorded with its time
        statusHistory: [{ status: "requested", changedAt: new Date() }],
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
        {
            $set: { status: "cancelled", updatedAt: new Date() },
            $push: { statusHistory: { status: "cancelled", changedAt: new Date() } },
        }
    );
    res.send(result);
})

// Technician moves the job one step forward (Challenge 3)
app.patch("/booking-request/:id/status", verifyToken, verifyTechnician, async (req, res) => {
    const { id } = req.params;
    const { status, finalAmount } = req.body;

    if (!isValidId(id)) {
        return res.status(404).send({ message: "Booking not found" });
    }

    const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) {
        return res.status(404).send({ message: "Booking not found" });
    }
    if (booking.technicianEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden access" });
    }
    if (!TECHNICIAN_NEXT_STATUS[booking.status]?.includes(status)) {
        return res.status(400).send({ message: `Cannot change status from "${booking.status}" to "${status}"` });
    }

    const update = { status, updatedAt: new Date() };
    if (status === "completed") {
        if (!(Number(finalAmount) > 0)) {
            return res.status(400).send({ message: "Final amount must be a number greater than 0" });
        }
        update.finalAmount = Number(finalAmount);
    }

    // Matching the old status too prevents two parallel updates from both succeeding
    const result = await bookingCollection.updateOne(
        { _id: booking._id, status: booking.status },
        { $set: update, $push: { statusHistory: { status, changedAt: update.updatedAt } } }
    );
    res.send(result);
})

// Customer rates a paid job once (1–5 stars + short review)
app.patch("/booking-request/:id/review", verifyToken, verifyCustomer, async (req, res) => {
    const { id } = req.params;
    const rating = Number(req.body.rating);
    const review = String(req.body.review ?? "").trim();

    if (!isValidId(id)) {
        return res.status(404).send({ message: "Booking not found" });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).send({ message: "Rating must be a whole number from 1 to 5" });
    }
    if (review.length > 500) {
        return res.status(400).send({ message: "Review must be 500 characters or less" });
    }

    const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) {
        return res.status(404).send({ message: "Booking not found" });
    }
    if (booking.customerEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden access" });
    }
    if (booking.paymentStatus !== "paid") {
        return res.status(400).send({ message: "You can review a job after paying for it" });
    }

    const result = await bookingCollection.updateOne(
        { _id: booking._id, rating: { $exists: false } },
        { $set: { rating, review, reviewedAt: new Date() } }
    );
    if (result.modifiedCount === 0) {
        return res.status(400).send({ message: "You have already reviewed this job" });
    }

    // Keep the service's average rating up to date for cards and the details page
    const [stats] = await bookingCollection.aggregate([
        { $match: { serviceId: booking.serviceId, rating: { $exists: true } } },
        { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]).toArray();
    if (isValidId(booking.serviceId) && stats) {
        await serviceCollection.updateOne(
            { _id: new ObjectId(booking.serviceId) },
            { $set: { ratingAvg: Math.round(stats.avg * 10) / 10, ratingCount: stats.count } }
        );
    }

    res.send(result);
})

/* ---------- Payments ---------- */

// Customer starts Stripe Checkout for a completed + unpaid booking
app.post("/create-payment-intent", verifyToken, verifyCustomer, async (req, res) => {
    const { bookingId } = req.body;
    if (!isValidId(bookingId)) {
        return res.status(404).send({ message: "Booking not found" });
    }

    // Amount always comes from the database, never from the client
    const booking = await bookingCollection.findOne({ _id: new ObjectId(bookingId) });
    if (!booking) {
        return res.status(404).send({ message: "Booking not found" });
    }
    if (booking.customerEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden access" });
    }
    if (booking.status !== "completed" || booking.paymentStatus === "paid") {
        return res.status(400).send({ message: "This booking cannot be paid" });
    }

    const session = await stripe.checkout.sessions.create({
        success_url: `${CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${CLIENT_URL}/payment/cancel`,
        mode: 'payment',
        customer_email: booking.customerEmail,
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: booking.serviceTitle,
                    },
                    unit_amount: Math.round(Number(booking.finalAmount) * 100),
                },
                quantity: 1,
            }
        ],
        metadata: {
            bookingId: String(booking._id),
            customerEmail: booking.customerEmail,
        }
    });

    res.send({ success: true, url: session.url, sessionId: session.id });
})

// Success page verification — saves the payment once
app.get("/payment/verify", verifyToken, verifyCustomer, async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) {
        return res.status(400).send({ message: "session_id is required" });
    }

    let session;
    try {
        session = await stripe.checkout.sessions.retrieve(session_id);
    } catch {
        return res.status(404).send({ message: "Payment session not found" });
    }

    if (session.metadata?.customerEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden access" });
    }
    if (session.payment_status !== "paid") {
        return res.status(400).send({ message: "Payment not completed" });
    }

    const payment = await savePayment(session);
    res.send(payment);
})

app.get("/payments/my", verifyToken, verifyCustomer, async (req, res) => {
    const result = await paymentCollection
        .find({ customerEmail: req.user.email })
        .sort({ paidAt: -1 })
        .toArray();
    res.send(result);
})

/* ---------- Admin ---------- */

app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
    const result = await userCollection
        .find({}, { projection: { name: 1, email: 1, image: 1, role: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .toArray();
    res.send(result);
})

app.patch("/admin/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!isValidId(id)) {
        return res.status(404).send({ message: "User not found" });
    }
    if (!["customer", "technician", "admin"].includes(role)) {
        return res.status(400).send({ message: "Invalid role" });
    }
    if (String(req.user._id) === id) {
        return res.status(400).send({ message: "You cannot change your own role" });
    }

    const result = await userCollection.updateOne({ _id: new ObjectId(id) }, { $set: { role } });
    res.send(result);
})

app.get("/admin/services", verifyToken, verifyAdmin, async (req, res) => {
    const result = await serviceCollection.find().sort({ createdAt: -1 }).toArray();
    res.send(result);
})

app.patch("/admin/services/:id/approval", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { approvalStatus } = req.body;

    if (!isValidId(id)) {
        return res.status(404).send({ message: "Service not found" });
    }
    if (!["approved", "rejected"].includes(approvalStatus)) {
        return res.status(400).send({ message: "Invalid approval status" });
    }

    const result = await serviceCollection.updateOne({ _id: new ObjectId(id) }, { $set: { approvalStatus } });
    res.send(result);
})

app.get("/admin/payments", verifyToken, verifyAdmin, async (req, res) => {
    const result = await paymentCollection.find().sort({ paidAt: -1 }).toArray();
    res.send(result);
})

// On Vercel the app runs as a serverless function, so it must be exported
// instead of calling listen(). Locally we still start a normal server.
if (!process.env.VERCEL) {
    app.listen(port || 5000, () => {
        console.log(`Example app listening on port ${port || 5000}`);
    });
}

export default app;
