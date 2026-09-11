'use strict';
// Compatibility alias: delegate to tools/serve.js so running
// `node test/serve.js` works identically to `node tools/serve.js`.
var serve = require('../tools/serve.js');

if (require.main === module) {
  var port = process.argv[2] === undefined ? serve.PORT : parseInt(process.argv[2], 10);
  var srv = serve.start(port, serve.HOST, serve.ROOT, function () {
    console.log('educad serve http://' + serve.HOST + ':' + srv.address().port + '/ -> ' + serve.ROOT);
  });
  srv.on('error', function (err) {
    console.error('educad serve error: ' + err.message);
    process.exit(1);
  });
}

module.exports = serve;
