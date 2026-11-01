const express = require("express");
const cors = require("cors");
const todosRouter = require("./routes/todos");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/todos", todosRouter);

app.listen(process.env.PORT || 4000, () => console.log("Server running"));
