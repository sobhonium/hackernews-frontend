

import sqlite3 from "sqlite3";




const db = new sqlite3.Database("app.db");


db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    age INTEGER
  )
`);
console.log("Connected");

db.run(
`CREATE TABLE IF NOT EXISTS HN_data(
    id integer primary key,
by text,    
descendants integer,
kids text,
  score integer, 
  time integer,
  title text,
   type text,
  url text,
  groq_label text,
  groq_discussion text,
groq_explain text
)`
);
