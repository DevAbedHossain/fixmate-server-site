// Seeds realistic, connected demo data. Run with: node scripts/seed.js
// Needs the Next.js client running (accounts are created through BetterAuth sign-up).
//
// ⚠ Resets demo data: deletes ALL services, bookings and payments, and drops the old
//   `bookingRequests` collection. User accounts are kept (only the seed accounts are updated).
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const CLIENT_URL = (process.env.CLIENT_URL ?? "").split(",")[0].trim();
const img = (id, w = 800) => `https://images.unsplash.com/photo-${id}?w=${w}`;

const ACCOUNTS = [
    {
        email: "technician@fixmate.com", password: "Technician123", role: "technician",
        name: "Tanvir Hasan", phone: "01711-234567", area: "Mirpur, Dhaka",
        image: img("1500648767791-00dcc994a43e", 300),
        bio: "Certified electronics technician with 8+ years fixing smartphones, laptops and TVs. Genuine parts and a 30-day service warranty on every job.",
    },
    {
        email: "technician2@fixmate.com", password: "Technician123", role: "technician",
        name: "Nusrat Jahan", phone: "01819-876543", area: "Dhanmondi, Dhaka",
        image: img("1494790108377-be9c29b29330", 300),
        bio: "Home appliance specialist — AC, refrigerator and washing machine servicing. Former service engineer at a leading appliance brand.",
    },
    {
        email: "technician3@fixmate.com", password: "Technician123", role: "technician",
        name: "Arif Rahman", phone: "01912-445566", area: "Uttara, Dhaka",
        image: img("1507003211169-0a1dd7228f2d", 300),
        bio: "Licensed electrician for homes and offices: wiring, breakers, fans and lighting. Safety first, clean finish, on time.",
    },
    {
        email: "customer@fixmate.com", password: "Customer123", role: "customer",
        name: "Rafi Ahmed", phone: "01633-112233", area: "Banani, Dhaka",
        image: img("1506794778202-cad84cf45f1d", 300), bio: "",
    },
    {
        email: "customer2@fixmate.com", password: "Customer123", role: "customer",
        name: "Sadia Islam", phone: "01555-998877", area: "Mohammadpur, Dhaka",
        image: img("1544005313-94ddf0286df2", 300), bio: "",
    },
];

// [technician email, title, category, mode, area, price, duration, image id, description, approvalStatus]
const SERVICES = [
    ["technician@fixmate.com", "iPhone & Android Screen Replacement", "Smartphone", "Shop Drop-off", "Mirpur, Dhaka", 45, "1-2 hours", "1580910051074-3eb694886505", "Cracked or unresponsive screen? We replace displays for iPhone, Samsung, Xiaomi and more with high-quality panels, then test touch, Face ID and brightness before handover."],
    ["technician@fixmate.com", "Smartphone Battery & Charging Port Repair", "Smartphone", "Home Visit", "Mirpur, Dhaka", 25, "1 hour", "1512054502232-10a0a035d672", "Phone dying fast or not charging? Battery replacement, charging-port cleaning and replacement, and a full battery-health check at your doorstep."],
    ["technician@fixmate.com", "Laptop Servicing & Thermal Paste Refresh", "Laptop & PC", "Home Visit", "Mirpur, Dhaka", 35, "2-3 hours", "1588872657578-7efd1f1555ed", "Overheating or slow laptop? Full internal cleaning, new thermal paste, fan service, OS optimisation and a stress test so it runs cool and fast again."],
    ["technician@fixmate.com", "Desktop PC Build & Windows Setup", "Laptop & PC", "Shop Drop-off", "Mirpur, Dhaka", 60, "1 day", "1593640408182-31c70c8268f5", "Custom desktop assembly, component upgrades (RAM, SSD, GPU), clean Windows installation, drivers and essential software — ready to use."],
    ["technician@fixmate.com", "LED & Smart TV Panel Repair", "TV", "Home Visit", "Mirpur, Dhaka", 55, "2-4 hours", "1593359677879-a4bb92f829d1", "No picture, lines on screen or backlight issues? Diagnosis and repair of LED, LCD and Smart TV panels, power boards and backlights for all major brands."],
    ["technician@fixmate.com", "TV Wall Mounting & Smart Setup", "TV", "Home Visit", "Gulshan, Dhaka", 20, "1 hour", "1461151304267-38535e780c79", "Secure wall mounting with cable management, plus Smart TV setup: Wi-Fi, apps and streaming accounts configured for you."],
    ["technician2@fixmate.com", "AC General Servicing & Gas Refill", "AC", "Home Visit", "Dhanmondi, Dhaka", 30, "1-2 hours", "1621905251189-08b45d6a269e", "Split and window AC servicing: filter and coil cleaning, drain check, gas pressure test and refill so your AC cools efficiently again."],
    ["technician2@fixmate.com", "AC Installation & Uninstallation", "AC", "Home Visit", "Dhanmondi, Dhaka", 50, "3-4 hours", "1530124566582-a618bc2615dc", "Professional installation or relocation of split ACs with proper bracket mounting, copper piping, vacuuming and leak testing."],
    ["technician2@fixmate.com", "Refrigerator Not Cooling Repair", "Refrigerator", "Home Visit", "Dhanmondi, Dhaka", 40, "2-3 hours", "1571175443880-49e1d25b2bc5", "Fridge not cooling, freezing too much or making noise? Thermostat, compressor relay, fan and gas leak diagnosis and repair for all brands."],
    ["technician2@fixmate.com", "Commercial Fridge & Freezer Service", "Refrigerator", "Home Visit", "Mohammadpur, Dhaka", 65, "3-5 hours", "1584568694244-14fbdf83bd30", "Servicing for glass-door display fridges and deep freezers in shops and restaurants: cleaning, gas charging, seal and thermostat replacement."],
    ["technician2@fixmate.com", "Washing Machine Repair (Front & Top Load)", "Washing Machine", "Home Visit", "Dhanmondi, Dhaka", 35, "2 hours", "1626806787461-102c1bfaaea1", "Not spinning, not draining or leaking? Motor, pump, belt, door-lock and PCB repairs for front-load and top-load washing machines."],
    ["technician2@fixmate.com", "Washing Machine Deep Cleaning", "Washing Machine", "Home Visit", "Lalmatia, Dhaka", 18, "1-2 hours", "1610557892470-55d9e80c0bce", "Remove odour, mould and detergent build-up with a full drum, filter and gasket deep clean. Your clothes will thank you."],
    ["technician3@fixmate.com", "Home Electrical Wiring & Repair", "Electrical", "Home Visit", "Uttara, Dhaka", 25, "2-3 hours", "1621905251918-48416bd8575a", "Faulty switches, sockets or short circuits? Safe wiring repair, new connection points and full home electrical inspection by a licensed electrician."],
    ["technician3@fixmate.com", "Circuit Breaker & DB Board Installation", "Electrical", "Home Visit", "Uttara, Dhaka", 45, "3-4 hours", "1555963966-b7ae5404b6ed", "Upgrade to a modern distribution board with MCBs and RCD protection, load balancing and labelling for a safer home or office."],
    // Pending — shows the admin approval flow
    ["technician3@fixmate.com", "Ceiling Fan Installation & Repair", "Electrical", "Home Visit", "Uttara, Dhaka", 15, "1 hour", "1621905252507-b35492cc74b4", "Installation, regulator replacement and noise or speed problems fixed for ceiling and exhaust fans.", "pending"],
    ["technician@fixmate.com", "MacBook Logic Board Repair", "Laptop & PC", "Shop Drop-off", "Mirpur, Dhaka", 120, "2-3 days", "1517336714731-489689fd1ca8", "Chip-level repair for MacBook logic boards: liquid damage, no power and charging faults, with data kept safe.", "pending"],
];

const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const daysAhead = (n) => new Date(Date.now() + n * 86400000);

/** Timeline steps that lead to the booking's current status, spaced between createdAt and now/paidAt. */
const buildHistory = ({ status, createdAt, paymentStatus, paidAt }) => {
    const steps =
        status === "rejected" || status === "cancelled"
            ? ["requested", status]
            : ["requested", "accepted", "in-progress", "completed"].slice(
                0,
                ["requested", "accepted", "in-progress", "completed"].indexOf(status) + 1
            );
    if (paymentStatus === "paid") steps.push("paid");

    const start = createdAt.getTime();
    const end = (paidAt ?? new Date()).getTime();
    const gap = steps.length > 1 ? (end - start) / (steps.length - 1) : 0;
    return steps.map((step, i) => ({ status: step, changedAt: new Date(start + gap * i) }));
};

async function ensureAccount(account) {
    const post = (path, body) => fetch(`${CLIENT_URL}/api/auth${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: CLIENT_URL },
        body: JSON.stringify(body),
    });
    const signIn = await post("/sign-in/email", { email: account.email, password: account.password });
    if (signIn.ok) return "exists";
    const signUp = await post("/sign-up/email", { email: account.email, password: account.password, name: account.name, role: account.role });
    if (!signUp.ok) throw new Error(`Could not create ${account.email}: ${signUp.status} ${await signUp.text()}`);
    return "created";
}

const client = new MongoClient(process.env.BETTER_AUTH_MONGO_DB_URL);
await client.connect();
const db = client.db("fixmate");
const users = db.collection("user");

// 1) Accounts
for (const account of ACCOUNTS) {
    const status = await ensureAccount(account);
    const { email, password, ...profile } = account;
    await users.updateOne({ email }, { $set: { ...profile, emailVerified: true } });
    console.log(`account ${email}: ${status}`);
}
const byEmail = Object.fromEntries((await users.find({ email: { $in: ACCOUNTS.map((a) => a.email) } }).toArray()).map((u) => [u.email, u]));

// 2) Reset demo collections
await db.collection("services").deleteMany({});
await db.collection("bookings").deleteMany({});
await db.collection("payments").deleteMany({});
if ((await db.listCollections({ name: "bookingRequests" }).toArray()).length) {
    await db.collection("bookingRequests").drop();
}

// 3) Services (newest first = last in the list)
const serviceDocs = SERVICES.map(([email, title, category, serviceMode, serviceArea, basePrice, estimatedDuration, imageId, description, approvalStatus = "approved"], index) => ({
    _id: new ObjectId(),
    title, category, description, serviceMode, serviceArea, basePrice, estimatedDuration,
    image: img(imageId),
    technicianName: byEmail[email].name,
    technicianEmail: email,
    technicianId: String(byEmail[email]._id),
    approvalStatus,
    isAvailable: true,
    createdAt: daysAgo(SERVICES.length - index),
}));
await db.collection("services").insertMany(serviceDocs);
const service = (title) => serviceDocs.find((s) => s.title === title);

// 4) Bookings in every status
const booking = (svc, customerEmail, extra) => {
    const customer = byEmail[customerEmail];
    return {
        _id: new ObjectId(),
        serviceId: String(svc._id),
        serviceTitle: svc.title,
        serviceImage: svc.image,
        category: svc.category,
        basePrice: svc.basePrice,
        technicianName: svc.technicianName,
        technicianEmail: svc.technicianEmail,
        customerName: customer.name,
        customerEmail,
        customerPhone: customer.phone,
        address: `House 12, Road 5, ${customer.area}`,
        finalAmount: svc.basePrice,
        paymentStatus: "unpaid",
        ...extra,
        statusHistory: buildHistory(extra),
    };
};

const paidLaptop = booking(service("Laptop Servicing & Thermal Paste Refresh"), "customer@fixmate.com", {
    preferredDate: daysAgo(9), status: "completed", finalAmount: 42, paymentStatus: "paid", paidAt: daysAgo(8), createdAt: daysAgo(12),
    problemDescription: "Laptop gets very hot and the fan is loud even when just browsing.",
});
const paidAc = booking(service("AC General Servicing & Gas Refill"), "customer2@fixmate.com", {
    preferredDate: daysAgo(5), status: "completed", finalAmount: 35, paymentStatus: "paid", paidAt: daysAgo(4), createdAt: daysAgo(7),
    problemDescription: "AC runs all day but the room never gets cool, water is also dripping inside.",
    rating: 5, review: "Nusrat was on time, explained the problem clearly and the AC is ice cold now. Highly recommended!", reviewedAt: daysAgo(3.5),
});
const paidTvMount = booking(service("TV Wall Mounting & Smart Setup"), "customer2@fixmate.com", {
    preferredDate: daysAgo(14), status: "completed", finalAmount: 20, paymentStatus: "paid", paidAt: daysAgo(13), createdAt: daysAgo(16),
    problemDescription: "Need my new 55 inch TV mounted on a brick wall with the cables hidden.",
    rating: 5, review: "Clean job, cables hidden perfectly and he set up all my streaming apps too.", reviewedAt: daysAgo(12),
});
const paidScreen = booking(service("iPhone & Android Screen Replacement"), "customer2@fixmate.com", {
    preferredDate: daysAgo(20), status: "completed", finalAmount: 50, paymentStatus: "paid", paidAt: daysAgo(19), createdAt: daysAgo(22),
    problemDescription: "Samsung A54 screen shattered after a fall, touch partly not working.",
    rating: 4, review: "Screen looks great and touch works perfectly. Took a bit longer than expected but worth it.", reviewedAt: daysAgo(18),
});
// paidLaptop (customer@fixmate.com) is left without a review so testers can try the review flow

const bookingDocs = [
    booking(service("iPhone & Android Screen Replacement"), "customer@fixmate.com", {
        preferredDate: daysAhead(2), status: "requested", createdAt: daysAgo(0.2),
        problemDescription: "Dropped my iPhone 12 and the screen is cracked with green lines across it.",
    }),
    booking(service("Refrigerator Not Cooling Repair"), "customer@fixmate.com", {
        preferredDate: daysAhead(1), status: "accepted", createdAt: daysAgo(1),
        problemDescription: "Fridge section stopped cooling two days ago, freezer still works.",
    }),
    booking(service("LED & Smart TV Panel Repair"), "customer2@fixmate.com", {
        preferredDate: daysAgo(0), status: "in-progress", createdAt: daysAgo(2),
        problemDescription: "Samsung 43 inch TV has sound but the screen stays completely black.",
    }),
    booking(service("Washing Machine Repair (Front & Top Load)"), "customer@fixmate.com", {
        preferredDate: daysAgo(2), status: "completed", finalAmount: 48, createdAt: daysAgo(4),
        problemDescription: "Front-load machine stops mid-cycle and shows an E21 error, water stays inside.",
    }),
    paidLaptop,
    paidAc,
    paidTvMount,
    paidScreen,
    booking(service("Home Electrical Wiring & Repair"), "customer2@fixmate.com", {
        preferredDate: daysAgo(3), status: "rejected", createdAt: daysAgo(6),
        problemDescription: "Need rewiring for an entire 3-storey building including a new meter room.",
    }),
    booking(service("Smartphone Battery & Charging Port Repair"), "customer2@fixmate.com", {
        preferredDate: daysAgo(1), status: "cancelled", createdAt: daysAgo(3),
        problemDescription: "Phone battery drains from 100% to 20% in just two hours of use.",
    }),
    booking(service("Circuit Breaker & DB Board Installation"), "customer@fixmate.com", {
        preferredDate: daysAhead(4), status: "requested", createdAt: daysAgo(0.5),
        problemDescription: "Main breaker trips whenever the AC and microwave run together.",
    }),
];
await db.collection("bookings").insertMany(bookingDocs);

// 5) Payments for the paid bookings
const payment = (b, n) => ({
    bookingId: String(b._id),
    serviceTitle: b.serviceTitle,
    customerName: b.customerName,
    customerEmail: b.customerEmail,
    technicianName: b.technicianName,
    technicianEmail: b.technicianEmail,
    amount: b.finalAmount,
    currency: "usd",
    transactionId: `pi_seed_demo_${n}`,
    stripeSessionId: `cs_seed_demo_${n}`,
    paymentStatus: "paid",
    paidAt: b.paidAt,
});
const paidBookings = [paidLaptop, paidAc, paidTvMount, paidScreen];
await db.collection("payments").insertMany(paidBookings.map((b, i) => payment(b, i + 1)));

// 6) Average rating per service from the reviewed bookings
for (const svc of serviceDocs) {
    const ratings = bookingDocs.filter((b) => b.serviceId === String(svc._id) && b.rating).map((b) => b.rating);
    if (ratings.length) {
        await db.collection("services").updateOne(
            { _id: svc._id },
            { $set: { ratingAvg: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10, ratingCount: ratings.length } }
        );
    }
}

console.log(`services: ${serviceDocs.length} (${serviceDocs.filter((s) => s.approvalStatus === "approved").length} approved), bookings: ${bookingDocs.length}, payments: ${paidBookings.length}`);
await client.close();
