const logger = require('../utils/logger');

function notFound(req, res) {
  res.status(404).json({ error: 'Resource not found.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  logger.error(err.message, {
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
  });

  const body = { error: status === 500 ? 'Internal server error.' : err.message };
  if (process.env.NODE_ENV !== 'production') {
    body.details = err.stack;
  }
  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
