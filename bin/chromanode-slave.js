#!/usr/bin/env node

// require('babel-runtime/core-js/promise').default = require('bluebird')
require('../app/lib/init')(function () {
  return require('../app/slave')()
})
