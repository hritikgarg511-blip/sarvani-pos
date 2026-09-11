import "dotenv/config";
import { sqliteConn } from "./db/client";
import { newId } from "./lib/id";
import { hashPassword } from "./lib/auth";

async function main() {
  if (!sqliteConn) throw new Error("Seed script requires SQLite dev connection");

  const ownerExists = sqliteConn.prepare(`SELECT id FROM users WHERE phone = ?`).get("7976900021");
  let ownerId: string;
  if (ownerExists) {
    ownerId = (ownerExists as any).id;
    console.log("Owner user already exists, skipping user creation.");
  } else {
    ownerId = newId();
    const passwordHash = await hashPassword("Sarvani@123");
    sqliteConn
      .prepare(
        `INSERT INTO users (id, name, phone, email, password_hash, role, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'OWNER', 1, unixepoch(), unixepoch())`
      )
      .run(ownerId, "Sarvani Owner", "7976900021", "owner@sarvanisuitandsaree.example", passwordHash);
    console.log("Created OWNER login -> phone: 7976900021 | password: Sarvani@123 (CHANGE THIS after first login)");
  }

  // Categories
  const categories = [
    { name: "Saree", hsn: "5407", gst: 5 },
    { name: "Suit", hsn: "6204", gst: 5 },
    { name: "Lehenga", hsn: "6211", gst: 12 },
    { name: "Dupatta", hsn: "6214", gst: 5 },
  ];
  const catIds: Record<string, string> = {};
  for (const c of categories) {
    const existing = sqliteConn.prepare(`SELECT id FROM categories WHERE name = ?`).get(c.name) as any;
    if (existing) {
      catIds[c.name] = existing.id;
      continue;
    }
    const id = newId();
    sqliteConn
      .prepare(`INSERT INTO categories (id, name, hsn_code, gst_rate, created_at) VALUES (?,?,?,?, unixepoch())`)
      .run(id, c.name, c.hsn, c.gst);
    catIds[c.name] = id;
  }

  // Product masters and transaction history are imported from the supplied BUSY export using `npm run import:busy`. No fake sample products are inserted.

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
