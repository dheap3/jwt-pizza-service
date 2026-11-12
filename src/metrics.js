const config = require('./config');
const os = require('os');

// --- Metrics stored in memory ---
const requests = { total: 0, GET: 0, POST: 0, PUT: 0, DELETE: 0 };
const endpointLatency = { total: 0, count: 0 };
const activeUsers = new Set();
const auth = { success: 0, failure: 0 };
const purchases = {
  success: 0,
  failure: 0,
  pizzas: 0,
  revenue: 0,
  // latency is averaged per send interval, then reset
  latencyTotal: 0,
  latencyCount: 0,
};

// --- Tracking functions (called from service.js / routers) ---

// Express middleware: app.use(metrics.requestTracker)
function requestTracker(req, res, next) {
  const start = Date.now();

  requests.total++;
  if (requests[req.method] !== undefined) {
    requests[req.method]++;
  }

  // 'finish' fires once the response has been sent, so this times the whole request
  res.on('finish', () => {
    endpointLatency.total += Date.now() - start;
    endpointLatency.count++;
  });

  next();
}

// authRouter: call after login succeeds / fails
function authAttempt(success) {
  if (success) {
    auth.success++;
  } else {
    auth.failure++;
  }
}

// authRouter: call on successful login/register and on logout
function userLoggedIn(userId) {
  activeUsers.add(userId);
}
function userLoggedOut(userId) {
  activeUsers.delete(userId);
}

// orderRouter: call after the factory responds (or throws)
function pizzaPurchase(success, latency, price, count = 0) {
  if (success) {
    purchases.success++;
    purchases.pizzas += count;
    purchases.revenue += price;
  } else {
    purchases.failure++;
  }
  purchases.latencyTotal += latency;
  purchases.latencyCount++;
}

// --- Metric builder --- 
function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes = {}) {
  attributes = { ...attributes, source: config.metrics.source };
  
  const metric = {
    name: metricName,
    unit: metricUnit,
    [metricType]: {
      dataPoints: [
        {
          [valueType]: metricValue,
          timeUnixNano: Date.now() * 1000000,
          attributes: [],
        },
      ],
    },
  };

  Object.keys(attributes).forEach((key) => {
    metric[metricType].dataPoints[0].attributes.push({
      key: key,
      value: { stringValue: String(attributes[key]) },
    });
  });

  if (metricType === 'sum') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[metricType].isMonotonic = true;
  }

  return metric;
}

// --- HTTP metrics --- 
// Average request latency since the last send; resets each interval
function getAverageEndpointLatency() {
  if (endpointLatency.count === 0) {
    return null; // no requests this interval, so send nothing
  }
  const avg = endpointLatency.total / endpointLatency.count;
  endpointLatency.total = 0;
  endpointLatency.count = 0;
  return avg;
}

function httpMetrics() {
  const metrics = Object.keys(requests).map((method) =>
    createMetric('requests', requests[method], '1', 'sum', 'asInt', { method })
  );

  // skip latency when there were no requests; Grafana rejects a null value
  const avgLatency = getAverageEndpointLatency();
  if (avgLatency !== null) {
    metrics.push(createMetric('endpointLatency', avgLatency, 'ms', 'gauge', 'asDouble'));
  }

  return metrics;
}

// --- System metrics --- 
function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return Number((cpuUsage * 100).toFixed(2));
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const usedMemory = totalMemory - os.freemem();
  return Number(((usedMemory / totalMemory) * 100).toFixed(2));
}

function systemMetrics() {
  return [
    createMetric('cpu', getCpuUsagePercentage(), '%', 'gauge', 'asDouble'),
    createMetric('memory', getMemoryUsagePercentage(), '%', 'gauge', 'asDouble'),
  ];
}

// --- User metrics --- 
function userMetrics() {
  return [createMetric('activeUsers', activeUsers.size, '1', 'gauge', 'asInt')];
}

// --- Auth metrics --- 
function authMetrics() {
  return [
    createMetric('authAttempts', auth.success, '1', 'sum', 'asInt', { status: 'success' }),
    createMetric('authAttempts', auth.failure, '1', 'sum', 'asInt', { status: 'failure' }),
  ];
}

// --- Purchase metrics --- 
// Average latency since the last send; resets so each interval stands alone
function getAveragePurchaseLatency() {
  if (purchases.latencyCount === 0) {
    return null; // no orders this interval, so send nothing
  }
  const avg = purchases.latencyTotal / purchases.latencyCount;
  purchases.latencyTotal = 0;
  purchases.latencyCount = 0;
  return avg;
}

function purchaseMetrics() {
  const metrics = [
    createMetric('pizzaPurchases', purchases.success, '1', 'sum', 'asInt', { status: 'success' }),
    createMetric('pizzaPurchases', purchases.failure, '1', 'sum', 'asInt', { status: 'failure' }),
    createMetric('pizzasSold', purchases.pizzas, '1', 'sum', 'asInt'),
    createMetric('revenue', purchases.revenue, 'BTC', 'sum', 'asDouble'),
  ];

  // skip latency when there were no orders; Grafana rejects a null value
  const avgLatency = getAveragePurchaseLatency();
  if (avgLatency !== null) {
    metrics.push(createMetric('pizzaLatency', avgLatency, 'ms', 'gauge', 'asDouble'));
  }

  return metrics;
}

// --- Send to Grafana --- 
function sendMetricToGrafana(metrics) {
  const body = {
    resourceMetrics: [{ scopeMetrics: [{ metrics }] }],
  };

  fetch(config.metrics.endpointUrl, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`,
      'Content-Type': 'application/json',
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        // include Grafana's explanation so a rejected payload is easy to diagnose
        const reason = await response.text();
        throw new Error(`HTTP status: ${response.status} ${reason}`);
      }
    })
    .catch((error) => {
      console.error('Error pushing metrics:', error);
    });
}

// --- Periodic reporting --- 
function sendMetricsPeriodically(period) {
  return setInterval(() => {
    try {
      const metrics = [
        ...httpMetrics(),
        ...systemMetrics(),
        ...userMetrics(),
        ...purchaseMetrics(),
        ...authMetrics(),
      ];

      sendMetricToGrafana(metrics);
    } catch (error) {
      console.log('Error sending metrics', error);
    }
  }, period);
}

module.exports = {
  requestTracker,
  authAttempt,
  userLoggedIn,
  userLoggedOut,
  pizzaPurchase,
  sendMetricsPeriodically,
};