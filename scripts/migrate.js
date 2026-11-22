// One-off, safe-to-rerun data fixes. Run with: node scripts/migrate.js
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.BETTER_AUTH_MONGO_DB_URL);
await client.connect();
const services = client.db("fixmate").collection("services");

// 1) basePrice stored as text -> number (needed for price sorting)
const price = await services.updateMany(
    { basePrice: { $type: "string" } },
    [{ $set: { basePrice: { $toDouble: "$basePrice" } } }]
);

// 2) Missing createdAt -> creation time from the ObjectId (needed for "Newest")
const created = await services.updateMany(
    { createdAt: { $exists: false } },
    [{ $set: { createdAt: { $toDate: "$_id" } } }]
);

console.log(`basePrice fixed: ${price.modifiedCount}, createdAt added: ${created.modifiedCount}`);
await client.close();
