#!/usr/bin/env node

require('../app/common').run(function () {
  return require('../app/slave/slave')
})
