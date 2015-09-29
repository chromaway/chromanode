import _ from 'lodash'
import { expect } from 'chai'

export default function (opts) {
  describe('reorg', () => {
    let savedOptions

    before(() => {
      savedOptions = opts.bitcoind.getOption('bitcoind')
      let newOptions = _.defaults({
        port: () => _.random(20000, 30000),
        rpcport: () => _.random(20000, 30000)
      }, savedOptions)
      opts.bitcoind.setOption('bitcoind', newOptions)
    })

    after(() => {
      opts.bitcoind.setOption('bitcoind', savedOptions)
    })

    it('simple', async () => {
      let otherBitcoind = await opts.bitcoind.fork({connected: false})

      try {
        await opts.bitcoind.generateBlocks(1)
        await otherBitcoind.generateBlocks(2)

        let height1 = (await opts.bitcoind.rpc.getBlockCount()).result
        let height2 = (await otherBitcoind.rpc.getBlockCount()).result
        expect(height1 + 1).to.equal(height2)

        await opts.bitcoind.connect(otherBitcoind)
        await opts.waitTextInMaster('Reorg finished')

        let latest1 = (await opts.bitcoind.rpc.getBestBlockHash()).result
        let latest2 = (await otherBitcoind.rpc.getBestBlockHash()).result
        expect(latest1).to.equal(latest2)
      } finally {
        await otherBitcoind.terminate()
      }
    })
  })
}
