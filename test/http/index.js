import v2Tests from './v2'
import versionTests from './version'

export default function (opts) {
  describe('HTTP', () => {
    v2Tests(opts)
    versionTests(opts)
  })
}
