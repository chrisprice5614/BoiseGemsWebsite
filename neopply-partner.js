/**
 * Compatibility shim — prefer requiring("./partner-auth") for new code.
 * Video audition and older call sites still import this path.
 */
module.exports = require("./partner-auth");
