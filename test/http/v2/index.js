import statusTests from './status'
import headersTests from './headers'

export default function (opts) {
  describe('v2', () => {
    statusTests(opts)
    headersTests(opts)
  })
}
