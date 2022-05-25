const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.d77l6.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).send({ message: 'UnAuthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
      if (err) {
        return res.status(403).send({ message: 'Forbidden access' })
      }
      req.decoded = decoded;
      next();
    });
  }

const run = async() => {
    try{
        await client.connect();
        const toolsCollection = client.db('toolex').collection('tools');
        const reviewsCollection = client.db('toolex').collection('reviews');
        const userCollection = client.db('toolex').collection('users');
        const orderCollection = client.db('toolex').collection('orders');
        const paymentCollection = client.db("toolex").collection("payments");

        const verifyAdmin = async (req, res, next) => {
          const requester = req.decoded.email;
          const requesterAccount = await userCollection.findOne({
            email: requester,
          });
          if (requesterAccount.role === "admin") {
            next();
          } else {
            res.status(403).send({ message: "forbidden" });
          }
        };

        app.post("/create-payment-intent", verifyJWT, async (req, res) => {
          const service = req.body;
          const price = service.price;
          const amount = price * 100;
          const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: "usd",
            payment_method_types: ["card"],
          });
          res.send({ clientSecret: paymentIntent.client_secret });
        });

        // tools collection
        app.get('/tool', async(req, res) => {
            const query = {};
            const cursor = toolsCollection.find(query);
            const tools = await cursor.toArray();
            res.send(tools);
        })

        // add tool
        app.post("/tool", async (req, res) => {
          const tool = req.body;
          const result = await toolsCollection.insertOne(tool);
          res.send(result);
        });

        // individual tool
        app.get('/tool/:id', async(req, res) => {
            const id = req.params.id;
            const query = {_id: ObjectId(id)};
            const tool = await toolsCollection.findOne(query);
            res.send(tool);
        });

        // delete a product
        app.delete("/tool/:id", verifyJWT, async (req, res) => {
          const id = req.params.id;
          const query = { _id: ObjectId(id) };
          const result = await toolsCollection.deleteOne(query);
          res.send(result);
        });

        // reviews collection
        app.get('/review', async(req, res) => {
            const query = {};
            const cursor = reviewsCollection.find(query);
            const reviews = await cursor.toArray();
            res.send(reviews);
        })

        // post review
        app.post('/review', async(req, res) => {
          const newReview = req.body;
          const result = await reviewsCollection.insertOne(newReview);
          res.send(result);
      })

      // single user post
      // app.post("/user", async (req, res) => {
      //   const user = req.body;
      //   const result = await userCollection.insertOne(user);
      //   res.send(result);
      // });

        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
          });

        // update user
        app.get("/users", verifyJWT, async (req, res) => {
          const decodedEmail = req.decoded.email;
          const email = req.query.email;
          if (email === decodedEmail) {
            const query = { email: email };
            const cursor = userCollection.find(query);
            const user = await cursor.toArray();
            res.send(user);
          } else {
            res.status(403).send({ message: "Forbidden Access" });
          }
        });

          app.get('/admin/:email', async(req, res) =>{
            const email = req.params.email;
            const user = await userCollection.findOne({email: email});
            const isAdmin = user.role === 'admin';
            res.send({admin: isAdmin})
          })

          app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
              const filter = { email: email };
              const updateDoc = {
                $set: { role: 'admin' },
              };
              const result = await userCollection.updateOne(filter, updateDoc);
              res.send(result);
            }
            else{
              res.status(403).send({message: 'forbidden'});
            }
          })

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const updateUser = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
              $set: {
                address: updateUser.address,
                education: updateUser.education,
                number: updateUser.number,
                linkedin: updateUser.linkedin,
              },
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
          const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '2h' })
          res.send({ result, token });
          })

          app.get("/allorders", verifyJWT, async (req, res) => {
            const orders = await orderCollection.find().toArray();
            res.send(orders);
          });
      
          app.patch("/allorders/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const updatedDoc = {
              $set: {
                status: "approved",
              },
            };
      
            const updatedOrders = await orderCollection.updateOne(query, updatedDoc);
            res.send(updatedOrders);
          });
      
          app.delete("/allorders/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const orders = await orderCollection.deleteOne(query);
            res.send(orders);
          });

          // post orders
          app.post("/orders", async (req, res) => {
            const orders = req.body;
            const query = { name: orders.name, email: orders.email };
            const exists = await orderCollection.findOne(query);
            if (exists) {
              return res.send({ success: false, orders: exists });
            }
            const result = await orderCollection.insertOne(orders);
            res.send({ success: true, result });
          });

          app.get("/orders", verifyJWT, async (req, res) => {
            const decodedEmail = req.decoded.email;
            const email = req.query.email;
            if (email === decodedEmail) {
              const query = { email: email };
              const cursor = orderCollection.find(query);
              const user = await cursor.toArray();
              res.send(user);
            } else {
              res.status(403).send({ message: "Forbidden Access" });
            }
          });
      
          app.get("/orders/:id", verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await orderCollection.findOne(query);
            res.send(result);
          });
      
          app.patch("/orders/:id", verifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
              $set: {
                paid: true,
                transactionId: payment.transactionId,
              },
            };
      
            const result = await paymentCollection.insertOne(payment);
            const updatedOrders = await orderCollection.updateOne(filter, updatedDoc);
            res.send(updatedOrders);
          });
      
          app.delete("/orders/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result);
          });
    }
    finally{

    }
}

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Toolex server is running successfully');
});

app.listen(port, () => {
    console.log('Listening to port', port);
});