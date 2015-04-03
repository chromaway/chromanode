#!/usr/bin/env node

require('../lib/bin/common').run(function () {
  return require('../lib/bin/slave')
})
