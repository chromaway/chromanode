#!/usr/bin/env node

require('../app/lib/init')(function () {
  return require('../app/master')()
})
