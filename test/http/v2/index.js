import statusTests from './status'
import headersTests from './headers'
import transactionsTests from './transactions'
import addressesTests from './adresses'

export default function (opts) {
  describe('v2', () => {
    statusTests(opts)
    headersTests(opts)
    transactionsTests(opts)
    addressesTests(opts)
  })
}
