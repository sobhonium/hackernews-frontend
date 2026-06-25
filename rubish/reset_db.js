import sqlite3 from "sqlite3";

const print = console.log;

const db = new sqlite3.Database("HN_data.db");

print("Connected");

db.run(
  `CREATE TABLE IF NOT EXISTS HN_topstories(
    id integer primary key,
author text,    
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
)`,
);
print("table generated.");

async function main() {
  const ids = await fetch(
    "https://hacker-news.firebaseio.com/v0/topstories.json",
  ).then((r) => r.json());

  //   .then((ids)=>ids.slice(0,2))
  //   .then((selected_ids)=>print(selected_ids));

  // const id = ids[0];

  // for (const id of ids) {
  for (const id of ids.slice(0,20)) {
    const response = await fetch(
      `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
    );

    const story = await response.json();

    // print(Object.keys(story));
    // print(typeof ids);
    // const selected_ids = ids.slice(0,2);
    // print(selected_ids);

    try {
      db.run(
        `INSERT INTO HN_topstories
  (
    id,
    author,
    descendants,
    kids,
    score,
    time,
    title,
    type,
    url,
    groq_label,
    groq_discussion,
    groq_explain
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          story.id,
          story.by,
          story.descendants,
          JSON.stringify(story.kids || []),
          story.score,
          story.time,
          story.title,
          story.type,
          story.url,
          story.label || null,
          story.groq_discussion || null,
          story.groq_explain || null,
        ],
      );

      print(`story ${story.id} added.`);
    } catch (error) {
      print(error);
    }
  }
  db.close();
}

main();
