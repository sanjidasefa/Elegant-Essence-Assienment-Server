require("dotenv").config();
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");
const cors = require("cors");

const stripe = require("stripe")(process.env.STRIPE_KEY);

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("add to server");
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = process.env.MONGO_URI;

const verify = Buffer.from(process.env.FIREBASE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(verify);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyUser = async (req, res, next) => {
  const token = req.headers.authorization.split(" ")[1];
  console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unathorized access" });
  }
  const verify = await admin.auth().verifyIdToken(token);
  req.tokenEmail = verify.email;
  next();
};

async function run() {
  try {
    const elegantEssence = client.db("Elegant-Essence");
    const serviceCollection = elegantEssence.collection("serviceColl");
    const bookingCollection = elegantEssence.collection("bookingColl");
    const decoratorCollection = elegantEssence.collection("decoratorColl");
    const userCollection = elegantEssence.collection("userColl");
    const changeRoleCollection = elegantEssence.collection("changeRoleColl");
    
    const verifyAdmin = async (req , res , next)=>{
  const email = req.tokenEmail
  const user = await userCollection.findOne({email})
  if(user?.role !== 'admin'){
    return res.send({massage : 'you are not admin'})
  }
  next()
}
    const verifyDecorator = async (req , res , next)=>{
  const email = req.tokenEmail
  const user = await userCollection.findOne({email})
  if( user?.role !== 'decorator'){
    return res.send({massage : 'you are not decorator'})
  }
  next()
}

 app.get("/Service", async (req, res) => {
  const { search, category, sort } = req.query;
  let query = {};
  if (search) {
    query.serviceName = { $regex: search, $options: "i" };
  }
  if (category && category !== "All") {
    query.category = category;
  }
  let sortOptions = {};
  if (sort === "lowToHigh") {
    sortOptions.servicePrice = 1;
  } else if (sort === "highToLow") {
    sortOptions.servicePrice = -1;
  } else {
    sortOptions.createAt = -1;
  }
  try {
    const result = await serviceCollection
      .find(query)
      .sort(sortOptions)
      .toArray();
    res.status(200).send(result);
  } catch (error) {
    res.status(500).send({ message: "Error fetching services" });
  }
});

    app.get("/my-projects", verifyUser,verifyDecorator, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        if (email !== req.tokenEmail) {
          return res.status(403).send({ message: "forbidden access" });
        }
        query["decorator.email"] = email;
      }

      const result = await serviceCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/all-services", verifyUser,verifyAdmin, async (req, res) => {
      const result = await serviceCollection.find({}).toArray();
      res.send(result);
    });

    app.get("/decorators-list", async (req, res) => {
      const result = await decoratorCollection
        .find()
        .sort({ rating: 1 })
        .toArray();
      res.send(result);
    });

    app.get("/Service/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await serviceCollection.findOne(query);
      res.send(result);
    });

    app.post("/Service", verifyUser, async (req, res) => {
      const addService = req.body;
      const result = await serviceCollection.insertOne(addService);
      res.send(result);
    });

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfor = req.body;
      const amount = parseInt(paymentInfor.servicePrice) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfor.serviceName,
                description: paymentInfor.description,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfor.email,
        mode: "payment",
        metadata: {
          bookingId: paymentInfor.bookingId,
          customer: paymentInfor.client.email,
        },
        success_url: `${process.env.DOMAIN_URL}/Dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.DOMAIN_URL}/Dashboard/payment-cancelled`,
      });
      console.log(session);
      res.send({ url: session.url });
    });

    app.post("/serviceBooking",verifyUser, async (req, res) => {
      const addService = { ...req.body, email: req.body.client.clientEmail };
      const result = await bookingCollection.insertOne(addService);
      res.send(result);
    });

    app.get("/serviceBooking", verifyUser , async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
        if (email !== req.tokenEmail) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }
      const result = await bookingCollection.find(query).sort({ status: 1, createdAt : -1 }).toArray();
      res.send(result);
    });

    app.get("/all-Bookings", verifyUser ,verifyAdmin, async (req, res) => {
      const result = await bookingCollection.find({}).sort({ status: 1, createdAt : -1 }).toArray();
      res.send(result);
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log("session retrive", session);
      if (session.payment_status === "paid") {
        const id = session.metadata.bookingId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            status: "paid",
            paidAt: new Date(),
            transactionId: session.payment_intent,
          },
        };
        const result = await bookingCollection.updateOne(query, update);
        res.send(result);
      }
      //  res.send({ success: false , message: 'canceld' });
    });

    app.delete("/serviceBooking/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingCollection.deleteOne(query);
      res.send(result);
    });

    app.delete("/service/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await serviceCollection.deleteOne(query);
      res.send(result);
    });

    app.put("/service/:id", async (req, res) => {
      const data = { ...req.body };
      delete data._id;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set: data,
      };
      const options = {};
      const result = await serviceCollection.updateOne(query, update, options);
      res.send(result);
    });

    app.get("/manageBookings", verifyUser, verifyAdmin, async (req, res) => {
  const result = await bookingCollection
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
  res.send(result);
});

    app.post("/user", async (req, res) => {
      const user = req.body;
      if (user.number) user.number = parseInt(user.number);
      user.createdAt = new Date().toISOString();
      user.lastLoggedIn = new Date().toISOString();
      user.role = "client";
      const query = { email: user.email };
      const sameUser = await userCollection.findOne(query);
      if (sameUser) {
        const result = await userCollection.updateOne(query, {
          $set: {
            lastLoggedIn: new Date().toISOString(),
          },
        });
        return res.send({ massage: "updated" });
      }
      const result = await userCollection.insertOne(user);
            res.status(201).send(result);
    });

    app.get("/user/role", verifyUser, async (req, res) => {
      const result = await userCollection.findOne({ email: req.tokenEmail });
      res.send({ role: result?.role });
    });

    app.post("/handleChangeRole", verifyUser, async (req, res) => {
      const email = req.tokenEmail;
      const payload = req.body;
      const sameEmail = await changeRoleCollection.findOne({ email });
      if (sameEmail) {
        return res.status(409).send({ massage: "same Email " });
      }
      const result = await changeRoleCollection.insertOne({
        ...payload,
        email,
        reqRole: payload.role,
        status: "pending",
      });
      res.send(result);
    });

    app.delete("/handleChangeRole/:id", async (req, res) => {  
     const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await changeRoleCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/handleChangeRole", verifyUser,verifyAdmin, async (req, res) => {
      const result = await changeRoleCollection.find().toArray();
      res.send(result);
    });

    app.patch("/handleChangeRole", verifyUser,verifyAdmin, async (req, res) => {
      const {
        email,
        role,
        name,
        rating,
        totalReviews,
        experienceYears,
        specialties,
        topServices,
      } = req.body;
      const result = await userCollection.updateOne(
        { email },
        { $set: {role : role } }
      );

      await changeRoleCollection.deleteOne({ email });
      if (role === "decorator") {
        const update = await decoratorCollection.findOne({ email });
        if (!update) {
          const newDecorator = {
            email,
            role,
            name,
            rating,
            totalReviews,
            experienceYears,
            specialties,
            topServices,
            isVerified: false,
            createdAt: new Date(),
            approvedAt: new Date(),
          };
          await decoratorCollection.insertOne(newDecorator);
        }
      }
      res.send(result);
    });

app.get("/todays-schedule", verifyUser, verifyDecorator, async (req, res) => {
  const email = req.tokenEmail;
 const assignedBookings = await bookingCollection.find({
    status: "assigned",
    "decorator.email": email
  })
  .sort({ "decorator.assignedAt": -1 })
  .toArray();
  res.send(assignedBookings);
})

app.patch("/assign-decorators/:id", verifyUser, verifyAdmin, async (req, res) => {
  const bookingId = req.params.id;
  const { decoratorEmail } = req.body;
  const booking = await bookingCollection.findOne({ _id: new ObjectId(bookingId) });
  const decorator = await decoratorCollection.findOne({ email: decoratorEmail });
  if (!decorator) return res.send({ message: "Decorator not found" });
  const result = await bookingCollection.updateOne(
    { _id: new ObjectId(bookingId) },
    {
      $set: {
        status: "assigned",
        decorator: {
          email: decorator.email,
          name: decorator.name,
          assignedAt: new Date(),
        },
      },
    }
  );
  res.send(result);
})

app.patch("/decline-booking/:id", verifyUser, verifyAdmin, async (req, res) => {
  const bookingId = req.params.id;
  const { status } = req.body;
  const result = await bookingCollection.updateOne(
    { _id: new ObjectId(bookingId) },
    { $set: { status } }
  );
  res.send(result);
})

app.patch("/updatedBooking/:id", verifyUser, verifyDecorator, async(req, res)=>{
  const update = req.params.id;
  const { status } = req.body;
  const result = await bookingCollection.updateOne(
    { _id: new ObjectId(update) },
    { $set: { status } }
  );
  res.send(result);
})
app.patch("/DeclineUpdatedBooking/:id", verifyUser, verifyDecorator, async(req, res)=>{
  const update = req.params.id;
  const { status } = req.body;
  const result = await bookingCollection.updateOne(
    { _id: new ObjectId(update) },
    { $set: { status } }
  );
  res.send(result);
})
app.get("/decorator-completed", verifyUser, verifyDecorator,async (req, res) => {
    const email = req.tokenEmail;
    const completedBookings = await bookingCollection
      .find({
        status: "completed",
        "decorator.email": email,
      })
      .toArray();
    res.status(200).send(completedBookings);
  }
);

app.get("/dashboard-stats", verifyUser, async (req, res) => {
  const email = req.tokenEmail;
  const user = await userCollection.findOne({ email });
  const role = user?.role;
  const roleDistribution = await userCollection.aggregate([
    {
      $group: {
        _id: "$role",
        count: { $sum: 1 }
      }
    }
  ]).toArray();
  const totalUsers = await userCollection.estimatedDocumentCount(); 
  let specificStats = {};
  if (role === "admin") {
    const payments = await bookingCollection.find({ status: "paid" }).toArray();
    const revenue = payments.reduce((sum, p) => sum + (parseFloat(p.servicePrice) || 0), 0);
    const bookings = await bookingCollection.estimatedDocumentCount();
    specificStats = { revenue, bookings, type: "admin" };
  } 
  else if (role === "decorator") {
    const myProjects = await bookingCollection.countDocuments({ "decorator.email": email });
    const completed = await bookingCollection.countDocuments({ "decorator.email": email, status: "completed" });
    specificStats = { myProjects, completed, type: "decorator" };
  } 
  else {
    const myBookings = await bookingCollection.countDocuments({ email: email });
    const myPayments = await bookingCollection.find({ email: email, status: "paid" }).toArray();
    const totalSpent = myPayments.reduce((sum, p) => sum + (parseFloat(p.servicePrice) || 0), 0);    
    specificStats = { myBookings, totalSpent, type: "user" };
  }
  res.send({ totalUsers, roleDistribution, ...specificStats });
});

  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`${port}`);
});
module.exports = app;