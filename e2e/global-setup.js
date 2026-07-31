const { seedE2EUsers } = require("./helpers/seed-users");

async function globalSetup() {
  seedE2EUsers();
}

module.exports = globalSetup;
