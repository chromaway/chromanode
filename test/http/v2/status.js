import { expect } from 'chai'

export default function (opts) {
  let request = require('../request')(opts)

  it('status', async () => {
    let result = await request.get('/v2/status')
    expect(result).to.have.property('version', require('../../../package.json').version)
    expect(result).to.have.property('network', 'regtest')
  })
}
