import express from 'express';
import cors from "cors";
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const app = express();
const port = process.env.PORT;

app.use(cors());
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
const bookingRequestCollection = db.collection("bookingRequests");

app.get('/', (req, res) => {
    res.send('Hello World!');
});

//stripe payment intent
app.post("/create-payment-intent", async (req, res) => {
    const payload = req.body;
    const service = await serviceCollection.findOne({ _id: new ObjectId(payload.serviceId) });

    if (!service) {
        return res.status(404).send({ message: "Service not found" });
    }

    const booking = {
        serviceId: payload.serviceId,
        userEmail: payload.userEmail,
        status: "pending",
        createdAt: new Date(),
    };

    const bookingCreateResult = await bookingCollection.insertOne(booking);

    const session = await stripe.checkout.sessions.create({
        success_url: `${process.env.CLIENT_URL}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL}/booking/cancel`,
        mode: 'payment',
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: service.title,
                        description: service.description
                    },
                    // Stripe wants an integer in cents; basePrice is stored as a string
                    unit_amount: Math.round(Number(service.basePrice) * 100),
                },
                quantity: 1,
            }
        ],
        metadata: {
            bookingId: bookingCreateResult.insertedId.toString(),
            userId: payload.userId,
        }

    });

    console.log("Session created:", session);

    res.send({ success: true, url: session.url, sessionId: session.id, bookingId: bookingCreateResult.insertedId.toString() });

})

// Public technician profile — only safe fields, never email/phone
app.get("/user/:id", async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(404).send({ message: "User not found" });
    }

    const result = await userCollection.findOne(
        { _id: new ObjectId(id) },
        { projection: { name: 1, image: 1, location: 1, bio: 1 } }
    );
    if (!result) {
        return res.status(404).send({ message: "User not found" });
    }
    res.send(result);
});

app.patch("/user/:id", async (req, res) => {
    const { id } = req.params;
    const body = req.body;

    const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        {
            $set: {
                ...body
            }
        }
    );
    res.send(result);
});

app.post("/service", async (req, res) => {
    const data = req.body;
    const result = await serviceCollection.insertOne(data);
    res.send(result);
})

app.get("/services", async (req, res) => {
    const query = {
        approvalStatus: "approved",
        isAvailable: true
    }
    const result = await serviceCollection.find(query).toArray();
    res.send(result);
})

app.get("/service/:id", async (req, res) => {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) }
    const result = await serviceCollection.findOne(query);
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

app.patch("/service/:id", async (req, res) => {
    const { id } = req.params;
    const UpdateData = req.body;
    const result = await serviceCollection.updateOne(
        { _id: new ObjectId(id) },
        {
            $set: {
                ...UpdateData
            }
        }
    )
    res.send(result);
})

app.delete("/service/:id", async (req, res) => {
    const { id } = req.params;
    const result = await serviceCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
})

app.post("/booking-request", async (req, res) => {
    const data = req.body;
    const result = await bookingRequestCollection.insertOne(data);
    res.send(result);
})

app.get("/booking-request", async (req, res) => {
    const result = await bookingRequestCollection.find().toArray();
    res.send(result);
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});