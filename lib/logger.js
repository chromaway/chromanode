var winston = require('winston')
var config = require('./config')

var logger = new winston.Logger()

logger.add(winston.transports.Console, {
  level: config.get('logger.level') || 'error',
  colorize: true,
  timestamp: true
})

if (config.get('logger.filename')) {
  logger.add(winston.transports.File, {
    filename: config.get('logger.filename'),
    level: config.get('logger.level') || 'error',
    timestamp: true,
    json: false
  })
}

module.exports.logger = logger
