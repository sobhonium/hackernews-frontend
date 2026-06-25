import sqlite3 from "sqlite3";

const print = console.log;

const db = new sqlite3.Database("HN_data.db");

db.all("SELECT * FROM HN_topstories", [], (err, rows) => {
  if (err) {
    console.error(err.message);
    return;
  }


print(rows);
db.close();

});
