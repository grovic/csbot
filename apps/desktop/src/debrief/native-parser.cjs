// The demo parser's native module. In the installed app it's staged under resources/app.asar.unpacked/
// native/demoparser2 (electron-builder rewrites anything named node_modules), and main tells the worker
// where with CSBOT_PARSER_PATH; in development it's the normal package.
module.exports = require(process.env.CSBOT_PARSER_PATH || '@laihoe/demoparser2');
