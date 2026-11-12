const app = require('./service.js');
const metrics = require('./metrics.js');

const port = process.argv[2] || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});

// started here (not in metrics.js) so Jest tests that import service.js don't get an open timer
metrics.sendMetricsPeriodically(10000);
