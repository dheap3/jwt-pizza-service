const { AsyncLocalStorage } = require('async_hooks');
const config = require('./config.js');

// Remembers which request is currently being handled, so code that never sees
// `req` (like DB.query) can still find out which user made the request.
const requestContext = new AsyncLocalStorage();

class Logger {

  // --- HTTP requests ---
  httpLogger = (req, res, next) => {
    const send = res.send;
    res.send = (resBody) => {
      const logData = {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,

        authorized: !!req.headers.authorization,
        user: this.userInfo(req.user),

        reqBody: JSON.stringify(req.body),
        resBody: JSON.stringify(resBody),
        ip: req.ip,
        path: req.hostname + req.originalUrl,
      };

      this.log(this.statusToLogLevel(res.statusCode), 'http', logData);

      // put the original back so this only logs once per request
      res.send = send;
      return res.send(resBody);
    };

    // run the rest of the request as part of this context -> preserving the user for the other loggers
    requestContext.run({ req }, () => next());
  };

  // --- Database requests ---
  dbLogger(sql) {
    this.log('info', 'db', { user: this.currentUser(), reqBody: sql });
  }

  // --- Factory requests ---
  // Call from createOrder after the factory responds
  factoryLogger(reqBody, resBody, statusCode) {
    const level = this.statusToLogLevel(statusCode);
    this.log(level, 'factory', {
      user: this.currentUser(),
      statusCode,
      reqBody: JSON.stringify(reqBody),
      resBody: JSON.stringify(resBody),
    });
  }

  unhandledErrorLogger(e) {
    this.log('error', 'unhandledError', {
      user: this.currentUser(),
      message: e.message,
      statusCode: e.statusCode ?? 500,
      stack: e.stack,
    });
  }

  // --- Helpers ---

  // The user for the request currently being handled, if they are logged in
  currentUser() {
    const store = requestContext.getStore();
    return this.userInfo(store?.req?.user);
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warning';
    return 'info';
  }

  // sanitize everything, only get what we need
  sanitize(logData) {
    let text = JSON.stringify(logData);
    // "password":"abc" -> "password":"*****" (also matches escaped quotes inside reqBody/resBody)
    text = text.replace(
      /(\\?"(?:password|token|jwt|apiKey|authorization)\\?"\s*:\s*\\?")[^"\\]*(\\?")/gi,
      '$1*****$2'
    );
    // Authorization: Bearer abc.def.ghi -> Bearer *****
    text = text.replace(/Bearer\s+[\w.-]+/gi, 'Bearer *****');
    return text;
  }

   // Only the fields we want
  userInfo(user) {
    if (!user) {
      return null;
    }
    return { id: user.id, email: user.email };
  }

  // --- Send to Loki ---
  log(level, type, logData) {
    const labels = { component: config.logging.source, level, type };
    const sanitized = this.sanitize(logData);
    const values = [(Date.now() * 1000000).toString(), sanitized];
    const logEvent = { streams: [{ stream: labels, values: [values] }] };

    this.sendLogToGrafana(logEvent);
  }

  sendLogToGrafana(event) {
    const body = JSON.stringify(event);
    fetch(config.logging.endpointUrl, {
      method: 'POST',
      body: body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.logging.accountId}:${config.logging.apiKey}`,
      },
    })
      .then((res) => {
        if (!res.ok) console.log('Failed to send log to Grafana', res.status);
      })
      .catch((error) => {
        console.log('Error sending log to Grafana', error.message);
      });
  }
}

module.exports = new Logger();
