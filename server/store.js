const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

function emptyStore() {
  return { users: [], reels: [] };
}

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return emptyStore();
  try {
    return { ...emptyStore(), ...JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) };
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

function update(mutator) {
  const store = readStore();
  const result = mutator(store);
  writeStore(store);
  return result;
}

module.exports = { readStore, writeStore, update, DATA_DIR, STORE_PATH };
