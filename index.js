import express from 'express';
import cors from "cors";
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

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

app.get('/', (req, res) => {
    res.send('Hello World!');
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
    const result = await serviceCollection.find().toArray();
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

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});