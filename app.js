import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import bodyParser from "body-parser";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import itemJson from "./items.json" assert { type: "json" };
import heroesJson from "./heroes.json" assert { type: "json" };

import db from "./db.js";

let gameID;
// initial 1
let gameStep = 1;
let activeUsers = new Map();
// initial 6
const maxUsersOnline = 4;
const minUsersOnline = 2;
let playersReady = new Map();
let currentGame = {
  started: false,
  numberOfRooms: 39,
  numberOfPlayers: 0,
};

let arrayOfItems = Object.values(itemJson); // passer le Json en array pour utiliser les index plus facilement

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  methods: ["GET", "POST"],
});

app.use(bodyParser.json());
app.use(express.json());
app.use(cors());

app.use(function (req, res, next) {
  req.io = io;
  next();
});

app.get("/", (req, res) => {
  res.send("<h1>Hello world</h1>");
});

// ?
app.post("/post", (req, res) => {
  console.log("receive", req.params.channel, req.body);
  req.io.emit("post", req.body);
  res.json({ status: "success" });
});

let initializationRooms = async (gameID) => {
  let id = gameID;
  let myGame = await db("games").where("gameId", id).first();
  let rowCount = myGame.rooms;
  let myRooms = await db("rooms").where("gameId", id);
  console.log(myRooms.length);
  if (myRooms == rowCount) {
    console.log("rooms has already initialized");
  } else {
    for (let i = 0; i < rowCount; i++) {
      try {
        let indexAleatoire = Math.floor(Math.random() * arrayOfItems.length);
        // Insérez les salles dans la base de données
        await db.transaction(async (trx) => {
          await trx("rooms").insert({
            gameId: id,
            name: "room" + i,
            item: arrayOfItems[indexAleatoire],
          });
        });
        console.log("Les salles ont été insérées avec succès.");
      } catch (error) {
        console.error("Erreur lors de l'insertion des salles :", error);
      }
    }
  }
};

io.on("connection", async (socket) => {
  io.emit("gameStep", gameStep);
  io.emit("updateUsersCount", activeUsers.size);

  // create a user
  socket.on("createUser", async (userData) => {
    let name = userData.username;
    let gameID = userData.gameID;
    let userID = uuidv4(); // Générer un nouvel identifiant UUID
    try {
      // Insérer les données dans la table 'utilisateurs'
      await db.transaction(async (trx) => {
        await trx("users").insert({
          id: userID,
          gameId: gameID,
          username: name,
          inventory_id: userID, // Utiliser le même ID pour l'inventaire
          ready: false,
          room: "0",
        });
        await trx("inventory").insert({
          gameId: gameID,
          id: userID, // Utiliser le même ID pour l'inventaire
          user_id: userID, // Utiliser le même ID pour l'utilisateur
        });
      });

      // Envoyer l'ID unique généré au client
      socket.emit("userCreated", userID);

      console.log(userID);

      console.log("something?");
    } catch (error) {
      console.error("Erreur lors de la création du compte :", error);
      // Gérer l'erreur ici
    }
  });

  let userIDPromise = new Promise((resolve, reject) => {
    socket.on("MyID", async (id) => {
      // resolve(id); // Résoudre la promesse avec l'ID utilisateur
      activeUsers.set(id, true);
      io.emit("updateUsersCount", activeUsers.size);
      console.log(activeUsers);
      let Myuser = await db("users").where("id", id).first();
      resolve(Myuser);
      socket.emit("ThisIsYourUser", Myuser);
    });
  });

  const user = await userIDPromise;

  //@TODO : bloquer l'accès au nouveaux joueurs
  if (currentGame.started == true) {
    // c'est le plateau qui ouvre et qui ferme la partie? c'est là qu'on scan le QR code pour se connecter
  }

  socket.on("wantToDoSomething", () => {
    socket.emit("wait");
    playersReady.set(user.id, true);
    if (playersReady.size === activeUsers.size) {
      gameStep++;
      console.log(gameStep);
      socket.emit("gameStep", gameStep);
      playersReady.clear();
    }
  });

  if (activeUsers.size == maxUsersOnline) {
    socket.emit("deco", userID);
    // socket.disconnect;
    console.log("deco");
    // Supprime l'ID de socket de la map des utilisateurs connectés
    activeUsers.delete(userID);
    // Met à jour le nombre d'utilisateurs connectés et émet à tous les clients
    io.emit("updateUsersCount", activeUsers.size);
  }

  // add a hero's type to the db
  socket.on("selectedHero", async (selectedhero) => {
    console.log(selectedhero);
    console.log("MyUserId", user.id);
    try {
      // Mettre à jour le champ 'hero' dans la table 'users'
      await db("users").where({ id: user.id }).update({ hero: selectedhero });
    } catch (error) {
      console.error("Erreur lors de la mise à jour du héros :", error);
      // Gérer l'erreur ici
    }
    socket.emit("registeredHero");
  });

  // gestion de deconnection des users
  socket.on("disconnect", () => {
    console.log(`L'utilisateur avec l'ID ${user.id} s'est déconnecté`);

    // Supprime l'ID de socket de la map des utilisateurs connectés
    activeUsers.delete(user.id);

    // Met à jour le nombre d'utilisateurs connectés et émet à tous les clients
    io.emit("updateUsersCount", activeUsers.size);
  });
});

app.get("/games", async (req, res) => {
  try {
    const games = await db.select().from("games");
    res.json(games);
  } catch (error) {
    console.error("Erreur lors de la récupération des utilisateurs :", error);
    res.status(500).send("Erreur serveur");
  }
});

// Route pour récupérer des données depuis la base de données Users
app.get("/users", async (req, res) => {
  try {
    const users = await db.select().from("users");
    res.json(users);
  } catch (error) {
    console.error("Erreur lors de la récupération des utilisateurs :", error);
    res.status(500).send("Erreur serveur");
  }
});

app.get("/items", async (req, res) => {
  const items = await itemJson;
  res.json(items);
});

app.get("/heroes", async (req, res) => {
  const heroes = await heroesJson;
  res.json(heroes);
});

// dataset de la partie
app.get("/creategame", async (req, res) => {
  // initialisé la partie
  gameID = uuidv4(); // définir l'ID unique de la game à max 6 joueurs
  gameStep = 1; // définir l'état de la partie

  try {
    // Insérer les données dans la table 'games'
    await db.transaction(async (trx) => {
      await trx("games").insert({
        gameId: gameID,
        name: gameID,
        statut: "waiting",
        started: false,
        step: 1,
        rooms: 39,
        users: 0,
      });
    });
    //@TODO : ajouter l'id de la game aux users qui la rejoignent

    initializationRooms(gameID);

    // Récupérer la liste mise à jour des games
    const game = await db("games").where("gameId", gameID).first();
    res.json(game);
  } catch (error) {
    console.error("Erreur lors de la création de la partie :", error);
    // Gérer l'erreur ici
  }
});

server.listen(3000, () => {
  console.log("server running at http://localhost:3000");
});
