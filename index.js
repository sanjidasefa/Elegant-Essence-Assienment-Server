require("dotenv").config();
const express = require("express");
const app = express();
const port = process.env.port || 3000;
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

    app.get("/Service", async (req, res) => {
      const result = await serviceCollection.find().toArray();
      res.send(result);
    });

   app.get("/my-projects", verifyUser, async (req, res) => {
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

    app.get("/decorators-list",verifyUser, async (req, res) => {
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

    app.post("/Service",verifyUser, async (req, res) => {
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

    app.post("/serviceBooking", async (req, res) => {
      const addService = {...req.body,
        email : req.body.client.clientEmail
      };
      const result = await bookingCollection.insertOne(addService);
      res.send(result);
    });

    app.get("/serviceBooking", verifyUser, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
        if (email !== req.tokenEmail) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }
      const result = await bookingCollection.find(query).toArray();
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

     app.put('/service/:id' , async (req , res)=>{
      const data = {...req.body}
      delete data._id;
      const id = req.params.id;
      const query = {_id : new ObjectId(id)}
      const update = {
        $set: data
      }
      const options = {}
      const result = await serviceCollection.updateOne(query , update , options)
      res.send(result)
    })

     app.get('/manageBookings/:email', verifyUser, async (req, res) => {
        const email = req.params.email
        const result = await bookingCollection
          .find({'client.clientEmail' : email })
          .toArray()
        res.send(result)
      }
    )
    
    app.post('/user' , async (req , res)=>{
      const user = req.body;
      user.createdAt = new Date().toISOString();
      user.lastLoggedIn = new Date().toISOString();
      user.role = 'client' ;
      const query = {email : user.email}
      const sameUser = await userCollection.findOne(query)
      if(sameUser){
        const result = await userCollection.updateOne(query , {
          $set :{
            lastLoggedIn : new Date().toISOString()
          }
        })
      }
     const result = await userCollection.insertOne(user);
    // console.log(user , sameUser)
      res.send(result)
    })

   app.get('/user/role/:email', verifyUser , async (req, res)=>{
    const email = req.params.email;
    const result = await userCollection.findOne({email})
    res.send({role : result?.role})
   })

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`${port}`);
});
