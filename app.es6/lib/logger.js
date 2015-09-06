import winston from 'winston'

import config from './config'

let logger = new winston.Logger()

logger.add(winston.transports.Console, {
  level: config.get('logger.level', 'error'),
  colorize: true,
  timestamp: true
})

if (config.has('logger.filename')) {
  logger.add(winston.transports.File, {
    filename: config.get('logger.filename'),
    level: config.get('logger.level', 'error'),
    timestamp: true,
    json: false
  })
}

export default logger
